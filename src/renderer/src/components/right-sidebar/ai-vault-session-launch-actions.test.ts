import type * as ForkStartup from '@/lib/ai-vault-session-fork-startup'
// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import type { WebRuntimeTerminalCreateOutcome } from '@/runtime/web-runtime-session-types'

const mocks = vi.hoisted(() => ({
  buildAiVaultForkStartupForWorktree: vi.fn(),
  getState: vi.fn(),
  buildAiVaultResumeStartupForWorktree: vi.fn(),
  prepareAiVaultSessionForFork: vi.fn(),
  prepareAiVaultSessionForResume: vi.fn(),
  launchAiVaultSessionInNewTab: vi.fn(),
  activateAiVaultResumeWorkspace: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@/lib/ai-vault-session-fork-startup', async (importOriginal) => ({
  ...(await importOriginal<typeof ForkStartup>()),
  buildAiVaultCopiedSessionStartupForWorktree: (args: { session: AiVaultSession }) => ({
    ...mocks.buildAiVaultResumeStartupForWorktree(args),
    agent: args.session.agent
  }),
  buildAiVaultForkStartupForWorktree: mocks.buildAiVaultForkStartupForWorktree
}))
vi.mock('@/lib/ai-vault-resume-command', () => ({
  resolveAiVaultResumeHost: () => ({ platform: 'linux', codexHome: null, liveShell: undefined }),
  buildAiVaultResumeStartupForWorktree: mocks.buildAiVaultResumeStartupForWorktree,
  buildAiVaultResumeCopyCommandForWorktree: vi.fn()
}))
vi.mock('@/lib/ai-vault-session-resume-preparation', () => ({
  prepareAiVaultSessionForFork: mocks.prepareAiVaultSessionForFork,
  prepareAiVaultSessionForResume: mocks.prepareAiVaultSessionForResume,
  dropDeletedSshResumeCwd: async (session: unknown) => session,
  aiVaultCliForkHostTooOldMessage: () =>
    'Update Orca on the host that runs this chat to resume it in a new CLI.'
}))
vi.mock('@/lib/launch-ai-vault-session', () => ({
  launchAiVaultSessionInNewTab: mocks.launchAiVaultSessionInNewTab
}))
vi.mock('./ai-vault-session-launch-target', () => ({
  resolveAiVaultSessionLaunchTarget: (args: { targetWorktreeId?: string }) => ({
    status: 'ready',
    worktreeId: args.targetWorktreeId
  }),
  resolveAiVaultTargetWorkspacePath: vi.fn(),
  aiVaultResumeUnsupportedMessage: vi.fn()
}))
vi.mock('./ai-vault-session-resume-in-chat-launch', () => ({
  activateAiVaultResumeWorkspace: mocks.activateAiVaultResumeWorkspace,
  resumeAiVaultSessionInNewChat: vi.fn()
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }))
vi.mock('@/store', () => ({
  useAppStore: { getState: mocks.getState }
}))

import { useAiVaultSessionLaunchActions } from './ai-vault-session-launch-actions'

const owned: AiVaultSession = {
  id: 'local:claude:provider-1:/p.jsonl',
  executionHostId: 'local',
  agent: 'claude',
  sessionId: 'provider-1',
  title: 'Claude Chat',
  cwd: '/repo',
  branch: null,
  model: null,
  filePath: '/p.jsonl',
  codexHome: null,
  createdAt: null,
  updatedAt: null,
  modifiedAt: '2026-10-07T00:00:00.000Z',
  messageCount: 1,
  totalTokens: 0,
  previewMessages: [],
  queuedMessageCount: 0,
  subagentTranscriptCount: 0,
  resumeCommand: 'claude --resume provider-1',
  subagent: null,
  structuredSession: { sessionId: 'chat-1', workspaceId: 'worktree-1' }
}

const FORK_STARTUP = { command: "claude --resume 'provider-1' --fork-session", cwd: '/repo' }

function renderActions(agentCmdOverrides?: { opencode?: string }) {
  return renderHook(() =>
    useAiVaultSessionLaunchActions({
      activeWorktree: null,
      activeWorktreeId: 'worktree-1',
      agentCmdOverrides,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mocked launch target never reads it.
      targetState: {} as never
    })
  ).result.current
}

describe('Resume in New CLI launch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getState.mockReturnValue({ activeWorktreeId: 'worktree-1', settings: {} })
    mocks.prepareAiVaultSessionForFork.mockImplementation(async (session) => ({
      session,
      copied: false
    }))
    mocks.buildAiVaultForkStartupForWorktree.mockReturnValue(FORK_STARTUP)
    mocks.launchAiVaultSessionInNewTab.mockReturnValue({ tabId: 'tab-1' })
  })

  it.each(['command', 'arguments'] as const)(
    'refuses effective OpenCode %s server routing before asking for any copy',
    async (location) => {
      const chat = { ...owned, agent: 'opencode2' as const }
      mocks.getState.mockReturnValue({
        activeWorktreeId: 'worktree-1',
        settings: {
          agentDefaultArgs:
            location === 'arguments' ? { opencode: '--server=http://synthetic-server' } : {}
        }
      })
      renderActions(
        location === 'command'
          ? { opencode: 'opencode --server http://synthetic-server' }
          : undefined
      ).handleResumeInNewCli(chat, 'worktree-2')
      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
      expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining('Remove --server'))
      expect(mocks.prepareAiVaultSessionForFork).not.toHaveBeenCalled()
      expect(mocks.launchAiVaultSessionInNewTab).not.toHaveBeenCalled()
    }
  )

  it('leaves ordinary resumes on their configured server route', async () => {
    const session = { ...owned, agent: 'opencode' as const, structuredSession: undefined }
    mocks.getState.mockReturnValue({
      activeWorktreeId: 'worktree-1',
      settings: { agentDefaultArgs: { opencode: '--server http://synthetic-server' } }
    })
    mocks.prepareAiVaultSessionForResume.mockResolvedValue(session)
    mocks.buildAiVaultResumeStartupForWorktree.mockReturnValue({
      command: 'opencode --server http://synthetic-server --session existing'
    })
    renderActions().handleResume(session, 'worktree-2')
    await waitFor(() => expect(mocks.launchAiVaultSessionInNewTab).toHaveBeenCalledTimes(1))
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('opens the fork plan in the chosen workspace, never the plain resume plan', async () => {
    renderActions().handleResumeInNewCli(owned, 'worktree-2')

    await waitFor(() => expect(mocks.launchAiVaultSessionInNewTab).toHaveBeenCalledTimes(1))
    expect(mocks.prepareAiVaultSessionForFork).toHaveBeenCalledWith(owned)
    expect(mocks.buildAiVaultForkStartupForWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'worktree-2', session: owned })
    )
    expect(mocks.launchAiVaultSessionInNewTab).toHaveBeenCalledWith({
      agent: 'claude',
      worktreeId: 'worktree-2',
      ...FORK_STARTUP
    })
    expect(mocks.activateAiVaultResumeWorkspace).toHaveBeenCalledWith('worktree-2')
    expect(mocks.prepareAiVaultSessionForResume).not.toHaveBeenCalled()
    expect(mocks.buildAiVaultResumeStartupForWorktree).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it("opens the copy an OpenCode or OMP chat's host made with a plain resume", async () => {
    const chat = { ...owned, agent: 'omp' as const, resumeCommand: 'omp --resume provider-1' }
    const copy = { ...chat, sessionId: 'copy-1', filePath: '', resumeCommand: '' }
    const RESUME_STARTUP = { command: "omp --resume 'copy-1'", cwd: '/repo' }
    mocks.prepareAiVaultSessionForFork.mockResolvedValue({ session: copy, copied: true })
    mocks.buildAiVaultResumeStartupForWorktree.mockReturnValue(RESUME_STARTUP)

    renderActions().handleResumeInNewCli(chat, 'worktree-2')

    await waitFor(() => expect(mocks.launchAiVaultSessionInNewTab).toHaveBeenCalledTimes(1))
    expect(mocks.buildAiVaultResumeStartupForWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'worktree-2', session: copy })
    )
    expect(mocks.buildAiVaultForkStartupForWorktree).not.toHaveBeenCalled()
    expect(mocks.launchAiVaultSessionInNewTab).toHaveBeenCalledWith({
      agent: 'omp',
      worktreeId: 'worktree-2',
      ...RESUME_STARTUP
    })
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('launches an OpenCode 2 copy as its actual opencode provider', async () => {
    const chat = { ...owned, agent: 'opencode2' as const }
    const copy = {
      ...chat,
      agent: 'opencode' as const,
      sessionId: 'copy-1',
      filePath: '',
      resumeCommand: ''
    }
    const launchConfig = {
      agentArgs: '',
      agentEnv: { XDG_DATA_HOME: '/account-a/data', XDG_STATE_HOME: '/account-a/state' }
    }
    mocks.prepareAiVaultSessionForFork.mockResolvedValue({
      session: copy,
      copied: true
    })
    mocks.buildAiVaultResumeStartupForWorktree.mockReturnValue({
      command: 'opencode --session copy-1',
      launchConfig,
      providerSession: { key: 'session_id', id: 'copy-1' }
    })
    renderActions().handleResumeInNewCli(chat, 'worktree-2')
    await waitFor(() => expect(mocks.launchAiVaultSessionInNewTab).toHaveBeenCalledTimes(1))
    expect(mocks.buildAiVaultResumeStartupForWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ session: copy })
    )
    expect(mocks.launchAiVaultSessionInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'opencode',
        launchConfig,
        providerSession: { key: 'session_id', id: 'copy-1' }
      })
    )
  })

  it('shows one toast and opens nothing when the agent cannot fork', async () => {
    mocks.buildAiVaultForkStartupForWorktree.mockReturnValue(null)

    renderActions().handleResumeInNewCli(owned, 'worktree-2')

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
    expect(mocks.toastError).toHaveBeenCalledWith('This session cannot be opened in the CLI.')
    expect(mocks.launchAiVaultSessionInNewTab).not.toHaveBeenCalled()
  })

  // A host whose guard predates the fork refuses it as a second writer.
  it('asks for a host update, once, when an older paired host refuses the fork', async () => {
    mocks.launchAiVaultSessionInNewTab.mockReturnValue({
      tabId: null,
      runtimeLaunch: Promise.resolve<WebRuntimeTerminalCreateOutcome>({
        status: 'failed',
        message: 'agent_session_conflict'
      })
    })

    renderActions().handleResumeInNewCli(owned, 'worktree-2')

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Update Orca on the host that runs this chat to resume it in a new CLI.'
    )
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('asks for a host update when an older paired host refuses the fork preparation', async () => {
    mocks.prepareAiVaultSessionForFork.mockRejectedValue(new Error('agent_session_conflict'))

    renderActions().handleResumeInNewCli(owned, 'worktree-2')

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Update Orca on the host that runs this chat to resume it in a new CLI.'
    )
    expect(mocks.launchAiVaultSessionInNewTab).not.toHaveBeenCalled()
  })
})
