// A handover row's stopped-message history: folded host-side, and an optional key an older reader
// keeps reading the row past. Nothing a client parses changes.

import { describe, expect, it } from 'vitest'
import { agentSessionFailureFact } from '../../../shared/agent-session-failure'
import { agentSessionFailureWords } from '../../../shared/agent-session-failure-words'
import { AgentJournalSubmissionSchema } from '../../../shared/agent-session-journal-submission-schema'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../shared/agent-session-journal-types'
import {
  applyJournalRow,
  createJournalReducerState,
  renderJournalState,
  type JournalReducerState
} from './journal-reducer'
import { parseJournalRow, serializeJournalRow, type JournalRow } from './journal-row-schema'

const EPOCH = 'epoch-1'

function base(seq: number): { v: number; epoch: string; seq: number; fence: number; ts: number } {
  return { v: 1, epoch: EPOCH, seq, fence: 1, ts: 1_000 + seq }
}

function submission(id: string, seq: number): JournalRow {
  return {
    kind: 'submission',
    clientMessageId: id,
    payloadFingerprint: `fp-${id}`,
    providerHandle: { kind: 'codex', threadId: 'thread-1' },
    body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: id }] },
    handoverRecorded: true,
    origin: 'client',
    source: { kind: 'user' },
    ...base(seq)
  }
}

function handover(id: string, seq: number, carries?: string[]): JournalRow {
  return {
    kind: 'dispatch',
    clientMessageId: id,
    state: 'pending',
    providerItemId: null,
    reason: null,
    turnScope: AGENT_JOURNAL_THREAD_SCOPE,
    ...(carries ? { carries } : {}),
    ...base(seq)
  }
}

function fold(rows: JournalRow[]): JournalReducerState {
  const state = createJournalReducerState('session-1', EPOCH)
  for (const row of rows) {
    applyJournalRow(state, row)
  }
  return state
}

describe('a handover row naming the stopped messages it carries', () => {
  it('a carrying handover row parses at the same version, and nothing new is published', () => {
    expect(parseJournalRow(serializeJournalRow(handover('c', 3, ['a'])))).toMatchObject({
      ok: true,
      row: { kind: 'dispatch', state: 'pending' }
    })
    const withdrawn = agentSessionFailureWords(
      agentSessionFailureFact('cancelled', { neverReachedAgent: true }),
      { surface: 'rejection' }
    )
    const state = fold([
      submission('a', 1),
      submission('c', 2),
      handover('c', 3, ['a']),
      {
        kind: 'dispatch',
        clientMessageId: 'a',
        state: 'rejected',
        providerItemId: null,
        reason: withdrawn.reason,
        rejection: withdrawn.rejection,
        answeredInTurn: null,
        ...base(4)
      }
    ])
    expect(state.stoppedHistoryCarried.get('c')).toEqual(['a'])
    const published = renderJournalState(state).submissions
    expect(published.some((entry) => 'carries' in entry)).toBe(false)
    const stopped = published.find((entry) => entry.clientMessageId === 'a')
    expect(AgentJournalSubmissionSchema.parse(stopped).rejection).toEqual({ kind: 'cancelled' })
  })
})
