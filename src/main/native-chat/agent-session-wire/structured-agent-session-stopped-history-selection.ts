// What a handover delivers of the stopped messages owed to the agent, chosen in the session's
// serialized handover step so a phone and a desktop sending at once deliver each one once: injected
// into the agent's own log ahead of the send where it can take them (Codex), else carried in a
// words-only send.

import { randomUUID } from 'node:crypto'
import type {
  AgentJournalMessageItem,
  AgentJournalSubmission
} from '../../../shared/agent-session-journal-types'
import { agentJournalSubmissionKey } from '../../../shared/agent-session-journal-item-key'
import {
  agentSessionSendCarriesStoppedHistory,
  agentSessionSendDeliversStoppedHistory,
  agentSessionStoppedHistoryOwed,
  selectStoppedHistory,
  stoppedHistoryBudget,
  type StoppedHistoryDelivery
} from '../../../shared/agent-session-stopped-history'
import { summarizeStructuredAgentContextFacts } from '../../../shared/structured-agent-session-context-usage'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import type { JournalStoppedHistory } from '../agent-session-journal/journal-stopped-message-injections'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import type { AgentSessionStoppedMessageInjectionOutcome } from './structured-agent-session-stopped-history-adapter'
import type { StructuredAgentSessionLogger } from './structured-agent-session-logger'

type StoppedHistoryContext = {
  sessionId: string
  fence: number
  journal: Pick<
    AgentSessionJournal,
    'submissions' | 'itemBody' | 'liveTurnScope' | 'contextUsage'
  > & {
    context: Pick<AgentSessionJournal['context'], 'floor'>
    stoppedHistory: Pick<JournalStoppedHistory, 'carried' | 'injected' | 'recordInjection'>
  }
  adapter: Pick<StructuredAgentSessionAdapter, 'injectStoppedMessages'>
  logger: StructuredAgentSessionLogger
}

/** None for a steer into a running turn, which may never record it, or for anything but a person's
 *  ordinary send; otherwise what this handover delivers of the stopped messages owed. */
function stoppedHistoryDelivery(
  ctx: StoppedHistoryContext,
  submission: AgentJournalSubmission,
  body: AgentJournalMessageItem
): StoppedHistoryDelivery | null {
  if (
    ctx.journal.liveTurnScope().kind !== 'thread' ||
    !agentSessionSendDeliversStoppedHistory(submission, body)
  ) {
    return null
  }
  return selectStoppedHistory(
    agentSessionStoppedHistoryOwed({
      submissions: ctx.journal.submissions(),
      carried: ctx.journal.stoppedHistory.carried(),
      injected: ctx.journal.stoppedHistory.injected(),
      clearSequence: ctx.journal.context.floor()?.sequence ?? 0,
      body: (id) => ctx.journal.itemBody(agentJournalSubmissionKey(id))
    }),
    stoppedHistoryBudget(summarizeStructuredAgentContextFacts(ctx.journal.contextUsage()), body)
  )
}

/** Injects the owed messages into the agent's own log. The record goes first and covers them, so
 *  they are never injected twice; only a proven refusal owes them again. Bookkeeping: whatever
 *  happens is logged, and the send goes on. */
export async function injectStoppedHistory(
  ctx: StoppedHistoryContext,
  submission: AgentJournalSubmission,
  body: AgentJournalMessageItem
): Promise<void> {
  const delivery = stoppedHistoryDelivery(ctx, submission, body)
  const inject = ctx.adapter.injectStoppedMessages
  if (!delivery || !inject) {
    return
  }
  const injectionId = randomUUID()
  const log = { scope: 'stopped-history', sessionId: ctx.sessionId, injectionId }
  try {
    await ctx.journal.stoppedHistory.recordInjection(
      { injectionId, messageIds: delivery.covers },
      ctx.fence
    )
  } catch (error) {
    // Unrecorded, so unwritten: they stay owed.
    ctx.logger.warn('recording a stopped-message injection failed', { ...log, error })
    return
  }
  let result: AgentSessionStoppedMessageInjectionOutcome
  try {
    result = await inject({
      sessionId: ctx.sessionId,
      fence: ctx.fence,
      messages: delivery.messages
    })
  } catch (error) {
    result = { outcome: 'unknown', reason: error instanceof Error ? error.message : String(error) }
  }
  if (result.outcome === 'accepted') {
    return
  }
  ctx.logger.warn('injecting stopped messages did not settle', { ...log, ...result })
  if (result.outcome === 'refused') {
    await ctx.journal.stoppedHistory
      .recordInjection({ injectionId, refused: true }, ctx.fence)
      .catch((error: unknown) =>
        ctx.logger.warn('recording a refused stopped-message injection failed', { ...log, error })
      )
  }
}

/** What a words-only send carries of the owed messages, or null for any other send. */
export function carriedStoppedHistory(
  ctx: StoppedHistoryContext,
  submission: AgentJournalSubmission,
  body: AgentJournalMessageItem
): StoppedHistoryDelivery | null {
  return agentSessionSendCarriesStoppedHistory(body)
    ? stoppedHistoryDelivery(ctx, submission, body)
    : null
}
