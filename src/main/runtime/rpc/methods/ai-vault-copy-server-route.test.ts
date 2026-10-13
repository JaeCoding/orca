import '../unused-default-rpc-methods.test-fixture'
import { afterEach, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import { AI_VAULT_METHODS } from './ai-vault'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { acpLaunchSpecFor } from '../../../acp/acp-launch-specs'
import { copyAcpConversation } from '../../../acp/acp-conversation-copy'
import { structuredAgentConfiguredArgs } from '../../../native-chat/structured-agent-configured-args'
import { installCopyingChat } from '../../../ai-vault/structured-session-ownership.test-support'
import { setStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import { createGlobalSettingsFixture } from '../../../../shared/global-settings-test-fixture'

afterEach(() => setStructuredAgentSessionHost(null))

it('refuses a paired-host server setting before making a copy, even when no client server flag is sent', async () => {
  const hostSettings = createGlobalSettingsFixture({
    agentDefaultArgs: { opencode: '--server http://synthetic-host-server' }
  })
  const resolveLaunchArgs = vi.fn(() =>
    structuredAgentConfiguredArgs('opencode', hostSettings, 'linux')
  )
  const connect = vi.fn()
  const spec = acpLaunchSpecFor('opencode')!
  const providerSessionId = 'ses_2f9aB3cD4eF5gH6iJ7kL8mN9oP'
  installCopyingChat(
    { transport: 'acp', agent: 'opencode', nativeId: providerSessionId },
    (input) =>
      copyAcpConversation(
        {
          spec,
          resolveLaunchArgs,
          connect,
          readLaunch: async () => ({
            spec,
            command: '/synthetic-bin/opencode',
            args: ['acp'],
            cwd: '/host-repo',
            env: {},
            envToDelete: [],
            fullAccess: false,
            resume: null
          })
        },
        input,
        { track: () => {} }
      )
  )
  const prepareAiVaultSessionResume = vi.fn()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this RPC handler reads only these runtime methods; no terminal or scanner is entered.
  const runtime = {
    getRuntimeId: () => 'host-runtime',
    ensureStructuredAgentSessionHost: async () => undefined,
    prepareAiVaultSessionResume
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: AI_VAULT_METHODS })
  const response = await dispatcher.dispatch({
    id: 'copy-request',
    authToken: 'synthetic-token',
    method: 'aiVault.prepareSessionResume',
    params: {
      agent: 'opencode2',
      sessionId: providerSessionId,
      filePath: '/host-store/opencode.db',
      codexHome: null,
      executionHostId: 'runtime:client',
      fork: true
    }
  })
  expect(response).toMatchObject({
    ok: false,
    error: { message: expect.stringContaining('Remove --server') }
  })
  expect(resolveLaunchArgs).toHaveBeenCalledOnce()
  expect(connect).not.toHaveBeenCalled()
  expect(prepareAiVaultSessionResume).not.toHaveBeenCalled()
  expect(JSON.stringify(response)).not.toContain('synthetic-host-server')
})
