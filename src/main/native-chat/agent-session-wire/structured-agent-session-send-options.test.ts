// A send's carried model and effort against the real host, store and journal: applied to the turn
// it starts (recorded before a start, written to a running child), skipped when the chat already
// holds it, never stopping the message, part of the operation's fingerprint, and kept on a queued
// card until the card goes out.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import { agentSessionMessagePayload } from '../../../shared/structured-agent-session-send-mutation'
import {
  createQueuedMessageTestRig,
  eventually,
  QUEUED_RIG_CALLER as CALLER,
  type QueuedMessageTestRig
} from './structured-agent-session-queued-message-rig.test-fixture'
import {
  HOST_TEST_SESSION as SESSION,
  hostTestMessage,
  hostTestOperationId
} from './structured-agent-session-host-test-data'
import {
  createRestTestRig,
  foundRestTestChat,
  IDLE_MS,
  REST_TEST_CALLER,
  restTestSend
} from './structured-agent-session-rest-test-rig'

const PICKED = { model: 'gpt-picked', effort: 'high' }

let rig: QueuedMessageTestRig

beforeEach(async () => {
  rig = await createQueuedMessageTestRig()
})

afterEach(() => rig.dispose())

function recordedOptions(): Readonly<Record<string, string>> | undefined {
  return rig.store.getRecord(SESSION)?.options
}

/** A running child with nothing in flight. */
async function idleRunningChild(): Promise<void> {
  const working = await rig.workingSend()
  await rig.settleAccepted(working, 'idle')
}

describe('a send carrying its model and effort to a chat at rest', () => {
  it('records them before the start its message needs, so the agent starts on them', async () => {
    const rest = await createRestTestRig()
    try {
      await foundRestTestChat(rest)
      rest.clock.now += IDLE_MS + 1
      await vi.waitFor(() =>
        expect(rest.store.getRecord(SESSION)?.lease.claimStatus).toBe('released')
      )
      const send = restTestSend('carry on', rest.store.getRecord(SESSION)?.lease.runtimeFence)
      const fields = { body: send.body, options: PICKED }
      const sent = await rest.host.send(REST_TEST_CALLER, {
        ...send,
        envelope: {
          ...send.envelope,
          payloadFingerprint: computeAgentSessionPayloadFingerprint({
            method: 'agentSession.send',
            sessionId: SESSION,
            fields
          })
        },
        options: PICKED
      })
      expect(sent.ok).toBe(true)
      await vi.waitFor(() => expect(rest.adapter.acquire).toHaveBeenCalledTimes(2))
      expect(rest.adapter.acquire).toHaveBeenLastCalledWith(
        expect.objectContaining({ options: expect.objectContaining(PICKED) })
      )
    } finally {
      await rest.dispose()
    }
  })
})

describe('a send carrying its model and effort', () => {
  it('writes them to a running child, model first, and skips what the chat already holds', async () => {
    await idleRunningChild()
    await rig.send('switch', undefined, { carried: PICKED }).result
    expect(vi.mocked(rig.setOption).mock.calls.map(([input]) => input.key)).toEqual([
      'model',
      'effort'
    ])
    expect(recordedOptions()).toMatchObject({ effort: 'high' })

    vi.mocked(rig.setOption).mockClear()
    await rig.send('same again', undefined, { carried: { effort: 'high' } }).result
    expect(rig.setOption).not.toHaveBeenCalled()
  })

  it('still sends when the write fails, on what the chat holds', async () => {
    await idleRunningChild()
    vi.mocked(rig.setOption).mockRejectedValueOnce(new Error('child refused'))
    const { id, result } = rig.send('anyway', undefined, { carried: { model: 'gpt-picked' } })
    expect(await result).toMatchObject({ ok: true })
    await eventually(async () => expect((await rig.submission(id))?.handedOverAt).toBeDefined())
    expect(recordedOptions()?.model).toBeUndefined()
  })

  it('fingerprints them with the operation, so the same id with other options conflicts', async () => {
    const body = hostTestMessage('once')
    const clientOperationId = hostTestOperationId()
    const params = (options: Record<string, string>) => {
      const fields = { body: agentSessionMessagePayload(body), options }
      return {
        envelope: rig.envelope(fields, 'agentSession.send', clientOperationId),
        ...fields,
        body
      }
    }
    expect(await rig.host.send(CALLER, params(PICKED))).toMatchObject({ ok: true })
    expect(await rig.host.send(CALLER, params({ model: 'other' }))).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_conflict' }
    })
  })
})

describe('a queued send carrying its model and effort', () => {
  async function queued(carried: Readonly<Record<string, string>>): Promise<{
    working: string
    draftId: string
  }> {
    const working = await rig.workingSend()
    const answer = await rig.send('later', 'queue-if-active', { carried }).result
    if (!answer.ok || !('queued' in answer.value)) {
      throw new Error('expected a queued receipt')
    }
    return { working, draftId: answer.value.queued.messageId }
  }

  it('keeps them on the card and applies them when the queue sends it', async () => {
    const { working, draftId } = await queued({ model: 'gpt-picked' })
    expect(rig.setOption).not.toHaveBeenCalled()
    await rig.settleAccepted(working, 'a')
    await eventually(async () => expect(await rig.handoff(draftId)).toBeDefined())
    await eventually(() =>
      expect(rig.setOption).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'model', value: 'gpt-picked' })
      )
    )
  })

  it('applies them when the card is sent by hand', async () => {
    const { draftId } = await queued({ model: 'gpt-picked' })
    expect(await rig.sendNow(draftId)).toMatchObject({ ok: true })
    expect(rig.setOption).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'model', value: 'gpt-picked' })
    )
  })
})
