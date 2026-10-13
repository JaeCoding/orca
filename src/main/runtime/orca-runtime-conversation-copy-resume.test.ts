import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { EnsureAgentSessionParams } from '../../shared/rpc-contract/agent-session-params'

function runtime() {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: explicit resume reads only these settings; terminal creation is mocked.
  const runtime = new OrcaRuntimeService({
    getSettings: () => ({
      agentDefaultArgs: { opencode: '--model host-model' },
      agentDefaultEnv: {
        opencode: {
          OPENCODE_AUTH_CONTENT: 'synthetic-host-auth',
          HOME: '/host-home',
          OPENCODE_CONFIG_DIR: '/host-config'
        },
        omp: { PI_CODING_AGENT_DIR: '/current-omp' }
      }
    })
  } as never)
  Object.assign(runtime, {
    resolveTerminalWorkspaceLaunchScope: async () => ({
      id: 'worktree',
      path: '/repo',
      connectionId: null
    }),
    getAgentLaunchPlatformForWorkspace: () => 'linux'
  })
  const createTerminal = vi.spyOn(runtime, 'createTerminal').mockResolvedValue({
    handle: 'term_copy',
    tabId: 'copy-tab',
    paneKey: 'copy-tab:copy-leaf',
    ptyId: 'copy-pty',
    worktreeId: 'worktree',
    title: null,
    surface: 'background'
  })
  return { runtime, createTerminal }
}

describe('ordinary host resume of a copied conversation', () => {
  it('uses the actual OpenCode executable and preserves private mode plus host custom environment', async () => {
    const rig = runtime()
    await rig.runtime.ensureAgentSession(
      EnsureAgentSessionParams.parse({
        kind: 'explicit',
        worktree: 'id:worktree',
        agent: 'opencode',
        agentArgs: '--standalone',
        providerSession: { key: 'session_id', id: 'copied-session' }
      })
    )
    expect(rig.createTerminal).toHaveBeenCalledWith(
      'id:worktree',
      expect.objectContaining({
        launchAgent: 'opencode',
        command: "opencode '--standalone' '--session' 'copied-session'",
        env: {
          OPENCODE_AUTH_CONTENT: 'synthetic-host-auth',
          HOME: '/host-home',
          OPENCODE_CONFIG_DIR: '/host-config'
        }
      })
    )
  })

  it('opens the OMP copy by its explicit file using the ordinary host environment', async () => {
    const rig = runtime()
    await rig.runtime.ensureAgentSession(
      EnsureAgentSessionParams.parse({
        kind: 'explicit',
        worktree: 'id:worktree',
        agent: 'omp',
        ompResumeFilePath: '/pinned-omp/sessions/copied.jsonl',
        providerSession: { key: 'session_id', id: 'copied-session' }
      })
    )
    expect(rig.createTerminal).toHaveBeenCalledWith(
      'id:worktree',
      expect.objectContaining({
        launchAgent: 'omp',
        command: expect.stringContaining("'--resume' '/pinned-omp/sessions/copied.jsonl'"),
        env: { PI_CODING_AGENT_DIR: '/current-omp' }
      })
    )
  })
})
