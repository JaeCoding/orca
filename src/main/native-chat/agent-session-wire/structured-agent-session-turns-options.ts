import { AGENT_CHAT_PERMISSION_MODE_OPTION_ID } from '../../../shared/agent-chat-permission-mode'
import { refuse, type AgentSessionOptionResult } from '../../../shared/agent-session-wire'
import { isAgentSessionOptionRejectedError } from './structured-agent-session-option-error'
import type { AgentSessionTurnContext, TurnOutcome } from './structured-agent-session-turns'

export async function performSetOption(
  ctx: AgentSessionTurnContext,
  input: { key: string; value: string },
  signal?: AbortSignal
): Promise<TurnOutcome<AgentSessionOptionResult>> {
  let applied: void | Readonly<Record<string, string>>
  try {
    applied = await ctx.adapter.setOption({
      sessionId: ctx.sessionId,
      ...input,
      fence: ctx.fence,
      ...(signal ? { signal } : {})
    })
  } catch (error) {
    if (isAgentSessionOptionRejectedError(error)) {
      return {
        ok: false,
        refusal: refuse(
          'agent_session_operation_invalid',
          { reason: error.refusalReason },
          error.message
        )
      }
    }
    throw error
  }
  const providerOptions = applied ?? { [input.key]: input.value }
  // The provider answers with its own options only; the permission mode is the record's.
  const permissionMode = ctx.persistedOptions?.[AGENT_CHAT_PERMISSION_MODE_OPTION_ID]
  await ctx.persistOptions(
    permissionMode === undefined
      ? providerOptions
      : { ...providerOptions, [AGENT_CHAT_PERMISSION_MODE_OPTION_ID]: permissionMode }
  )
  ctx.publish()
  return { ok: true, value: { ...input, ...(applied ? { options: { ...applied } } : {}) } }
}
