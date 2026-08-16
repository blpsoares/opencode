import { Effect } from "effect"
import os from "os"
import path from "path"
import { Integration } from "../../integration"
import { FSUtil } from "../../fs-util"
import { PluginV2 } from "../../plugin"

export const CLAUDE_CODE_OAUTH_ENV = "CLAUDE_CODE_OAUTH_TOKEN"

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string
    expiresAt?: number
  }
}

export const ClaudeCodeAuthPlugin = PluginV2.define({
  id: PluginV2.ID.make("claude-code-auth"),
  effect: Effect.fn("ClaudeCodeAuthPlugin.effect")(function* () {
    const fs = yield* FSUtil.Service
    const integrations = yield* Integration.Service

    const credentialsPath = path.join(os.homedir(), ".claude", ".credentials.json")
    const content = yield* fs
      .readFileStringSafe(credentialsPath)
      .pipe(Effect.orElseSucceed(() => undefined))
    if (!content) return

    let creds: ClaudeCredentials
    try {
      creds = JSON.parse(content) as ClaudeCredentials
    } catch {
      return
    }

    const token = creds.claudeAiOauth?.accessToken
    if (!token) return

    process.env[CLAUDE_CODE_OAUTH_ENV] = token

    yield* integrations
      .update((editor) => {
        editor.method.update({
          integrationID: Integration.ID.make("anthropic"),
          method: {
            type: "env",
            names: [CLAUDE_CODE_OAUTH_ENV],
          },
        })
      })
      .pipe(Effect.orElseSucceed(() => undefined))
  })(),
})
