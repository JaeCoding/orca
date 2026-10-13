// The record of stopped messages injected into the agent's own log: a host-only tombstone mark that
// covers them until a later row proves the write refused, kept across replay and never published.

import { describe, expect, it } from 'vitest'
import { projectJournalBatch } from '../agent-session-wire/agent-session-journal-batch'
import {
  applyJournalRow,
  createJournalReducerState,
  renderJournalState,
  type JournalReducerState
} from './journal-reducer'
import {
  isJournalStopOrResumeRow,
  parseJournalRow,
  serializeJournalRow,
  type JournalRow,
  type JournalStoppedMessageInjection
} from './journal-row-schema'
import { buildJournalStoppedMessageInjectionRow } from './journal-stopped-message-injections'

const EPOCH = 'epoch-1'

function fold(injections: JournalStoppedMessageInjection[]): {
  state: JournalReducerState
  rows: JournalRow[]
} {
  const state = createJournalReducerState('session-1', EPOCH)
  const rows = injections.map((injection, index) => {
    const row = buildJournalStoppedMessageInjectionRow({
      state,
      seq: index + 1,
      fence: 1,
      ts: 1,
      injection
    })
    applyJournalRow(state, row)
    return row
  })
  return { state, rows }
}

describe('a stopped-message injection record', () => {
  it('covers the messages it names until a refusal of the same injection', () => {
    const recorded = fold([
      { injectionId: 'first', messageIds: ['a', 'b'] },
      { injectionId: 'second', messageIds: ['c'] }
    ])
    expect([...recorded.state.stoppedMessageInjections]).toEqual([
      ['first', { messageIds: ['a', 'b'] }],
      ['second', { messageIds: ['c'] }]
    ])

    const refused = fold([
      { injectionId: 'first', messageIds: ['a', 'b'] },
      { injectionId: 'second', messageIds: ['c'] },
      { injectionId: 'first', refused: true }
    ])
    expect([...refused.state.stoppedMessageInjections]).toEqual([['second', { messageIds: ['c'] }]])
  })

  it('folds the same from its stored line, so it survives a restart', () => {
    const { rows } = fold([{ injectionId: 'first', messageIds: ['a'] }])
    const replayed = createJournalReducerState('session-1', EPOCH)
    for (const row of rows) {
      const parsed = parseJournalRow(serializeJournalRow(row))
      expect(parsed.ok).toBe(true)
      if (parsed.ok) {
        applyJournalRow(replayed, parsed.row)
      }
    }
    expect([...replayed.stoppedMessageInjections]).toEqual([['first', { messageIds: ['a'] }]])
  })

  it('is a tombstone of an id no item takes, which an older reader folds as nothing', () => {
    const { state, rows } = fold([{ injectionId: 'first', messageIds: ['a'] }])
    expect(rows[0]).toMatchObject({
      kind: 'tombstone',
      itemId: 'orca:stopped-message-injection'
    })
    expect(isJournalStopOrResumeRow(rows[0]!)).toBe(false)
    expect(renderJournalState(state).items).toEqual([])
  })

  it('ignores a malformed record rather than the row', () => {
    const state = createJournalReducerState('session-1', EPOCH)
    const row = buildJournalStoppedMessageInjectionRow({
      state,
      seq: 1,
      fence: 1,
      ts: 1,
      injection: { injectionId: 'first', messageIds: [] }
    })
    applyJournalRow(state, {
      ...row,
      stoppedMessageInjection: { injectionId: '', messageIds: ['a'] }
    })
    applyJournalRow(state, row)
    expect(state.stoppedMessageInjections.size).toBe(0)
  })

  it('publishes nothing to clients', () => {
    const { state, rows } = fold([{ injectionId: 'first', messageIds: ['a'] }])
    const projection = projectJournalBatch({
      rows,
      snapshot: renderJournalState(state),
      afterSequence: 0
    })
    expect(projection).toMatchObject({
      ok: true,
      batch: { items: [], removedItemIds: [] }
    })
  })
})
