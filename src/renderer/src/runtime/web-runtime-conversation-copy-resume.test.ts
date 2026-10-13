import { buildAiVaultCopiedSessionStartupForWorktree } from '@/lib/ai-vault-session-fork-startup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as TrackingDecisions from './web-session-tabs-sync/tracking-decisions'
import { createWebRuntimeSessionTerminal } from './web-runtime-terminal-creation'
import { resetWebSessionCloseIntentForTests } from './web-session-close-intent'
import {
  ENVIRONMENT_ID,
  FOCUS_LEAF_ID,
  WORKTREE_ID,
  makeSnapshot,
  resetTerminalCreateEnvironment,
  stubTerminalCreateEnvironment
} from './web-runtime-session-test-harness'
import { stubRuntimeEnvironmentBridge } from './runtime-environment-bridge-fixture'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  setState: vi.fn(),
  subscribe: vi.fn(),
  setActiveWorktree: vi.fn(),
  createBrowserTab: vi.fn(),
  closeEmptyGroup: vi.fn(),
  moveUnifiedTabToGroup: vi.fn(),
  setRemoteBrowserPageHandle: vi.fn(),
  focusBrowserTabInWorktree: vi.fn(),
  applyWebSessionTabsSnapshot: vi.fn(),
  decideWebSessionTabsSnapshot: vi.fn(() => ({ apply: true, settlesHostMirror: true })),
  getWebSessionTabsTrackingGeneration: vi.fn(() => 0),
  acceptReplayedWebSessionTabsSnapshot: vi.fn(),
  resolveHostSessionTabIdForWebSessionTab: vi.fn(),
  trackTerminalPaneSplit: vi.fn(),
  deliverLaunchPromptToAgentTab: vi.fn(),
  seedNativeChatLaunchDraftForAgentTab: vi.fn(),
  getRuntimeEnvironmentIdForWorktree: vi.fn(),
  hasMaterializedWebRuntimeBrowserPage: vi.fn()
}))

vi.mock('../store', () => ({
  useAppStore: {
    getState: mocks.getState,
    setState: mocks.setState,
    subscribe: mocks.subscribe
  }
}))

vi.mock('./web-session-tabs-sync/tracking-lifecycle', () => ({
  acceptReplayedWebSessionTabsSnapshot: mocks.acceptReplayedWebSessionTabsSnapshot,
  getWebSessionTabsTrackingGeneration: mocks.getWebSessionTabsTrackingGeneration
}))
vi.mock('./web-session-tabs-sync/snapshot-api', () => ({
  applyWebSessionTabsSnapshot: mocks.applyWebSessionTabsSnapshot
}))
vi.mock('./web-session-tabs-sync/tracking-decisions', async (importOriginal) => ({
  ...(await importOriginal<typeof TrackingDecisions>()),
  decideWebSessionTabsSnapshot: mocks.decideWebSessionTabsSnapshot
}))
vi.mock('./web-session-tabs-sync/store-patch', () => ({
  applyWebSessionTabsStorePatch: (buildPatch: (state: unknown) => unknown) => {
    mocks.setState(buildPatch)
    // The production caller invokes the returned settle receipt.
    return () => {}
  }
}))
vi.mock('./web-session-tabs-sync/tracking-mappings', () => ({
  resolveHostSessionTabIdForWebSessionTab: mocks.resolveHostSessionTabIdForWebSessionTab
}))

vi.mock('@/lib/feature-education-telemetry', () => ({
  trackTerminalPaneSplit: mocks.trackTerminalPaneSplit
}))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: mocks.getRuntimeEnvironmentIdForWorktree
}))

vi.mock('@/lib/agent-launch-prompt-delivery', () => ({
  deliverLaunchPromptToAgentTab: mocks.deliverLaunchPromptToAgentTab,
  seedNativeChatLaunchDraftForAgentTab: mocks.seedNativeChatLaunchDraftForAgentTab
}))

vi.mock('./web-runtime-browser-materialization', () => ({
  hasMaterializedWebRuntimeBrowserPage: mocks.hasMaterializedWebRuntimeBrowserPage
}))

afterEach(() => resetWebSessionCloseIntentForTests())

describe('copied conversation ordinary host resume', () => {
  beforeEach(() => stubTerminalCreateEnvironment(mocks))
  afterEach(() => resetTerminalCreateEnvironment())

  it.each([
    { agent: 'opencode' as const, sourceAgent: 'opencode2' as const, filePath: undefined },
    {
      agent: 'omp' as const,
      sourceAgent: 'omp' as const,
      filePath: '/pinned-omp/sessions/copy.jsonl'
    }
  ])(
    'sends the actual $agent provider, mode and copied file through the ordinary host request',
    async ({ agent, sourceAgent, filePath }) => {
      const state = mocks.getState()
      Object.assign(state, {
        settings: {
          ...state.settings,
          agentDefaultEnv: {
            opencode: { OPENCODE_AUTH_CONTENT: 'synthetic-client-auth', HOME: '/client-home' }
          }
        }
      })
      const startup = buildAiVaultCopiedSessionStartupForWorktree(
        {
          state,
          worktreeId: WORKTREE_ID,
          session: {
            agent,
            sessionId: 'copy-session',
            filePath,
            cwd: '/repo',
            codexHome: null,
            executionHostId: 'runtime:web-env-1',
            executionHostPlatform: 'linux'
          }
        },
        sourceAgent
      )
      const runtimeCall = vi.fn(async (request: { method: string }) => {
        if (request.method === 'status.get') {
          return {
            id: 'status',
            ok: true,
            result: {
              runtimeId: 'runtime-1',
              graphStatus: 'ready',
              runtimeProtocolVersion: 3,
              minCompatibleRuntimeClientVersion: 2,
              capabilities: ['agent-session.host-authority.v1', 'agent-session.omp-resume-path.v1']
            }
          }
        }
        if (request.method === 'terminal.ensureAgentSession') {
          return {
            id: 'resume',
            ok: true,
            result: {
              terminal: {
                handle: 'term_copy',
                worktreeId: WORKTREE_ID,
                tabId: 'host-copy',
                paneKey: `host-copy:${FOCUS_LEAF_ID}`
              },
              disposition: 'created'
            }
          }
        }
        return { id: 'list', ok: true, result: makeSnapshot() }
      })
      stubRuntimeEnvironmentBridge({ call: runtimeCall })
      await expect(
        createWebRuntimeSessionTerminal({
          worktreeId: WORKTREE_ID,
          environmentId: ENVIRONMENT_ID,
          agentSessionKind: 'resume',
          launchAgent: agent,
          ...startup
        })
      ).resolves.toEqual({ status: 'created' })
      const request = runtimeCall.mock.calls.find(
        ([request]) => request.method === 'terminal.ensureAgentSession'
      )?.[0]
      expect(request).toMatchObject({
        params: {
          agent,
          providerSession: { key: 'session_id', id: 'copy-session' },
          ...(filePath
            ? { ompResumeFilePath: filePath }
            : { agentArgs: expect.stringContaining('--standalone') })
        }
      })
      expect(request).not.toHaveProperty('params.commandPath')
      expect(request).not.toHaveProperty('params.launchConfig')
      expect(JSON.stringify(request)).not.toContain('synthetic-client-auth')
      expect(JSON.stringify(request)).not.toContain('/client-home')
    }
  )
})
