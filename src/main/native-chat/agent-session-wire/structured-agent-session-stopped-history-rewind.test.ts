// A Codex rewind drops stopped messages with their bubbles, as main does for every stopped bubble,
// so nothing is injected twice or owed after it. Against the real host, store and journal, with a
// Codex-shaped rewind that answers with the items its thread holds.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentJournalSubmissionKey,
  parseAgentJournalItemKey
} from '../../../shared/agent-session-journal-item-key'
import type {
  AgentJournalItemBody,
  AgentJournalItemIdentity
} from '../../../shared/agent-session-journal-types'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
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
/** What the Codex thread holds, oldest first: each accepted send. */
let thread: { identity: AgentJournalItemIdentity; body: AgentJournalItemBody }[]

const rewind = vi.fn<NonNullable<StructuredAgentSessionAdapter['rewind']>>(
  async ({ beforeTurnId, onPrepared }) => {
    const cut = thread.findIndex(
      ({ identity }) => identity.provider === 'codex' && identity.turnId === beforeTurnId
    )
    const kept = cut === -1 ? thread : thread.slice(0, cut)
    await onPrepared?.(kept)
    thread = kept
    return { ok: true, items: kept }
  }
)

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

/** Each injection, as the words of the stopped messages it wrote. */
function injected(): string[][] {
  return rig.injectStoppedMessages.mock.calls.map(([input]) =>
    input.messages.map((entry) => entry.words)
  )
}

/** A Stop while the agent starts: what it held is withdrawn, never written. */
async function stopWhileStarting(body: string): Promise<void> {
  if (rig.host.collaboratorsForTests().sessions.get(SESSION)?.child) {
    await rig.host.close(SESSION, 'evict')
  }
  const message = hostTestMessage(body)
  const envelope = rig.envelope({ body: message }, 'agentSession.send', hostTestOperationId())
  expect(
    await rig.host.send(QUEUED_RIG_CALLER, { envelope, body: message, userSend: true })
  ).toMatchObject({ ok: true })
  await eventually(() =>
    expect(rig.host.collaboratorsForTests().sessions.get(SESSION)?.child?.phase).toBe('starting')
  )
  expect(await rig.stop()).toMatchObject({ ok: true })
  await eventually(async () =>
    expect(await rig.submission(envelope.clientOperationId)).toMatchObject({
      rejection: { kind: 'cancelled', neverReachedAgent: true }
    })
  )
}

/** A send handed to a child that proved its start, which the agent then takes. */
async function sentAndTaken(body: string): Promise<string> {
  const before = rig.dispatch.mock.calls.length
  const { id, result } = rig.send(body)
  expect(await result).toMatchObject({ ok: true })
  if (rig.host.collaboratorsForTests().sessions.get(SESSION)?.child?.phase !== 'ready') {
    await rig.proveStart()
  }
  await eventually(() => expect(rig.dispatch.mock.calls.length).toBe(before + 1))
  await rig.settleAccepted(id, body)
  const providerItemId = (await rig.submission(id))?.providerItemId
  const identity = providerItemId ? parseAgentJournalItemKey(providerItemId) : null
  if (!identity) {
    throw new Error(`${id} was not accepted`)
  }
  thread.push({ identity, body: hostTestMessage(body) })
  return id
}

async function rewindTo(id: string): Promise<void> {
  const fields = {
    itemId: agentJournalSubmissionKey(id),
    expectedEpoch: journal().cursor().epoch
  }
  expect(
    await rig.host.rewind(QUEUED_RIG_CALLER, {
      ...fields,
      envelope: rig.envelope(fields, 'agentSession.rewind', hostTestOperationId())
    })
  ).toMatchObject({ ok: true })
}

describe.each([
  { path: 'its own history', cleared: false },
  { path: 'history after a /clear', cleared: true }
])('a Codex rewind of $path', ({ cleared }) => {
  async function begin(): Promise<void> {
    thread = []
    rig = await createQueuedMessageTestRig({
      restartable: true,
      starting: true,
      rewind,
      injectsStoppedHistory: true
    })
    if (cleared) {
      const fields = { command: 'clear' as const }
      expect(
        await rig.host.conversationCommand(QUEUED_RIG_CALLER, {
          envelope: rig.envelope(fields, 'agentSession.conversationCommand', hostTestOperationId()),
          ...fields
        })
      ).toMatchObject({ ok: true, value: { command: 'clear', state: 'completed' } })
    }
  }

  it('before the send that injected a stopped message: it is never injected again', async () => {
    await begin()
    await stopWhileStarting('A')
    const next = await sentAndTaken('B')
    expect(injected()).toEqual([['A']])

    await rewindTo(next)
    await sentAndTaken('C')

    expect(injected()).toEqual([['A']])
  })

  it('past one still owed: it is no longer owed', async () => {
    await begin()
    await stopWhileStarting('A')
    rig.injectStoppedMessages.mockResolvedValue({
      outcome: 'refused',
      reason: 'Codex is running a turn'
    })
    const next = await sentAndTaken('B')

    await rewindTo(next)
    await sentAndTaken('C')

    expect(injected()).toEqual([['A']])
  })
})
