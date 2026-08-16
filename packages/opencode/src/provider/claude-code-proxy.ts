/**
 * Local HTTP proxy that translates Anthropic API requests to `claude` CLI subprocess calls.
 * This allows using the Claude Code OAuth session (with its own rate limits) without needing
 * a separate API key.
 */

import { spawn } from "child_process"
import { createServer, type IncomingMessage, type ServerResponse } from "http"
import type { AddressInfo } from "net"

interface AnthropicMessage {
  role: "user" | "assistant"
  content: string | Array<{ type: string; text?: string }>
}

interface AnthropicRequest {
  model?: string
  messages: AnthropicMessage[]
  max_tokens?: number
  stream?: boolean
  system?: string
}

function extractText(content: AnthropicMessage["content"]): string {
  if (typeof content === "string") return content
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
}

function buildConversationInput(req: AnthropicRequest): string {
  const lines: string[] = []

  if (req.system) {
    lines.push(`[System: ${req.system}]`, "")
  }

  // Include all but last message as context
  for (let i = 0; i < req.messages.length - 1; i++) {
    const msg = req.messages[i]
    const prefix = msg.role === "user" ? "Human" : "Assistant"
    lines.push(`${prefix}: ${extractText(msg.content)}`)
  }

  // Last message is the actual input
  const last = req.messages[req.messages.length - 1]
  if (req.messages.length > 1) {
    lines.push("") // blank line separator
  }
  lines.push(extractText(last.content))

  return lines.join("\n")
}

interface ClaudeStreamEvent {
  type: string
  message?: {
    model?: string
    id?: string
    content?: Array<{ type: string; text?: string }>
    stop_reason?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
  result?: string
  is_error?: boolean
}

function callClaudeCLI(input: string, model: string): Promise<{ text: string; usage: object; model: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      [
        "--print",
        "--output-format", "stream-json",
        "--input-format", "stream-json",
        "--verbose",
        "--model", model,
        "--no-mcp",
        "--disallowed-tools", "Bash,Edit,Write,Read,WebFetch,WebSearch,Task,Agent,Workflow",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    )

    const payload = JSON.stringify({
      type: "user",
      message: { role: "user", content: input },
    })
    child.stdin.write(payload + "\n")
    child.stdin.end()

    let text = ""
    let usage: object = {}
    let resolvedModel = model
    let buffer = ""

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event: ClaudeStreamEvent = JSON.parse(line)
          if (event.type === "assistant" && event.message) {
            const msg = event.message
            if (msg.model) resolvedModel = msg.model
            if (msg.content) {
              text += msg.content
                .filter((b) => b.type === "text")
                .map((b) => b.text ?? "")
                .join("")
            }
            if (msg.usage) usage = msg.usage
          } else if (event.type === "result" && event.is_error) {
            reject(new Error(event.result ?? "claude CLI error"))
          }
        } catch {
          // ignore parse errors on non-JSON lines
        }
      }
    })

    let stderr = ""
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on("close", (code) => {
      if (code !== 0 && !text) {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr.slice(0, 200)}`))
        return
      }
      resolve({ text, usage, model: resolvedModel })
    })
  })
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString()))
    req.on("error", reject)
  })
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.url !== "/v1/messages" || req.method !== "POST") {
    res.writeHead(404)
    res.end(JSON.stringify({ error: "Not found" }))
    return
  }

  readBody(req)
    .then(async (body) => {
      const apiReq: AnthropicRequest = JSON.parse(body)
      const model = apiReq.model ?? "claude-sonnet-4-6"
      const input = buildConversationInput(apiReq)

      const result = await callClaudeCLI(input, model)

      const response = {
        id: `msg_proxy_${Date.now()}`,
        type: "message",
        role: "assistant",
        model: result.model,
        content: [{ type: "text", text: result.text }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: result.usage,
      }

      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(response))
    })
    .catch((err: Error) => {
      res.writeHead(500, { "content-type": "application/json" })
      res.end(JSON.stringify({ type: "error", error: { type: "server_error", message: err.message } }))
    })
}

let proxyPort: number | null = null

export async function startClaudeCodeProxy(): Promise<number> {
  if (proxyPort !== null) return proxyPort

  return new Promise((resolve, reject) => {
    const server = createServer(handleRequest)
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port
      proxyPort = port
      resolve(port)
    })
    server.on("error", reject)
  })
}
