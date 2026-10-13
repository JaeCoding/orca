// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aiVaultAgentLabel, type AiVaultSession } from '../../../../shared/ai-vault-types'
import type { WebRuntimeTerminalCreateOutcome } from '@/runtime/web-runtime-session-types'

const mocks = vi.hoisted(() => ({
  buildAiVaultForkStartupForWorktree: vi.fn(),
  buildAiVaultResumeCopyCommandForWorktree: vi.fn(),
  buildAiVaultResumeStartupForWorktree: vi.fn(),
  prepareAiVaultSessionForFork: vi.fn(),
  prepareAiVaultSessionForResume: vi.fn(),
  prepareAiVaultSessionForTerminalResume: vi.fn(),
  launchAiVaultSessionInNewTab: vi.fn(),
  activateAiVaultResumeWorkspace: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@/lib/ai-vault-session-fork-startup', () => ({
  buildAiVaultForkStartupForWorktree: mocks.buildAiVaultForkStartupForWorktree
}))
vi.mock('@/lib/ai-vault-resume-command', () => ({
  buildAiVaultResumeStartupForWorktree: mocks.buildAiVaultResumeStartupForWorktree,
  buildAiVaultResumeCopyCommandForWorktree: mocks.buildAiVaultResumeCopyCommandForWorktree
}))
vi.mock('@/lib/ai-vault-session-resume-preparation', () => ({
  prepareAiVaultSessionForFork: mocks.prepareAiVaultSessionForFork,
  prepareAiVaultSessionForResume: mocks.prepareAiVaultSessionForResume,
  prepareAiVaultSessionForTerminalResume: mocks.prepareAiVaultSessionForTerminalResume,
  dropDeletedSshResumeCwd: async (session: unknown) => session
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
  useAppStore: { getState: () => ({ activeWorktreeId: 'worktree-1', settings: {} }) }
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

function renderActions() {
  return renderHook(() =>
    useAiVaultSessionLaunchActions({
      activeWorktree: null,
      activeWorktreeId: 'worktree-1',
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mocked launch target never reads it.
      targetState: {} as never
    })
  ).result.current
}

describe('Resume in New CLI launch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prepareAiVaultSessionForFork.mockImplementation(async (session) => session)
    mocks.buildAiVaultForkStartupForWorktree.mockReturnValue(FORK_STARTUP)
    mocks.launchAiVaultSessionInNewTab.mockReturnValue({ tabId: 'tab-1' })
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

describe('stale ordinary Resume', () => {
  beforeEach(() => vi.clearAllMocks())

  it('launches an old paired-host row in its chosen paired workspace after preparation falls back', async () => {
    const remote = {
      ...owned,
      structuredSession: undefined,
      executionHostId: 'runtime:paired' as const
    }
    mocks.prepareAiVaultSessionForTerminalResume.mockResolvedValue(remote)
    mocks.buildAiVaultResumeStartupForWorktree.mockReturnValue({
      command: 'claude --resume provider-1'
    })
    mocks.launchAiVaultSessionInNewTab.mockReturnValue({ tabId: 'tab-1' })

    renderActions().handleResume(remote, 'paired-worktree')

    await waitFor(() => expect(mocks.launchAiVaultSessionInNewTab).toHaveBeenCalledOnce())
    expect(mocks.prepareAiVaultSessionForTerminalResume).toHaveBeenCalledWith(remote)
    expect(mocks.buildAiVaultResumeStartupForWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ session: remote, worktreeId: 'paired-worktree' })
    )
    expect(mocks.launchAiVaultSessionInNewTab).toHaveBeenCalledWith({
      agent: 'claude',
      worktreeId: 'paired-worktree',
      command: 'claude --resume provider-1'
    })
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it.each(['claude', 'omp', 'codex'] as const)(
    'refuses a stale %s row before creating a terminal',
    async (agent) => {
      const stale = { ...owned, agent, structuredSession: undefined }
      mocks.prepareAiVaultSessionForTerminalResume.mockRejectedValue(
        new Error(
          "Error invoking remote method 'aiVault:prepareSessionResume': Error: agent_session_conflict"
        )
      )
      renderActions().handleResume(stale, 'worktree-1')

      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
      expect(mocks.prepareAiVaultSessionForTerminalResume).toHaveBeenCalledWith(stale)
      expect(mocks.prepareAiVaultSessionForResume).not.toHaveBeenCalled()
      expect(mocks.toastError).toHaveBeenCalledWith(
        `This ${aiVaultAgentLabel(agent)} conversation is open in a chat. Refresh Session History to open it.`
      )
      expect(mocks.launchAiVaultSessionInNewTab).not.toHaveBeenCalled()
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
    }
  )

  it('explains unknown ownership without claiming a chat is open', async () => {
    const stale = { ...owned, agent: 'omp' as const, structuredSession: undefined }
    mocks.prepareAiVaultSessionForTerminalResume.mockRejectedValue(
      new Error('agent_session_ownership_unknown')
    )
    renderActions().handleResume(stale, 'worktree-1')

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce())
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Orca could not confirm who owns this OMP conversation. Refresh Session History and try again.'
    )
    expect(mocks.launchAiVaultSessionInNewTab).not.toHaveBeenCalled()
  })
})

describe('Copy Resume Command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('copies a stale-owned row through home preparation without terminal admission', async () => {
    const stale = { ...owned, structuredSession: undefined }
    const writeClipboardText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ui: { writeClipboardText } }
    })
    mocks.prepareAiVaultSessionForResume.mockResolvedValue(stale)
    mocks.buildAiVaultResumeCopyCommandForWorktree.mockReturnValue('claude --resume provider-1')

    await renderActions().copyResumeCommand(stale, 'worktree-1')

    expect(mocks.prepareAiVaultSessionForResume).toHaveBeenCalledWith(stale)
    expect(mocks.prepareAiVaultSessionForTerminalResume).not.toHaveBeenCalled()
    expect(writeClipboardText).toHaveBeenCalledWith('claude --resume provider-1')
    expect(mocks.launchAiVaultSessionInNewTab).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Resume command copied')
  })

  it('gives a next step if home preparation cannot confirm ownership', async () => {
    const stale = { ...owned, agent: 'codex' as const, structuredSession: undefined }
    mocks.prepareAiVaultSessionForResume.mockRejectedValue(
      new Error('agent_session_ownership_unknown')
    )

    await renderActions().copyResumeCommand(stale, 'worktree-1')

    expect(mocks.toastError).toHaveBeenCalledWith(
      'Orca could not confirm who owns this Codex conversation. Refresh Session History and try again.'
    )
    expect(mocks.buildAiVaultResumeCopyCommandForWorktree).not.toHaveBeenCalled()
  })
})
