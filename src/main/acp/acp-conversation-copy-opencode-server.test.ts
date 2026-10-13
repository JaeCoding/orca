import { describe, expect, it, vi } from 'vitest'
import { acpLaunchSpecFor } from './acp-launch-specs'
import { copyAcpConversation } from './acp-conversation-copy'
import { FakeAcpChild } from './acp-structured-adapter.test-support'
import { createAcpStructuredLaunchResolver } from '../runtime/structured-agent-launch-composition.test-support'
import { agentSessionRecordFixture } from '../../shared/agent-session-record.test-fixture'
import { structuredAgentConfiguredArgs } from '../native-chat/structured-agent-configured-args'

const UNMANAGED = { kind: 'opencode' as const, locator: { kind: 'unmanaged' as const } }
const identity = {
  sessionId: 'chat',
  workspaceId: 'workspace',
  hostId: 'local',
  agent: 'opencode',
  providerHandle: null
}
const input = { identity, providerSessionId: 'original', accountHome: UNMANAGED }
const spec = {
  ...acpLaunchSpecFor('opencode')!,
  account: {
    ...acpLaunchSpecFor('opencode')!.account,
    resolve: async () => UNMANAGED,
    environment: (_home: unknown, env: Record<string, string>) => env
  }
}

function readLaunch(command?: string) {
  const record = {
    ...agentSessionRecordFixture(),
    sessionId: 'chat',
    provider: 'opencode',
    accountHome: UNMANAGED,
    providerHandleChain: []
  }
  const resolver = createAcpStructuredLaunchResolver(spec, {
    store: { getRecord: () => record, pinLaunchDirectory: vi.fn() },
    readJournal: () => null,
    resolveWorkspacePath: async () => '/synthetic-repo',
    resolveEnvironment: async () => ({ HOME: '/synthetic-home', PATH: '/synthetic-bin' }),
    resolveCommandSettings: () => ({ agentCmdOverrides: command ? { opencode: command } : {} }),
    resolveCommand: () => '/synthetic-bin/opencode',
    probeVersion: async (_input, supports) => supports('2.0.27')
  })
  return (identity: Parameters<typeof copyAcpConversation>[1]['identity']) => resolver({ identity })
}

function connect() {
  const children: FakeAcpChild[] = []
  const connect = vi.fn((...args: ConstructorParameters<typeof FakeAcpChild>) => {
    const child = new FakeAcpChild(...args)
    child.agent.on('initialize', (frame) =>
      child.agent.reply(frame, {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { fork: {} } }
      })
    )
    child.agent.on('session/fork', (frame) => child.agent.reply(frame, { sessionId: 'copy' }))
    children.push(child)
    return child
  })
  return { connect, children }
}

describe('OpenCode copied CLI server routing', () => {
  it('already refuses a command-string server override in the real native launch resolver before copy', async () => {
    const rig = connect()
    await expect(
      copyAcpConversation(
        {
          spec,
          readLaunch: readLaunch('opencode --server http://synthetic-server'),
          connect: rig.connect
        },
        input,
        { track: () => {} }
      )
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: 'the opencode Command setting is not a runnable program'
      })
    })
    expect(rig.connect).not.toHaveBeenCalled()
  })

  it.each(['--server http://synthetic-server', '--server=http://synthetic-server'])(
    'refuses actual host default arguments before making a copy: %s',
    async (configured) => {
      const host = { agentDefaultArgs: { opencode: configured } }
      const rig = connect()
      const resolveLaunchArgs = vi.fn(() =>
        structuredAgentConfiguredArgs('opencode', host, 'linux')
      )
      await expect(
        copyAcpConversation(
          { spec, readLaunch: readLaunch(), connect: rig.connect, resolveLaunchArgs },
          input,
          { track: () => {} }
        )
      ).rejects.toThrow('Remove --server')
      expect(resolveLaunchArgs).toHaveBeenCalledWith()
      expect(rig.connect).not.toHaveBeenCalled()
    }
  )

  it('does not treat a positional server word as a server route', async () => {
    const rig = connect()
    const resolveLaunchArgs = () => ['--', '--server']
    await expect(
      copyAcpConversation(
        { spec, readLaunch: readLaunch(), connect: rig.connect, resolveLaunchArgs },
        input,
        { track: () => {} }
      )
    ).resolves.toEqual({ sessionId: 'copy' })
    expect(rig.children).toHaveLength(1)
    expect(rig.children[0]?.closes).toBe(1)
  })

  it('bounds a host settings read before any copy child can start', async () => {
    const rig = connect()
    const resolveLaunchArgs = () => new Promise<string[]>(() => {})
    await expect(
      copyAcpConversation(
        { spec, readLaunch: readLaunch(), connect: rig.connect, resolveLaunchArgs },
        input,
        { timeoutMs: 5, track: () => {} }
      )
    ).rejects.toThrow('OpenCode could not copy this chat')
    expect(rig.connect).not.toHaveBeenCalled()
  })
})
