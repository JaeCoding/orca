// Stopped messages the agent is still owed, derived from the journal on each handover (host only),
// and delivered with the person's next send that opens a turn: injected into the agent's own log
// where it can take them (Codex), else carried at the front of that send. One is covered by an
// injection record that no later row proves refused, or by a carrier's `carries` unless that carrier
// was refused before anything reached the agent. Words only: a stopped message's images are not replayed.

import { readAgentSessionFailureFact, type SubmissionRejectionKind } from './agent-session-failure'
import type {
  AgentJournalItemBody,
  AgentJournalMessageItem,
  AgentJournalSubmission
} from './agent-session-journal-types'
import {
  classifyDispatchRejection,
  dispatchWasWithdrawn
} from './structured-agent-session-dispatch-rejection'
import { MAX_PROMPT_BYTES } from './rpc-contract/structured-agent-session-message-params'
import type { StructuredAgentContextUsage } from './structured-agent-session-context-usage'

/** The record Claude writes for its own Stop, carried after each stopped message. */
export const STOPPED_MESSAGE_INTERRUPTED_MARKER = '[Request interrupted by user]'

export type StoppedHistoryJournal = {
  submissions: readonly AgentJournalSubmission[]
  /** Each handed-over send's carried history, by its client message id. */
  carried: ReadonlyMap<string, readonly string[]>
  /** Each injection not proven refused, by injection id. */
  injected: ReadonlyMap<string, { readonly messageIds: readonly string[] }>
  /** The latest /clear's sequence; 0 when none. */
  clearSequence: number
  body: (clientMessageId: string) => AgentJournalItemBody | null
}

export type OwedStoppedMessage = {
  clientMessageId: string
  words: string
}

/** A person's ordinary message: not a command, a goal, mail another agent sent, or a typed slash
 *  command, which only reads right as the start of a prompt. */
function isOrdinaryPersonMessage(
  body: AgentJournalItemBody | null | undefined
): body is AgentJournalMessageItem {
  if (
    body?.kind !== 'message' ||
    body.role !== 'user' ||
    body.command !== undefined ||
    body.sentAs !== undefined ||
    body.from !== undefined
  ) {
    return false
  }
  const firstText = body.blocks.find((block) => block.type === 'text' && block.text.length > 0)
  return !(firstText?.type === 'text' && firstText.text.startsWith('/'))
}

/** A Stop took it back where Orca proves the agent never received it. */
function withdrawnUnwritten(submission: AgentJournalSubmission): boolean {
  return (
    dispatchWasWithdrawn(submission) &&
    !submission.answeredInTurn &&
    readAgentSessionFailureFact(submission.rejection)?.neverReachedAgent === true
  )
}

// Raised by Orca before any byte of a words-only send reached the agent; any other kind may follow
// a provider write.
const REFUSED_BEFORE_WRITE: ReadonlySet<SubmissionRejectionKind> = new Set([
  'queueFull',
  'writeFailed'
])

/** Refused before anything reached the agent: what it carried is owed again. */
function refusedBeforeWrite(carrier: AgentJournalSubmission): boolean {
  if (carrier.dispatchState !== 'rejected' || carrier.answeredInTurn) {
    return false
  }
  // Proven unwritten where it was refused: a Stop's withdrawal, a child gone before the write, or a
  // sign-in Pi checks before recording the prompt.
  if (readAgentSessionFailureFact(carrier.rejection)?.neverReachedAgent === true) {
    return true
  }
  const { kind } = classifyDispatchRejection(carrier)
  return kind !== undefined && REFUSED_BEFORE_WRITE.has(kind)
}

/** The stopped messages owed to the agent, in the order they were sent. */
export function agentSessionStoppedHistoryOwed(
  journal: StoppedHistoryJournal
): OwedStoppedMessage[] {
  const byId = new Map(journal.submissions.map((entry) => [entry.clientMessageId, entry]))
  const covered = new Set([...journal.injected.values()].flatMap((record) => record.messageIds))
  for (const [carrierId, carried] of journal.carried) {
    const carrier = byId.get(carrierId)
    if (carrier && !refusedBeforeWrite(carrier)) {
      carried.forEach((id) => covered.add(id))
    }
  }
  return journal.submissions
    .flatMap((submission) => {
      if (
        submission.acceptedSequence === undefined ||
        submission.acceptedSequence <= journal.clearSequence ||
        submission.origin !== 'client' ||
        submission.source?.kind !== 'user' ||
        submission.queuedMessageId !== undefined ||
        covered.has(submission.clientMessageId) ||
        !withdrawnUnwritten(submission)
      ) {
        return []
      }
      const { clientMessageId, acceptedSequence } = submission
      const body = journal.body(clientMessageId)
      const words = isOrdinaryPersonMessage(body) ? messageWords(body) : ''
      return words.length > 0 ? [{ clientMessageId, words, acceptedSequence }] : []
    })
    .sort((left, right) => left.acceptedSequence - right.acceptedSequence)
    .map(({ clientMessageId, words }) => ({ clientMessageId, words }))
}

/** A message's words as an agent joins its text blocks. */
function messageWords(body: AgentJournalMessageItem): string {
  return body.blocks
    .flatMap((block) => (block.type === 'text' && block.text.length > 0 ? [block.text] : []))
    .join('\n')
}

// Per message, the larger transport's framing beyond its words: Codex's two item wrappers and its
// own interrupted record.
export const STOPPED_MESSAGE_FRAMING_BYTES = 512
// One byte per token, pessimistic for any tokenizer. An unknown window is read as 128k tokens, and a
// quarter of the window (at least 16k) stays free for the agent's own work.
const UNKNOWN_CONTEXT_WINDOW_TOKENS = 128_000
const RESERVED_CONTEXT_MIN_TOKENS = 16_000
const IMAGE_ALLOWANCE_BYTES = 8_192

function encodedBytes(text: string): number {
  return new TextEncoder().encode(JSON.stringify(text)).length
}

/** Bytes of stopped history `body`'s send has room for: what the agent's context has left beside
 *  the send's own content, and never more than one send can hold (`MAX_PROMPT_BYTES`). */
export function stoppedHistoryBudget(
  context: Pick<StructuredAgentContextUsage, 'usedTokens' | 'windowTokens'> | null,
  body: AgentJournalMessageItem
): number {
  const window = context?.windowTokens ?? UNKNOWN_CONTEXT_WINDOW_TOKENS
  const images = body.blocks.filter((block) => block.type === 'image-ref').length
  const own = encodedBytes(messageWords(body)) + images * IMAGE_ALLOWANCE_BYTES
  const reserved = Math.max(RESERVED_CONTEXT_MIN_TOKENS, Math.ceil(window / 4))
  return Math.min(MAX_PROMPT_BYTES, window - (context?.usedTokens ?? 0) - own - reserved)
}

/** One delivery: the owed messages that fit `budget`, newest first, in the order sent. It covers
 *  every owed message, those left out included, so none arrives after a newer one. */
export type StoppedHistoryDelivery = {
  messages: OwedStoppedMessage[]
  covers: string[]
}

/** Null when none fits, so they stay owed. */
export function selectStoppedHistory(
  owed: readonly OwedStoppedMessage[],
  budget: number
): StoppedHistoryDelivery | null {
  let room = budget
  const messages: OwedStoppedMessage[] = []
  for (const entry of owed.toReversed()) {
    const cost = encodedBytes(entry.words) + STOPPED_MESSAGE_FRAMING_BYTES
    if (cost <= room) {
      room -= cost
      messages.unshift(entry)
    }
  }
  return messages.length > 0
    ? { messages, covers: owed.map((entry) => entry.clientMessageId) }
    : null
}

/** Whether this send's handover delivers the stopped messages owed: a person's ordinary message, a
 *  queued card's hand-off included. */
export function agentSessionSendDeliversStoppedHistory(
  submission: Pick<AgentJournalSubmission, 'source' | 'queuedMessageId'>,
  body: AgentJournalItemBody | null | undefined
): body is AgentJournalMessageItem {
  // A card's hand-off records no sender; its body's missing `from` says it is the person's.
  const persons = submission.source?.kind === 'user' || submission.queuedMessageId !== undefined
  return persons && isOrdinaryPersonMessage(body)
}

/** Whether this send can carry stopped messages: words only, so the carried words can never take
 *  it past an agent's limits, which its attachments' unread size could. */
export function agentSessionSendCarriesStoppedHistory(body: AgentJournalMessageItem): boolean {
  return body.blocks.every((block) => block.type === 'text') && messageWords(body).length > 0
}

/** A words-only send's body with the delivered stopped messages ahead of its own words, each
 *  followed by the record Claude writes for its own Stop. */
export function withStoppedHistory(
  body: AgentJournalMessageItem,
  messages: readonly OwedStoppedMessage[]
): AgentJournalMessageItem {
  const carried = messages
    .map((entry) => `${entry.words}\n\n${STOPPED_MESSAGE_INTERRUPTED_MARKER}\n\n`)
    .join('')
  return { ...body, blocks: [{ type: 'text', text: `${carried}${messageWords(body)}` }] }
}
