// The host-only record of stopped messages injected into the agent's own log: tombstones of an id no
// item ever takes, carrying the injection as an extra key (`journal-row-schema.ts` says why not a kind).

import { agentJournalItemKey } from '../../../shared/agent-session-journal-item-key'
import type { AgentJournalCursor } from '../../../shared/agent-session-journal-types'
import type { JournalReducerState } from './journal-reducer'
import { journalRowBase } from './journal-row-builders'
import type { JournalStoppedMessageInjection, JournalTombstoneRow } from './journal-row-schema'
import type { JournalRowWriter } from './journal-row-writer'

const JOURNAL_STOPPED_MESSAGE_INJECTION_ITEM_ID = agentJournalItemKey({
  provider: 'orca',
  clientMessageId: 'stopped-message-injection'
})

export function buildJournalStoppedMessageInjectionRow(input: {
  state: JournalReducerState
  seq: number
  fence: number
  ts: number
  injection: JournalStoppedMessageInjection
}): JournalTombstoneRow {
  return {
    kind: 'tombstone',
    itemId: JOURNAL_STOPPED_MESSAGE_INJECTION_ITEM_ID,
    revision: 1,
    stoppedMessageInjection: input.injection,
    ...journalRowBase(input.state.epoch, input.seq, input.fence, input.ts)
  }
}

/** What the journal records of stopped messages reaching the agent, read and written. */
export class JournalStoppedHistory {
  constructor(
    private readonly deps: {
      state: () => JournalReducerState
      writer: JournalRowWriter
    }
  ) {}

  /** What each handed-over send carries as stopped-message history, by its client message id. */
  carried = (): ReadonlyMap<string, readonly string[]> => this.deps.state().stoppedHistoryCarried

  /** Each injection not proven refused, by injection id. */
  injected = (): ReadonlyMap<string, { readonly messageIds: readonly string[] }> =>
    this.deps.state().stoppedMessageInjections

  /** An injection's record, before its write, or its proven refusal. */
  recordInjection(
    injection: JournalStoppedMessageInjection,
    fence: number
  ): Promise<AgentJournalCursor> {
    return this.deps.writer.append((seq, ts) =>
      buildJournalStoppedMessageInjectionRow({
        state: this.deps.state(),
        seq,
        fence,
        ts,
        injection
      })
    )
  }
}

/** A record covers its messages; its refusal uncovers them. A malformed one changes nothing. */
export function foldJournalStoppedMessageInjection(
  injections: Map<string, { readonly messageIds: readonly string[] }>,
  value: unknown
): void {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('injectionId' in value) ||
    typeof value.injectionId !== 'string' ||
    value.injectionId.length === 0
  ) {
    return
  }
  if ('refused' in value && value.refused === true) {
    injections.delete(value.injectionId)
    return
  }
  const messageIds =
    'messageIds' in value && Array.isArray(value.messageIds)
      ? value.messageIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
  if (messageIds.length > 0) {
    injections.set(value.injectionId, { messageIds })
  }
}
