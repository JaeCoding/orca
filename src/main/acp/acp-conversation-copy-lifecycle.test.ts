import { afterEach, describe, expect, it, vi } from 'vitest'
import { acpLaunchSpecFor } from './acp-launch-specs'
import { copyAcpConversation } from './acp-conversation-copy'
import {
  openAcpAdapterRig,
  type FakeAcpChild,
  type AcpAdapterRig
} from './acp-structured-adapter.test-support'

vi.mock('../native-chat/session-file-resolver', () => ({
  resolveSessionFilePath: async () => '/pinned/sessions/copy.jsonl'
}))

const spec = acpLaunchSpecFor('omp')!
const FORKS = { agentCapabilities: { sessionCapabilities: { fork: {} } } }
const input = {
  identity: {
    sessionId: 'chat',
    workspaceId: 'workspace',
    hostId: 'local',
    agent: 'omp',
    providerHandle: null
  },
  providerSessionId: 'original',
  accountHome: { variable: 'PI_CODING_AGENT_DIR', path: '/pinned' }
}
const rigs: AcpAdapterRig[] = []
afterEach(async () => {
  await Promise.all(rigs.splice(0).map((rig) => rig.adapter.closeAll()))
})
async function open(script: (agent: FakeAcpChild['agent']) => void) {
  const rig = await openAcpAdapterRig({ spec, initialize: FORKS, script })
  rigs.push(rig)
  return rig
}

function forkResponse(id: string) {
  return (agent: FakeAcpChild['agent']) =>
    agent.on('session/fork', (frame) => agent.reply(frame, { sessionId: id }))
}

describe('ACP copy cleanup ownership', () => {
  it('retains a failed cleanup, permits another copy, and retries at shutdown', async () => {
    let reply = false
    const rig = await open((agent) =>
      agent.on('session/fork', (frame) => {
        if (reply) {
          agent.reply(frame, { sessionId: 'copy' })
        }
      })
    )
    const connecting = rig.adapter.copyConversation(input)
    await vi.waitFor(() => expect(rig.sent('session/fork')).toHaveLength(1))
    const child = rig.child()
    child.proveClose = async () => false
    child.agent.reply(rig.sent('session/fork')[0]!, { sessionId: 'copy' })
    await expect(connecting).resolves.toHaveProperty('sessionId', 'copy')
    reply = true
    await expect(rig.adapter.copyConversation(input)).resolves.toHaveProperty('sessionId', 'copy')
    expect(child.closes).toBe(1)
    child.proveClose = async () => {
      child.exit()
      return true
    }
    await rig.adapter.closeAll()
    expect(child.closes).toBe(2)
  })

  it('rederives a retained child exit before shutdown instead of retrying a dead child', async () => {
    const rig = await open(() => {})
    const copying = rig.adapter.copyConversation(input)
    await vi.waitFor(() => expect(rig.sent('session/fork')).toHaveLength(1))
    const child = rig.child()
    child.proveClose = async () => false
    child.agent.reply(rig.sent('session/fork')[0]!, { sessionId: 'copy' })
    await copying
    child.exit()
    await rig.adapter.closeAll()
    expect(child.closes).toBe(1)
  })

  it('settles an active fork before shutdown retries its failed cleanup', async () => {
    const rig = await open(() => {})
    const copying = rig.adapter.copyConversation(input)
    const rejected = expect(copying).rejects.toThrow('OMP could not copy this chat')
    await vi.waitFor(() => expect(rig.sent('session/fork')).toHaveLength(1))
    const child = rig.child()
    child.proveClose = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockImplementation(async () => {
        child.exit()
        return true
      })
    await rig.adapter.closeAll()
    await rejected
    expect(child.closes).toBe(2)
  })

  it('rejects the source identity before handing the result to a terminal', async () => {
    const rig = await open(forkResponse('original'))
    await expect(rig.adapter.copyConversation(input)).rejects.toThrow(
      'OMP could not copy this chat'
    )
    expect(rig.child().closes).toBe(1)
  })

  it('bounds launch resolution and never starts a late child', async () => {
    let resolveLaunch: (
      launch: Awaited<ReturnType<Parameters<typeof copyAcpConversation>[0]['readLaunch']>>
    ) => void = () => {}
    const readLaunch = new Promise<
      Awaited<ReturnType<Parameters<typeof copyAcpConversation>[0]['readLaunch']>>
    >((resolve) => {
      resolveLaunch = resolve
    })
    const connect = vi.fn()
    await expect(
      copyAcpConversation({ spec, readLaunch: () => readLaunch, connect }, input, {
        timeoutMs: 5,
        track: () => {}
      })
    ).rejects.toThrow('OMP could not copy this chat')
    resolveLaunch({
      spec,
      command: 'fake',
      args: [],
      cwd: '/repo',
      env: {},
      envToDelete: [],
      fullAccess: false,
      resume: null
    })
    await Promise.resolve()
    expect(connect).not.toHaveBeenCalled()
  })

  it('shutdown during launch resolution prevents any child even when the launch resolves later', async () => {
    let resolveLaunch: (
      launch: Awaited<ReturnType<Parameters<typeof copyAcpConversation>[0]['readLaunch']>>
    ) => void = () => {}
    const readLaunch = new Promise<
      Awaited<ReturnType<Parameters<typeof copyAcpConversation>[0]['readLaunch']>>
    >((resolve) => {
      resolveLaunch = resolve
    })
    const rig = await openAcpAdapterRig({ spec, deps: { readLaunch: () => readLaunch } })
    rigs.push(rig)
    const copying = rig.adapter.copyConversation(input)
    const rejected = expect(copying).rejects.toThrow('OMP could not copy this chat')
    await rig.adapter.closeAll()
    await rejected
    resolveLaunch({
      spec,
      command: 'fake',
      args: [],
      cwd: '/repo',
      env: {},
      envToDelete: [],
      fullAccess: false,
      resume: null
    })
    await Promise.resolve()
    expect(rig.spawned).toHaveLength(0)
  })
})
