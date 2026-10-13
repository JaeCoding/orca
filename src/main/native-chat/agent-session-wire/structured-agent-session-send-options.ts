// A send's model and effort, applied to the turn it starts the way a picker change is applied.

import type { AgentSessionOptionResult } from '../../../shared/agent-session-wire'
import { AGENT_CHAT_PERMISSION_MODE_OPTION_ID } from '../../../shared/agent-chat-permission-mode'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-mutation-context'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'
import { recordStructuredAgentSessionOptionIntent } from './structured-agent-session-options-read'
import { performSetOption } from './structured-agent-session-turns-options'
import type { AgentSessionTurnContext, TurnOutcome } from './structured-agent-session-turns'

export type StructuredAgentSessionOptionWriteContext = Pick<
  AgentSessionTurnContext,
  'sessionId' | 'adapter' | 'fence' | 'persistOptions' | 'publish'
>

/** With no child running, intent the next start replays; else the running child's own write. */
export async function writeStructuredAgentSessionOption(
  context: StructuredAgentSessionMutationContext,
  ctx: StructuredAgentSessionOptionWriteContext,
  input: { key: string; value: string }
): Promise<TurnOutcome<AgentSessionOptionResult>> {
  if (
    input.key === AGENT_CHAT_PERMISSION_MODE_OPTION_ID ||
    !context.sessions.get(ctx.sessionId)?.child
  ) {
    return recordStructuredAgentSessionOptionIntent(context.deps, ctx, input)
  }
  // Held where a start is, so a close, a Stop admitted now or quit ends the wait from outside.
  const wait = context.acquireAborts.begin(ctx.sessionId)
  try {
    return await performSetOption(ctx, input, wait.signal)
  } finally {
    wait.end()
    // Whatever the write's outcome, the child may hold what it asked for now.
    context.optionRevisions.advance(ctx.sessionId)
  }
}

/** Model first, so the effort lands under it; a value the chat already holds writes nothing. A
 *  failed write is logged and never stops the message, which runs on what the chat holds. */
export async function applyStructuredAgentSessionSendOptions(
  context: StructuredAgentSessionMutationContext,
  ctx: StructuredAgentSessionOptionWriteContext,
  options: Readonly<Record<string, string>> | undefined
): Promise<void> {
  const entries = Object.entries(options ?? {}).sort(
    ([a], [b]) => Number(b === 'model') - Number(a === 'model')
  )
  for (const [key, value] of entries) {
    if (context.deps.store.getRecord(ctx.sessionId)?.options?.[key] === value) {
      continue
    }
    const written = await writeStructuredAgentSessionOption(context, ctx, { key, value }).catch(
      (error: unknown) => ({ ok: false as const, error })
    )
    if (!written.ok) {
      context.deps.logger.warn("applying a send's option failed", {
        scope: 'send-options',
        sessionId: ctx.sessionId,
        key,
        error: 'error' in written ? written.error : written.refusal
      })
    }
  }
}

/** For the queue's own send, which runs outside any mutation. */
export function structuredAgentSessionOptionWriteContext(
  context: StructuredAgentSessionMutationContext,
  session: Pick<StructuredAgentSessionHostSession, 'journal'>,
  sessionId: string
): StructuredAgentSessionOptionWriteContext | null {
  const fence = context.deps.store.getRecord(sessionId)?.lease.runtimeFence
  if (fence === undefined) {
    return null
  }
  return {
    sessionId,
    fence,
    adapter: context.deps.adapter,
    persistOptions: (options) =>
      context.deps.store
        .replaceSessionOptions({ sessionId, fence, options, now: context.now() })
        .then(() => undefined),
    publish: () => context.publish(sessionId, session.journal)
  }
}
