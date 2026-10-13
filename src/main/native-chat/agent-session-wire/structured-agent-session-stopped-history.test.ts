// A message a person sent and then stopped before the agent started on it reaches the agent with
// their next send, at most once: carried at the front of a words-only send, or injected into the
// agent's own log ahead of the send where it can take it. Against the real host, store and
// journal, with an agent that stays starting until the test proves its start.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentSessionFailureFact,
  type SubmissionRejectionKind
} from '../../../shared/agent-session-failure'
import { agentSessionFailureWords } from '../../../shared/agent-session-failure-words'
import type { AgentJournalMessageItem } from '../../../shared/agent-session-journal-types'
import { STOPPED_MESSAGE_INTERRUPTED_MARKER } from '../../../shared/agent-session-stopped-history'
import { projectStructuredAgentSessionMessages } from '../../../shared/structured-agent-session-message-projection'
import { isStructuredAgentSessionMainAgentWorking } from '../../../shared/structured-agent-session-main-agent-working'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import type { QueuedRigProviderOptions } from './structured-agent-session-queued-message-rig-provider.test-fixture'
import {
  createQueuedMessageTestRig,
  eventually,
  QUEUED_RIG_CALLER,
  type QueuedMessageTestRig
} from './structured-agent-session-queued-message-rig.test-fixture'
import {
  HOST_TEST_SESSION as SESSION,
  hostTestMessage,
  hostTestOperationId
} from './structured-agent-session-host-test-data'

let rig: QueuedMessageTestRig

async function start(options: QueuedRigProviderOptions = {}): Promise<void> {
  rig = await createQueuedMessageTestRig({ restartable: true, starting: true, ...options })
}

afterEach(async () => {
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

/** Each injection, as the words of the stopped messages it wrote. */
function injected(): string[][] {
  return rig.injectStoppedMessages.mock.calls.map(([input]) =>
    input.messages.map((entry) => entry.words)
  )
}

function sendRequest(body: string | AgentJournalMessageItem) {
  const message = typeof body === 'string' ? hostTestMessage(body) : body
  return {
    envelope: rig.envelope({ body: message }, 'agentSession.send', hostTestOperationId()),
    body: message,
    userSend: true as const
  }
}

/** Sent while the agent starts, so the host holds them; none is handed over. */
async function heldWhileStarting(...texts: string[]): Promise<string[]> {
  if (rig.host.collaboratorsForTests().sessions.get(SESSION)?.child) {
    await rig.host.close(SESSION, 'evict')
  }
  const ids: string[] = []
  for (const body of texts) {
    const request = sendRequest(body)
    expect(await rig.host.send(QUEUED_RIG_CALLER, request)).toMatchObject({ ok: true })
    ids.push(request.envelope.clientOperationId)
  }
  await eventually(() =>
    expect(rig.host.collaboratorsForTests().sessions.get(SESSION)?.child?.phase).toBe('starting')
  )
  return ids
}

/** A Stop while the agent starts: what it held is withdrawn, never written. */
async function stopWhileStarting(...texts: string[]): Promise<string[]> {
  const ids = await heldWhileStarting(...texts)
  expect(await rig.stop()).toMatchObject({ ok: true })
  for (const id of ids) {
    await eventually(async () =>
      expect(await rig.submission(id)).toMatchObject({
        dispatchState: 'rejected',
        // Host-held: the Stop's withdrawal proves it never reached the agent.
        rejection: { kind: 'cancelled', neverReachedAgent: true }
      })
    )
  }
  return ids
}

/** The person's next send, handed to a child that proved its start. */
async function nextSend(
  body: string | AgentJournalMessageItem,
  options: Parameters<QueuedMessageTestRig['send']>[2] = {}
) {
  const before = rig.dispatch.mock.calls.length
  const request = typeof body === 'string' ? null : sendRequest(body)
  const { id, result } =
    typeof body === 'string'
      ? rig.send(body, undefined, options)
      : {
          id: request!.envelope.clientOperationId,
          result: rig.host.send(QUEUED_RIG_CALLER, request!)
        }
  expect(await result).toMatchObject({ ok: true })
  if (rig.host.collaboratorsForTests().sessions.get(SESSION)?.child?.phase !== 'ready') {
    await rig.proveStart()
  }
  await eventually(() => expect(rig.dispatch.mock.calls.length).toBe(before + 1))
  return id
}

/** How a provider settles a handed-over send, as `settleLateDispatch` takes it. */
function settle(
  id: string,
  outcome:
    | { kind: 'rejected'; fact: SubmissionRejectionKind; neverReached?: true }
    | { kind: 'unknown' }
): Promise<void> {
  return outcome.kind === 'unknown'
    ? rig.host.settleLateDispatch({
        sessionId: SESSION,
        clientMessageId: id,
        state: 'unknown',
        reason: 'reply lost'
      })
    : rig.host.settleLateDispatch({
        sessionId: SESSION,
        clientMessageId: id,
        state: 'rejected',
        ...agentSessionFailureWords(
          agentSessionFailureFact(
            outcome.fact,
            outcome.neverReached ? { neverReachedAgent: true } : {}
          ),
          { surface: 'rejection' }
        )
      })
}

/** A second client, attached as the phone is. */
const PHONE_CALLER = { callerKey: 'phone-1' }

const MAIL = {
  kind: 'agent' as const,
  senders: [],
  orchestration: null
}

/** The chat's Working, as every session list reads it. */
function working(): boolean {
  return isStructuredAgentSessionMainAgentWorking(journal().activeTurnId(), journal().submissions())
}

/** The texts every client draws. */
async function transcript(): Promise<string[]> {
  const page = await rig.host.history({ sessionId: SESSION, direction: 'tail' })
  if (!page.ok) {
    throw new Error('history refused')
  }
  return projectStructuredAgentSessionMessages(page.page.items, [], page.page.submissions).map(
    (message) =>
      `${message.blocks.map((block) => ('text' in block ? block.text : '')).join('')}${
        message.stoppedBeforeStart ? ' (stopped)' : ''
      }`
  )
}

describe('stopped messages ride at the front of the next words-only send', () => {
  it('carries both a Stop withdrew while the agent started, in order, named on the handover row', async () => {
    await start()
    const [first, second] = await stopWhileStarting('first', 'second')
    const next = await nextSend('what did I send?')

    expect(dispatched()).toEqual([carrying(['first', 'second'], 'what did I send?')])
    expect(journal().stoppedHistory.carried().get(next)).toEqual([first, second])
    // Nothing changes in the chat: each still reads Stopped manually, the send shows its own words.
    for (const id of [first!, second!]) {
      expect(await rig.submission(id)).toMatchObject({
        dispatchState: 'rejected',
        ...agentSessionFailureWords(agentSessionFailureFact('cancelled'), { surface: 'rejection' })
      })
    }
    expect(await transcript()).toEqual([
      'first (stopped)',
      'second (stopped)',
      'Stopped manually',
      'what did I send?'
    ])
  })

  it('carries nothing again once the agent took them', async () => {
    await start()
    await stopWhileStarting('first')
    const carrier = await nextSend('carrier')
    await rig.settleAccepted(carrier, 'carrier')
    await nextSend('after')

    expect(dispatched()).toEqual([carrying(['first'], 'carrier'), 'after'])
  })

  it('a send with an attachment carries nothing; the next words-only send does', async () => {
    await start()
    await stopWhileStarting('first')
    const shot = await nextSend({
      kind: 'message',
      role: 'user',
      blocks: [
        { type: 'text', text: 'see' },
        { type: 'image-ref', path: '/tmp/shot.png' }
      ]
    })
    await rig.settleAccepted(shot, 'shot')
    await nextSend('after')

    expect(dispatched()).toEqual(['see', carrying(['first'], 'after')])
  })

  it('a carrier refused before any write leaves them owed: the next send carries them again', async () => {
    await start()
    await stopWhileStarting('first', 'second')
    rig.dispatch.mockResolvedValueOnce({
      state: 'rejected',
      ...agentSessionFailureWords(agentSessionFailureFact('writeFailed'), { surface: 'rejection' })
    })
    await nextSend('refused')
    await nextSend('again')

    expect(dispatched()).toEqual([
      carrying(['first', 'second'], 'refused'),
      carrying(['first', 'second'], 'again')
    ])
  })

  it('a carrier in doubt is never re-sent, nor what it carried', async () => {
    await start()
    await stopWhileStarting('first')
    const carrier = await nextSend('carrier')
    await settle(carrier, { kind: 'unknown' })
    await nextSend('after')

    expect(dispatched()).toEqual([carrying(['first'], 'carrier'), 'after'])
  })

  it('a carrier Pi refused at its sign-in check leaves them owed', async () => {
    await start()
    await stopWhileStarting('first')
    const carrier = await nextSend('carrier')
    await settle(carrier, { kind: 'rejected', fact: 'notSignedIn', neverReached: true })
    // A child that said it is signed out is replaced before the next send.
    const { result } = rig.send('next')
    expect(await result).toMatchObject({ ok: true })
    await eventually(() =>
      expect(rig.host.collaboratorsForTests().sessions.get(SESSION)?.child?.phase).toBe('starting')
    )
    await rig.proveStart()
    await eventually(() => expect(rig.dispatch).toHaveBeenCalledTimes(2))

    expect(dispatched()).toEqual([carrying(['first'], 'carrier'), carrying(['first'], 'next')])
  })

  it('a retry of the same send replays its answer and carries nothing again', async () => {
    await start()
    await stopWhileStarting('first')
    const request = sendRequest('carrier')
    expect(await rig.host.send(QUEUED_RIG_CALLER, request)).toMatchObject({ ok: true })
    await rig.proveStart()
    await eventually(() => expect(rig.dispatch).toHaveBeenCalledTimes(1))

    expect(await rig.host.send(QUEUED_RIG_CALLER, request)).toMatchObject({
      ok: true,
      value: { clientMessageId: request.envelope.clientOperationId }
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(dispatched()).toEqual([carrying(['first'], 'carrier')])
  })

  it('two Stops in a row, the second while the next send waited on the start, carry in send order', async () => {
    await start()
    await stopWhileStarting('first')
    // Stopped during its own start: nothing was written, so it is owed too.
    await stopWhileStarting('second')
    expect(rig.dispatch).not.toHaveBeenCalled()
    await nextSend('third')

    expect(dispatched()).toEqual([carrying(['first', 'second'], 'third')])
  })

  it('never carries a withdrawal no one proved unwritten, as Codex writes and old journals hold', async () => {
    await start()
    const sent = await nextSend('sent')
    await settle(sent, { kind: 'rejected', fact: 'cancelled' })
    await nextSend('next')

    expect(dispatched()).toEqual(['sent', 'next'])
  })

  it('two sends at once, from a phone and a desktop: the first handed over carries them, once', async () => {
    await start()
    await stopWhileStarting('first')
    const phoneRequest = sendRequest('from the phone')
    const desktopRequest = sendRequest('from the desktop')
    const [phone, desktop] = await Promise.all([
      rig.host.send(PHONE_CALLER, phoneRequest),
      rig.host.send(QUEUED_RIG_CALLER, desktopRequest)
    ])
    expect(phone).toMatchObject({ ok: true })
    expect(desktop).toMatchObject({ ok: true })
    await rig.proveStart()
    await eventually(() => expect(rig.dispatch).toHaveBeenCalledTimes(1))
    await rig.settleAccepted(phoneRequest.envelope.clientOperationId, 'phone')
    await eventually(() => expect(rig.dispatch).toHaveBeenCalledTimes(2))

    expect(dispatched()).toEqual([carrying(['first'], 'from the phone'), 'from the desktop'])
  })

  it('mail and slash commands carry nothing, and stopped mail is never owed', async () => {
    await start()
    await heldWhileStarting('first')
    const mail = rig.send('mail', undefined, { internal: true, from: MAIL })
    expect(await mail.result).toMatchObject({ ok: true })
    expect(await rig.stop()).toMatchObject({ ok: true })
    await eventually(async () =>
      expect(await rig.submission(mail.id)).toMatchObject({ dispatchState: 'rejected' })
    )
    await nextSend('more mail', { internal: true, from: MAIL })
    await rig.settleAccepted(rig.dispatch.mock.calls.at(-1)![0].clientMessageId, 'mail')
    await nextSend('/review')
    await rig.settleAccepted(rig.dispatch.mock.calls.at(-1)![0].clientMessageId, 'review')
    await nextSend('next')

    expect(dispatched()).toEqual(['more mail', '/review', carrying(['first'], 'next')])
  })

  it('carrying them changes no work outcome and publishes nothing of them', async () => {
    await start()
    await stopWhileStarting('first')
    expect(working()).toBe(false)
    const carrier = await nextSend('carrier')
    await rig.settleAccepted(carrier, 'carrier')

    expect(working()).toBe(false)
    const page = await rig.host.history({ sessionId: SESSION, direction: 'tail' })
    expect(page.ok && page.page.submissions.some((entry) => 'carries' in entry)).toBe(false)
    expect(await transcript()).toEqual(['first (stopped)', 'Stopped manually', 'carrier'])
  })

  it('a real /clear bounds what is owed: what was stopped before it is never carried', async () => {
    await start()
    await stopWhileStarting('before clear')
    const fields = { command: 'clear' as const }
    expect(
      await rig.host.conversationCommand(QUEUED_RIG_CALLER, {
        envelope: rig.envelope(fields, 'agentSession.conversationCommand', hostTestOperationId()),
        ...fields
      })
    ).toMatchObject({ ok: true, value: { command: 'clear', state: 'completed' } })
    await stopWhileStarting('after clear')
    await nextSend('next')

    expect(dispatched()).toEqual([carrying(['after clear'], 'next')])
  })
})

describe('an agent that injects gets them in its own log ahead of the send', () => {
  const injecting = () => start({ injectsStoppedHistory: true })

  it('injects both, in order, before the send, which goes as typed', async () => {
    await injecting()
    const [first, second] = await stopWhileStarting('first', 'second')
    const next = await nextSend('what did I send?')

    expect(injected()).toEqual([['first', 'second']])
    expect(dispatched()).toEqual(['what did I send?'])
    expect(rig.injectStoppedMessages.mock.invocationCallOrder[0]).toBeLessThan(
      rig.dispatch.mock.invocationCallOrder[0]!
    )
    expect(
      [...journal().stoppedHistory.injected().values()].map((record) => record.messageIds)
    ).toEqual([[first, second]])
    expect(journal().stoppedHistory.carried().has(next)).toBe(false)
  })

  it('injects nothing again once the agent took them', async () => {
    await injecting()
    await stopWhileStarting('first')
    const carrier = await nextSend('carrier')
    await rig.settleAccepted(carrier, 'carrier')
    await nextSend('after')

    expect(injected()).toEqual([['first']])
  })

  it('injects them again at the next send when the agent proved it refused them', async () => {
    await injecting()
    await stopWhileStarting('first')
    // As Codex answers while it runs a turn: nothing written.
    rig.injectStoppedMessages.mockResolvedValueOnce({
      outcome: 'refused',
      reason: 'Codex is running a turn'
    })
    const carrier = await nextSend('carrier')
    await rig.settleAccepted(carrier, 'carrier')
    await nextSend('after')

    expect(injected()).toEqual([['first'], ['first']])
    expect(dispatched()).toEqual(['carrier', 'after'])
    expect(journal().stoppedHistory.injected().size).toBe(1)
  })

  it('never injects them again when the outcome is unknown, or the injection threw', async () => {
    for (const fails of [
      () =>
        rig.injectStoppedMessages.mockResolvedValueOnce({
          outcome: 'unknown',
          reason: 'timed out'
        }),
      () => rig.injectStoppedMessages.mockRejectedValueOnce(new Error('lost contact'))
    ]) {
      await injecting()
      await stopWhileStarting('first')
      fails()
      const carrier = await nextSend('carrier')
      await rig.settleAccepted(carrier, 'carrier')
      await nextSend('after')

      // The send goes on whatever came of the injection.
      expect(injected()).toEqual([['first']])
      expect(dispatched()).toEqual(['carrier', 'after'])
      await rig.dispose()
    }
    await injecting()
  })

  it('an agent that proves it cannot inject gets them carried in the same send instead', async () => {
    await injecting()
    await stopWhileStarting('first')
    // As a Codex without `thread/inject_items` answers, after which it no longer injects.
    rig.injectStoppedMessages.mockImplementationOnce(async () => {
      rig.injectsStoppedMessages.mockReturnValue(false)
      return { outcome: 'refused', reason: 'thread/inject_items is unsupported' }
    })
    const carrier = await nextSend('carrier')
    await rig.settleAccepted(carrier, 'carrier')
    await nextSend('after')

    expect(injected()).toEqual([['first']])
    expect(dispatched()).toEqual([carrying(['first'], 'carrier'), 'after'])
  })

  it('a record written before a crash covers them across the restart', async () => {
    await injecting()
    const [first] = await stopWhileStarting('first')
    // The host died after the record and before the write's answer.
    await journal().stoppedHistory.recordInjection(
      { injectionId: 'crashed', messageIds: [first!] },
      rig.store.getRecord(SESSION)!.lease.runtimeFence
    )
    await rig.restartHostProcess()
    await nextSend('after restart')

    expect(injected()).toEqual([])
    expect(dispatched()).toEqual(['after restart'])
  })

  it('a refusal survives a restart: what it refused is still owed', async () => {
    await injecting()
    await stopWhileStarting('first')
    rig.injectStoppedMessages.mockResolvedValueOnce({ outcome: 'refused', reason: 'Codex busy' })
    const carrier = await nextSend('carrier')
    await rig.settleAccepted(carrier, 'carrier')
    await rig.restartHostProcess()
    await nextSend('after restart')

    expect(injected()).toEqual([['first'], ['first']])
  })

  it('a send with an attachment still delivers them, as the injection is its own write', async () => {
    await injecting()
    await stopWhileStarting('first')
    await nextSend({
      kind: 'message',
      role: 'user',
      blocks: [
        { type: 'text', text: 'see' },
        { type: 'image-ref', path: '/tmp/shot.png' }
      ]
    })

    expect(injected()).toEqual([['first']])
  })
})

describe('a recording that fails never blocks the send', () => {
  it('writes nothing to the agent when the record cannot be written, so they stay owed', async () => {
    await start({ injectsStoppedHistory: true })
    await stopWhileStarting('first')
    vi.spyOn(journal().stoppedHistory, 'recordInjection').mockRejectedValueOnce(
      new Error('disk full')
    )
    const carrier = await nextSend('carrier')
    await rig.settleAccepted(carrier, 'carrier')
    await nextSend('after')

    expect(injected()).toEqual([['first']])
    expect(dispatched()).toEqual(['carrier', 'after'])
  })
})
