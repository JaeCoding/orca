import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import { HOST_TEST_LOCATION } from '../../../native-chat/agent-session-wire/structured-agent-session-host-test-data'
import { foundAgentSessionRecord } from '../../agent-session-record-founding'
import {
  attachParams,
  call,
  clearStructuredHostStub,
  hostCalls,
  installStructuredHostStub,
  STRUCTURED_CLIENT
} from './structured-agent-session-rpc.test-fixture'

beforeEach(() => {
  installStructuredHostStub()
})
afterEach(() => {
  clearStructuredHostStub()
})

describe('legacy attach-shaped permission creation', () => {
  it.each(['agentSession.create', 'agentSession.ensure'] as const)(
    '%s gives a new record only the host permission seed',
    async (method) => {
      const seed = vi.fn(() => ({
        permissionMode: 'full-access',
        model: 'host-model',
        effort: 'high'
      }))
      const params = attachParams()
      expect(
        await call(method, params, STRUCTURED_CLIENT, {
          structuredAgentSessionLaunchSeedOptions: seed
        })
      ).toMatchObject({ ok: true })
      expect(hostCalls.attach).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          options: { permissionMode: 'full-access' },
          envelope: params.envelope
        })
      )
    }
  )

  it('does not derive a new seed for an existing record', async () => {
    const host = getStructuredAgentSessionHost()!
    const params = attachParams()
    vi.mocked(host.deps.store.getRecord).mockReturnValue(
      foundAgentSessionRecord(
        {
          sessionId: params.envelope.sessionId,
          provider: params.provider,
          location: HOST_TEST_LOCATION,
          accountHome: params.accountHome,
          options: { permissionMode: 'ask' }
        },
        { claimKeyId: 'key-1', now: 1 }
      )
    )
    const seed = vi.fn(() => ({ permissionMode: 'full-access' }))
    expect(
      await call('agentSession.ensure', params, STRUCTURED_CLIENT, {
        structuredAgentSessionLaunchSeedOptions: seed
      })
    ).toMatchObject({ ok: true })
    expect(seed).not.toHaveBeenCalled()
    expect(hostCalls.attach).toHaveBeenCalledWith(expect.anything(), params)
  })
})
