// A message a person sent and then stopped before the agent started on it reaches the agent with
// their next send, at most once. Against the real host, store and journal, with an agent that stays
// starting until the test proves its start.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentSessionFailureFact } from '../../../shared/agent-session-failure'
import { agentSessionFailureWords } from '../../../shared/agent-session-failure-words'
import type { AgentJournalMessageItem } from '../../../shared/agent-session-journal-types'
import { STOPPED_MESSAGE_INTERRUPTED_MARKER } from '../../../shared/agent-session-stopped-history'
import { projectStructuredAgentSessionMessages } from '../../../shared/structured-agent-session-message-projection'
import { JournalStopAcceptor } from '../agent-session-journal/journal-stop-acceptance'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import type { QueuedRigProviderOptions } from './structured-agent-session-queued-message-rig-provider.test-fixture'
import {
  createQueuedMessageTestRig,
  eventually,
  type QueuedMessageTestRig
} from './structured-agent-session-queued-message-rig.test-fixture'
import { HOST_TEST_SESSION as SESSION } from './structured-agent-session-host-test-data'

let rig: QueuedMessageTestRig

async function start(options: QueuedRigProviderOptions = {}): Promise<void> {
  rig = await createQueuedMessageTestRig({ restartable: true, starting: true, ...options })
}

afterEach(async () => {
  vi.restoreAllMocks()
  await rig.dispose()
})

function journal(): AgentSessionJournal {
  const open = rig.host.collaboratorsForTests().sessions.get(SESSION)?.journal
  if (!open) {
    throw new Error('the conversation is not open')
  }
  return open
}

function text(body: AgentJournalMessageItem): string {
  return body.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
}

/** What a send carrying `stopped` ahead of `own` hands the agent. */
function carrying(stopped: string[], own: string): string {
  return (
    stopped.map((words) => `${words}\n\n${STOPPED_MESSAGE_INTERRUPTED_MARKER}\n\n`).join('') + own
  )
}

/** Each dispatch's words, as the agent gets them. */
function dispatched(): string[] {
  return rig.dispatch.mock.calls.map(([input]) => text(input.body))
}

/** Sent while the agent starts, so the host holds them; none is handed over. */
async function heldWhileStarting(...texts: string[]): Promise<string[]> {
  const ids: string[] = []
  for (const body of texts) {
    const { id, result } = rig.send(body)
    expect(await result).toMatchObject({ ok: true })
    ids.push(id)
  }
  await eventually(() =>
    expect(rig.host.collaboratorsForTests().sessions.get(SESSION)?.child?.phase).toBe('starting')
  )
  return ids
}

/** A Stop while the agent starts: its save withdraws what the host held, with the proof. */
async function stopWhileStarting(...texts: string[]): Promise<string[]> {
  const ids = await heldWhileStarting(...texts)
  expect(await rig.stop()).toMatchObject({ ok: true })
  for (const id of ids) {
    expect(await rig.submission(id)).toMatchObject({
      dispatchState: 'rejected',
      rejection: { kind: 'cancelled', neverReachedAgent: true }
    })
  }
  return ids
}

/** The person's next send, handed to a child that proved its start. */
async function nextSend(body: string): Promise<string> {
  const before = rig.dispatch.mock.calls.length
  const { id, result } = rig.send(body)
  expect(await result).toMatchObject({ ok: true })
  if (rig.host.collaboratorsForTests().sessions.get(SESSION)?.child?.phase !== 'ready') {
    await rig.proveStart()
  }
  await eventually(() => expect(rig.dispatch.mock.calls.length).toBe(before + 1))
  return id
}

/** The texts every client draws. */
async function transcript(): Promise<string[]> {
  const page = await rig.host.history({ sessionId: SESSION, direction: 'tail' })
  if (!page.ok) {
    throw new Error('history refused')
  }
  expect(page.page.submissions.some((entry) => 'carries' in entry)).toBe(false)
  return projectStructuredAgentSessionMessages(page.page.items, [], page.page.submissions).map(
    (message) =>
      `${message.blocks.map((block) => ('text' in block ? block.text : '')).join('')}${
        message.stoppedBeforeStart ? ' (stopped)' : ''
      }`
  )
}

describe('a Stop withdraws what the agent never got, and the next send delivers it once', () => {
  it('carries them at the front of the next send, in order, and never again', async () => {
    await start()
    const [first, second] = await stopWhileStarting('first', 'second')
    const carrier = await nextSend('what did I send?')
    await rig.settleAccepted(carrier, 'carrier')
    await nextSend('after')

    expect(dispatched()).toEqual([carrying(['first', 'second'], 'what did I send?'), 'after'])
    expect(journal().stoppedHistory.carried().get(carrier)).toEqual([first, second])
    // The chat is unchanged: each still reads Stopped manually, the send shows its own words.
    expect(await transcript()).toEqual([
      'first (stopped)',
      'second (stopped)',
      'Stopped manually',
      'what did I send?',
      'after'
    ])
  })

  it('a Stop that cannot be saved withdraws nothing, so nothing is owed', async () => {
    await start()
    const [held] = await heldWhileStarting('first')
    const accept = JournalStopAcceptor.prototype.accept
    // The receipt fails inside the Stop's transaction, rolling back its withdrawal.
    vi.spyOn(JournalStopAcceptor.prototype, 'accept').mockImplementationOnce(function (
      this: JournalStopAcceptor,
      input
    ) {
      const failing = {
        write: () => {
          throw new Error('disk full')
        },
        committed: () => undefined
      }
      return accept.call(this, input, failing)
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(await rig.stop()).toMatchObject({
      ok: false,
      refusal: { details: { reason: 'stopFailed' } }
    })
    expect(await rig.submission(held!)).toMatchObject({ dispatchState: 'pending' })
    await rig.proveStart()
    await eventually(() => expect(dispatched()).toEqual(['first']))
  })

  it('a carrier refused before any write owes them again; one in doubt never re-sends them', async () => {
    await start()
    await stopWhileStarting('first')
    rig.dispatch.mockResolvedValueOnce({
      state: 'rejected',
      ...agentSessionFailureWords(agentSessionFailureFact('writeFailed'), { surface: 'rejection' })
    })
    await nextSend('refused')
    const doubtful = await nextSend('in doubt')
    await rig.host.settleLateDispatch({
      sessionId: SESSION,
      clientMessageId: doubtful,
      state: 'unknown',
      reason: 'reply lost'
    })
    await nextSend('after')

    expect(dispatched()).toEqual([
      carrying(['first'], 'refused'),
      carrying(['first'], 'in doubt'),
      'after'
    ])
  })

  it('an agent that injects gets them in its own log before the send, which goes as typed', async () => {
    await start({ injectsStoppedHistory: true })
    const [first, second] = await stopWhileStarting('first', 'second')
    const carrier = await nextSend('what did I send?')
    await rig.settleAccepted(carrier, 'carrier')
    await nextSend('after')

    expect(
      rig.injectStoppedMessages.mock.calls.map(([input]) => input.messages.map((m) => m.words))
    ).toEqual([['first', 'second']])
    expect(rig.injectStoppedMessages.mock.invocationCallOrder[0]).toBeLessThan(
      rig.dispatch.mock.invocationCallOrder[0]!
    )
    expect(dispatched()).toEqual(['what did I send?', 'after'])
    expect(
      [...journal().stoppedHistory.injected().values()].map((record) => record.messageIds)
    ).toEqual([[first, second]])
  })
})
