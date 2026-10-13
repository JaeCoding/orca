// How an adapter takes stopped messages owed to its agent when it can inject them into the agent's
// own log (Codex); every other agent gets them carried in the person's next send.

import type { OwedStoppedMessage } from '../../../shared/agent-session-stopped-history'

/** `refused`: proven before anything reached the agent, so they are owed again. `unknown`: they may
 *  be in its log, so they are never injected again. */
export type AgentSessionStoppedMessageInjectionOutcome =
  | { outcome: 'accepted' }
  | { outcome: 'refused' | 'unknown'; reason: string }

export type StructuredAgentSessionStoppedHistoryAdapter = {
  /** Whether this session's agent takes stopped messages by injection; absent: carried. */
  injectsStoppedMessages?(sessionId: string): boolean
  /** Writes stopped messages into the agent's own log without running a turn, each followed by the
   *  agent's own record of an interrupted request, oldest first, in one write. Refused while the
   *  agent runs a turn by its own account, where an injection would steer it. */
  injectStoppedMessages?(input: {
    sessionId: string
    fence: number
    messages: readonly OwedStoppedMessage[]
  }): Promise<AgentSessionStoppedMessageInjectionOutcome>
}
