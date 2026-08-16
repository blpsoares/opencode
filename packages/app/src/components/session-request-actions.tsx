import { createMemo, For, Show } from "solid-js"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { sessionPermissionRequest, sessionQuestionRequest } from "@/pages/session/composer/session-request-tree"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import type { PermissionRequest, QuestionOption, QuestionRequest } from "@opencode-ai/sdk/v2/client"

export function SessionPendingRequestActions(props: {
  sessionID: string
  directory: string
  compact?: boolean
  class?: string
}) {
  const permissionCtx = usePermission()
  const sdk = useSDK()
  const language = useLanguage()
  const serverSync = useServerSync()

  const [sessionStore] = serverSync().child(props.directory)

  const pendingPermission = createMemo<PermissionRequest | undefined>(() => {
    return sessionPermissionRequest(
      sessionStore.session,
      sessionStore.permission,
      props.sessionID,
      (item) => !permissionCtx.autoResponds(item, props.directory),
    )
  })

  const pendingQuestion = createMemo<QuestionRequest | undefined>(() => {
    return sessionQuestionRequest(sessionStore.session, sessionStore.question, props.sessionID)
  })

  const respondPermission = (response: "once" | "always" | "reject") => {
    const req = pendingPermission()
    if (!req) return
    permissionCtx.respond({
      sessionID: props.sessionID,
      permissionID: req.id,
      response,
      directory: props.directory,
    })
  }

  const replyQuestionOption = (answerValue: string) => {
    const req = pendingQuestion()
    if (!req) return
    void sdk().client.question.reply({
      requestID: req.id,
      answers: [[answerValue]],
      directory: props.directory,
    })
  }

  const rejectQuestion = () => {
    const req = pendingQuestion()
    if (!req) return
    void sdk().client.question.reject({
      requestID: req.id,
      directory: props.directory,
    })
  }

  const patternSummary = createMemo(() => {
    const req = pendingPermission()
    if (!req) return ""
    const permName = req.permission
    const pattern = req.patterns?.[0]
    if (pattern) {
      return `${permName}: ${pattern}`
    }
    return permName
  })

  return (
    <Show when={pendingPermission() || pendingQuestion()}>
      <div
        class={`flex items-center gap-1.5 shrink-0 ${props.class ?? ""}`}
        onClick={(e: MouseEvent) => {
          e.stopPropagation()
          e.preventDefault()
        }}
        onPointerDown={(e: MouseEvent) => {
          e.stopPropagation()
        }}
      >
        <Show when={pendingPermission()}>
          {(_perm) => (
            <div class="flex items-center gap-1.5 rounded-md bg-surface-warning-subtle/90 px-2 py-0.5 text-12-medium text-text-strong border border-surface-warning-strong/30 shadow-xs">
              <span class="flex items-center gap-1 text-icon-warning-base text-11-medium font-mono">
                <Icon name="warning" size="small" />
                <Show when={!props.compact}>
                  <span class="max-w-[180px] truncate" title={patternSummary()}>
                    {patternSummary()}
                  </span>
                </Show>
              </span>

              <div class="flex items-center gap-1">
                <Button
                  variant="primary"
                  size="small"
                  class="h-5 px-1.5 text-11-medium"
                  onClick={(e: MouseEvent) => {
                    e.stopPropagation()
                    e.preventDefault()
                    respondPermission("once")
                  }}
                  title={language.t("ui.permission.allowOnce")}
                >
                  {language.t("ui.permission.allowOnce")}
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  class="h-5 px-1.5 text-11-medium"
                  onClick={(e: MouseEvent) => {
                    e.stopPropagation()
                    e.preventDefault()
                    respondPermission("always")
                  }}
                  title={language.t("ui.permission.allowAlways")}
                >
                  {language.t("ui.permission.allowAlways")}
                </Button>
                <Button
                  variant="ghost"
                  size="small"
                  class="h-5 px-1.5 text-11-medium text-text-diff-delete-base hover:bg-surface-critical-subtle"
                  onClick={(e: MouseEvent) => {
                    e.stopPropagation()
                    e.preventDefault()
                    respondPermission("reject")
                  }}
                  title={language.t("ui.permission.deny")}
                >
                  {language.t("ui.permission.deny")}
                </Button>
              </div>
            </div>
          )}
        </Show>

        <Show when={pendingQuestion()}>
          {(req) => {
            const firstQuestion = () => req().questions[0]
            const options = () => (firstQuestion()?.options ?? []) as QuestionOption[]

            return (
              <div class="flex items-center gap-1.5 rounded-md bg-surface-interactive-subtle/90 px-2 py-0.5 text-12-medium text-text-strong border border-text-interactive-base/30 shadow-xs">
                <span class="flex items-center gap-1 text-text-interactive-base text-11-medium">
                  <Icon name="bubble-5" size="small" />
                  <Show when={!props.compact && firstQuestion()?.question}>
                    <span class="max-w-[180px] truncate" title={firstQuestion()?.question}>
                      {firstQuestion()?.question}
                    </span>
                  </Show>
                </span>

                <div class="flex items-center gap-1">
                  <For each={options().slice(0, 3)}>
                    {(opt) => {
                      const label = opt.label
                      return (
                        <Button
                          variant="secondary"
                          size="small"
                          class="h-5 px-1.5 text-11-medium"
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation()
                            e.preventDefault()
                            replyQuestionOption(label)
                          }}
                          title={opt.description ? `${label} - ${opt.description}` : label}
                        >
                          {label}
                        </Button>
                      )
                    }}
                  </For>
                  <Button
                    variant="ghost"
                    size="small"
                    class="h-5 px-1.5 text-11-medium text-text-diff-delete-base"
                    onClick={(e: MouseEvent) => {
                      e.stopPropagation()
                      e.preventDefault()
                      rejectQuestion()
                    }}
                  >
                    {language.t("ui.common.cancel")}
                  </Button>
                </div>
              </div>
            )
          }}
        </Show>
      </div>
    </Show>
  )
}
