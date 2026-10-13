// Stopped messages written into Codex's own log without running a turn: one `thread/inject_items`
// holding, per message, the user message and then the user-role `<turn_aborted>` fragment Codex
// writes for its own Stop in its default mode (codex-rs/core/src/context/turn_aborted.rs). Codex
// answers `{}` and notifies nothing (measured, 0.159.0). Into a running turn it acts as a steer, so
// it goes in only while none runs by Codex's own account.

import type { OwedStoppedMessage } from '../../shared/agent-session-stopped-history'
import type { AgentSessionStoppedMessageInjectionOutcome } from '../native-chat/agent-session-wire/structured-agent-session-stopped-history-adapter'
import { isCodexAppServerUnsupportedError } from './codex-app-server-session'
import type { CodexSession } from './codex-structured-session-state'

export const CODEX_TURN_ABORTED_MARKER =
  '<turn_aborted>\nThe user interrupted the previous turn on purpose. Any running unified exec processes may still be running in the background. If any tools/commands were aborted, they may have partially executed.\n</turn_aborted>'

// Keeps the send queued behind the injection waiting at most a few seconds.
const CODEX_STOPPED_MESSAGE_INJECTION_TIMEOUT_MS = 2_000

/** The session state an injection reads and, on a Codex without it, marks. */
export type CodexInjectionHost = Pick<
  CodexSession,
  'ended' | 'fence' | 'threadId' | 'activeTurnIds' | 'dispatchPending' | 'cannotInjectHistory'
> & {
  connection: Pick<CodexSession['connection'], 'closed' | 'request'>
}

function userMessage(text: string): Record<string, unknown> {
  return { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
}

const CODEX_GONE = 'Codex ended before the injection'

/** Why Codex cannot take an injection now, or null: gone, a later child, or running a turn. */
function notIdle(session: CodexInjectionHost, fence: number): string | null {
  if (session.ended || session.connection.closed || session.fence !== fence) {
    return CODEX_GONE
  }
  return session.activeTurnIds?.size || session.dispatchPending ? 'Codex is running a turn' : null
}

export async function injectCodexStoppedMessages(
  session: CodexInjectionHost | undefined,
  input: { fence: number; messages: readonly OwedStoppedMessage[] }
): Promise<AgentSessionStoppedMessageInjectionOutcome> {
  if (!session) {
    return { outcome: 'refused', reason: CODEX_GONE }
  }
  const busy = notIdle(session, input.fence)
  if (busy) {
    return { outcome: 'refused', reason: busy }
  }
  const items = input.messages.flatMap(({ words }) => [
    userMessage(words),
    userMessage(CODEX_TURN_ABORTED_MARKER)
  ])
  try {
    await session.connection.request(
      'thread/inject_items',
      { threadId: session.threadId, items },
      { timeoutMs: CODEX_STOPPED_MESSAGE_INJECTION_TIMEOUT_MS }
    )
    return { outcome: 'accepted' }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (isCodexAppServerUnsupportedError(error)) {
      // A Codex without the method refuses it before touching history; this session carries instead.
      session.cannotInjectHistory = true
      return { outcome: 'refused', reason }
    }
    // Any other error proves nothing: Codex may record the items and then fail.
    return { outcome: 'unknown', reason }
  }
}
