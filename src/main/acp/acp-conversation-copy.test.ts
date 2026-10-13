import { environmentForStructuredOpenCodeAccountHome } from '../opencode/opencode-structured-account-home'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionJournalIdentity } from '../../shared/agent-session-journal-types'
import { acpLaunchSpecFor, type AcpLaunchSpec } from './acp-launch-specs'
import {
  FakeAcpChild,
  openAcpAdapterRig,
  type AcpAdapterRig,
  PROVIDER_SESSION
} from './acp-structured-adapter.test-support'
import { copyAcpConversation } from './acp-conversation-copy'

const resolveFile = vi.hoisted(() =>
  vi.fn(async (): Promise<string | null> => '/account-a/sessions/copy-1.jsonl')
)
vi.mock('../native-chat/session-file-resolver', () => ({ resolveSessionFilePath: resolveFile }))

const accountHome = { variable: 'PI_CODING_AGENT_DIR', path: '/account-a' }
const OMP = acpLaunchSpecFor('omp')!
const OPENCODE = acpLaunchSpecFor('opencode')!
const FORKS = { agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } } }
const FORKS_INITIALIZED = { protocolVersion: 1, ...FORKS }
const identity = (agent: string): AgentSessionJournalIdentity => ({
  sessionId: 'orca-chat-1',
  workspaceId: 'workspace-1',
  hostId: 'local',
  agent,
  providerHandle: null
})

const launchOf = (spec: AcpLaunchSpec) => ({
  spec,
  command: `/opt/bin/${spec.command}`,
  args: ['acp'],
  cwd: '/workspace/project',
  env: { PI_CODING_AGENT_DIR: '/account-a' },
  envToDelete: [],
  fullAccess: false,
  resume: null
})

const rigs: AcpAdapterRig[] = []
afterEach(async () => {
  await Promise.all(rigs.splice(0).map((rig) => rig.adapter.closeAll()))
})

async function open(options: Parameters<typeof openAcpAdapterRig>[0]): Promise<AcpAdapterRig> {
  const rig = await openAcpAdapterRig(options)
  rigs.push(rig)
  return rig
}

describe('copying a chat conversation for the CLI', () => {
  it.each([OMP, OPENCODE])(
    'has $agent copy the conversation under the chat launch and answers the copy',
    async (spec) => {
      const reads: string[] = []
      const rig = await open({
        spec,
        initialize: FORKS,
        deps: {
          // The unsealed launch a recovery read uses, with the keys the host strips from a child.
          readLaunch: async (chat) => {
            reads.push(chat.sessionId)
            return { ...launchOf(spec), envToDelete: ['ORCA_PANE_KEY', 'ORCA_AGENT_HOOK_PORT'] }
          }
        },
        script: (agent) =>
          agent.on('session/fork', (frame) => agent.reply(frame, { sessionId: 'copy-1' }))
      })

      await expect(
        rig.adapter.copyConversation({
          identity: identity(spec.agent),
          providerSessionId: PROVIDER_SESSION,
          accountHome:
            spec.agent === 'omp'
              ? accountHome
              : { kind: 'opencode', locator: { kind: 'unmanaged' } }
        })
      ).resolves.toMatchObject({ sessionId: 'copy-1' })

      if (spec.agent === 'omp') {
        expect(resolveFile).toHaveBeenCalledWith(
          'omp',
          'copy-1',
          { ompSessionsDir: '/account-a/sessions' },
          expect.any(AbortSignal)
        )
      }
      expect(rig.sent('session/fork').map((frame) => frame.params)).toEqual([
        { sessionId: PROVIDER_SESSION, cwd: '/workspace/project', mcpServers: [] }
      ])
      // Only the copy is made: the chat's conversation is never loaded, resumed or prompted.
      expect(rig.child().agent.frames.map((frame) => frame.method)).toEqual([
        'initialize',
        'session/fork'
      ])
      // The short-lived agent is closed, and runs the chat's launch unsealed, for no chat or pane.
      expect(rig.child().closes).toBe(1)
      expect(reads).toEqual(['orca-chat-1'])
      expect(rig.child().launch.envToDelete).toEqual(
        expect.arrayContaining(['ORCA_PANE_KEY', 'ORCA_AGENT_HOOK_PORT'])
      )
    }
  )

  it('returns the matching managed account the OpenCode copy actually used', async () => {
    const pinned = {
      kind: 'opencode' as const,
      locator: {
        kind: 'managed' as const,
        managedProfileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      }
    }
    const environmentForAccount = vi.fn(() => ({
      XDG_DATA_HOME: '/account-a/data',
      XDG_STATE_HOME: '/account-a/state',
      OPENCODE_AUTH_CONTENT: '',
      OPENCODE_DB: 'opencode.db'
    }))
    const spec = {
      ...OPENCODE,
      account: {
        ...OPENCODE.account,
        resolve: async () => ({
          kind: 'opencode' as const,
          locator: {
            kind: 'managed' as const,
            managedProfileId: pinned.locator.managedProfileId
          }
        }),
        environment: (
          home: Parameters<typeof OPENCODE.account.environment>[0],
          env: Record<string, string>
        ) => {
          if (!('kind' in home)) {
            throw new Error('Wrong account kind')
          }
          return environmentForStructuredOpenCodeAccountHome(home, {
            managedAccounts: { environmentForAccount, restoreOriginalEnvironment: () => {} },
            baseEnvironment: env
          })
        }
      }
    }
    const rig = await open({
      spec,
      initialize: FORKS,
      deps: {
        readLaunch: async () => ({
          ...launchOf(spec),
          env: {
            XDG_DATA_HOME: '/account-a/data',
            XDG_STATE_HOME: '/account-a/state',
            ARBITRARY_SECRET: 'test-only',
            ORCA_PANE_KEY: 'source-pane'
          }
        })
      },
      script: (agent) =>
        agent.on('session/fork', (frame) => agent.reply(frame, { sessionId: 'copy-1' }))
    })
    const copy = await rig.adapter.copyConversation({
      identity: identity('opencode'),
      providerSessionId: 'original',
      accountHome: pinned
    })
    expect(copy).toEqual({ sessionId: 'copy-1' })
    expect(copy).not.toHaveProperty('launchConfig')
    expect(copy).not.toHaveProperty('env')
    expect(environmentForAccount).not.toHaveBeenCalled()
  })

  it.each([
    { kind: 'opencode' as const, locator: { kind: 'unmanaged' as const } },
    {
      kind: 'opencode' as const,
      locator: {
        kind: 'managed' as const,
        managedProfileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      }
    }
  ])('refuses an OpenCode account mismatch before copying', async (accountHome) => {
    const spec = {
      ...OPENCODE,
      account: {
        ...OPENCODE.account,
        resolve: async () => ({
          kind: 'opencode' as const,
          locator: {
            kind: 'managed' as const,
            managedProfileId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
          }
        })
      }
    }
    const rig = await open({ spec, initialize: FORKS })
    await expect(
      rig.adapter.copyConversation({
        identity: identity('opencode'),
        providerSessionId: 'original',
        accountHome
      })
    ).rejects.toThrow('Select the account this chat uses')
    expect(rig.spawned).toEqual([])
  })

  it('rederives an account change during fork before admitting the copy to a terminal', async () => {
    const pinned = {
      kind: 'opencode' as const,
      locator: {
        kind: 'managed' as const,
        managedProfileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      }
    }
    let selected = pinned
    const spec = { ...OPENCODE, account: { ...OPENCODE.account, resolve: async () => selected } }
    const rig = await open({
      spec,
      initialize: FORKS,
      script: (agent) =>
        agent.on('session/fork', (frame) => {
          selected = {
            kind: 'opencode',
            locator: { kind: 'managed', managedProfileId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
          }
          agent.reply(frame, { sessionId: 'copy-created-in-a' })
        })
    })
    await expect(
      rig.adapter.copyConversation({
        identity: identity('opencode'),
        providerSessionId: 'original',
        accountHome: pinned
      })
    ).rejects.toThrow('Select the account this chat uses')
    expect(rig.sent('session/fork')).toHaveLength(1)
    expect(rig.child().closes).toBe(1)
  })

  it('refuses an OMP copy whose pinned transcript cannot be resolved', async () => {
    resolveFile.mockResolvedValueOnce(null)
    const rig = await open({
      spec: OMP,
      initialize: FORKS,
      script: (agent) =>
        agent.on('session/fork', (frame) => agent.reply(frame, { sessionId: 'copy-1' }))
    })
    await expect(
      rig.adapter.copyConversation({
        identity: identity('omp'),
        providerSessionId: 'original',
        accountHome
      })
    ).rejects.toThrow('OMP could not copy this chat')
  })

  it.each(['', '  ', ' copy ', '-copy', 'copy\ncontrol', 'x'.repeat(513)])(
    'rejects a malformed provider fork identity',
    async (id) => {
      const rig = await open({
        spec: OPENCODE,
        initialize: FORKS,
        script: (agent) =>
          agent.on('session/fork', (frame) => agent.reply(frame, { sessionId: id }))
      })
      await expect(
        rig.adapter.copyConversation({
          identity: identity('opencode'),
          providerSessionId: 'original',
          accountHome: { kind: 'opencode', locator: { kind: 'unmanaged' } }
        })
      ).rejects.toThrow('OpenCode could not copy this chat')
      expect(rig.child().closes).toBe(1)
    }
  )

  it('copies while the chat runs, beside its own agent and without touching it', async () => {
    const rig = await open({
      spec: OMP,
      initialize: FORKS,
      script: (agent) =>
        agent.on('session/fork', (frame) => agent.reply(frame, { sessionId: 'copy-1' }))
    })
    await rig.acquire()
    const chat = rig.child()

    await rig.adapter.copyConversation({
      identity: identity('omp'),
      providerSessionId: PROVIDER_SESSION,
      accountHome
    })

    expect(rig.child()).not.toBe(chat)
    expect(chat.closes).toBe(0)
    expect(chat.agent.frames.some((frame) => frame.method === 'session/fork')).toBe(false)
  })

  it('asks for an update when the installed agent does not offer the copy', async () => {
    const rig = await open({ spec: OMP, initialize: { agentCapabilities: { loadSession: true } } })

    await expect(
      rig.adapter.copyConversation({
        identity: identity('omp'),
        providerSessionId: 'p',
        accountHome
      })
    ).rejects.toThrow('This OMP version cannot copy a chat. Update OMP to resume this chat')
    expect(rig.sent('session/fork')).toEqual([])
    expect(rig.child().closes).toBe(1)
  })

  it('reports a refused copy in plain words and closes the agent', async () => {
    const rig = await open({
      spec: OPENCODE,
      initialize: FORKS,
      script: (agent) =>
        agent.on('session/fork', (frame) =>
          agent.fail(frame, -32603, 'Internal error: Internal service failure')
        )
    })

    await expect(
      rig.adapter.copyConversation({
        identity: identity('opencode'),
        providerSessionId: 'p',
        accountHome: { kind: 'opencode', locator: { kind: 'unmanaged' } }
      })
    ).rejects.toThrow('OpenCode could not copy this chat.')
    expect(rig.child().closes).toBe(1)
  })

  it('gives up on an agent that never answers, and closes it', async () => {
    const children: FakeAcpChild[] = []
    const deps = {
      spec: OMP,
      readLaunch: async () => launchOf(OMP),
      connect: (...args: ConstructorParameters<typeof FakeAcpChild>) => {
        const child = new FakeAcpChild(...args)
        child.agent.on('initialize', (frame) => child.agent.reply(frame, FORKS_INITIALIZED))
        children.push(child)
        return child
      }
    }

    await expect(
      copyAcpConversation(
        deps,
        { identity: identity('omp'), providerSessionId: 'p', accountHome },
        { timeoutMs: 10, track: () => {} }
      )
    ).rejects.toThrow('OMP could not copy this chat.')
    expect(children.map((child) => child.closes)).toEqual([1])
  })
})
