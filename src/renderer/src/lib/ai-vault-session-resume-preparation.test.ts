import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../../shared/ai-vault-types'
import {
  dropDeletedSshResumeCwd,
  prepareAiVaultSessionForFork,
  prepareAiVaultSessionForResume,
  prepareAiVaultSessionForTerminalResume
} from './ai-vault-session-resume-preparation'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prepareAiVaultSessionForResume', () => {
  it('returns a real-home launch identity only after targeted materialization succeeds', async () => {
    const prepareSessionResume = vi.fn().mockResolvedValue({ useRealCodexHome: true })
    stubPreparation(prepareSessionResume)
    const legacy = session({
      codexHome: '/Users/ada/Library/Application Support/orca/codex-runtime-home/home'
    })

    const prepared = await prepareAiVaultSessionForResume(legacy)

    expect(prepared.codexHome).toBeNull()
    expect(prepareSessionResume).toHaveBeenCalledWith({
      agent: 'codex',
      sessionId: legacy.sessionId,
      filePath: legacy.filePath,
      codexHome: legacy.codexHome,
      executionHostId: 'local'
    })
  })

  it('rejects without changing the launch identity when materialization fails', async () => {
    stubPreparation(vi.fn().mockRejectedValue(new Error('Retry resume.')))

    await expect(
      prepareAiVaultSessionForResume(session({ codexHome: '/tmp/orca/codex-runtime-home/home' }))
    ).rejects.toThrow('Retry resume.')
  })

  it('preserves a custom home without a host request', async () => {
    const prepareSessionResume = vi.fn().mockRejectedValue(new Error('agent_session_conflict'))
    stubPreparation(prepareSessionResume)
    const current = session({ codexHome: '/custom/codex' })

    await expect(prepareAiVaultSessionForResume(current)).resolves.toBe(current)
    expect(prepareSessionResume).not.toHaveBeenCalled()
  })

  it('does not prepare a legacy CLI resume for a native structured session', async () => {
    const prepareSessionResume = vi.fn()
    stubPreparation(prepareSessionResume)
    const native = session({
      codexHome: '/tmp/orca/codex-runtime-home/home',
      structuredSession: { sessionId: 'session-1', workspaceId: 'worktree-1' }
    })

    await expect(prepareAiVaultSessionForResume(native)).resolves.toBe(native)
    expect(prepareSessionResume).not.toHaveBeenCalled()
  })

  it('repins a per-account session to the home the host substitutes', async () => {
    const prepareSessionResume = vi.fn().mockResolvedValue({
      useRealCodexHome: false,
      substituteCodexHome: '/tmp/orca/codex-accounts/account-2/home'
    })
    stubPreparation(prepareSessionResume)
    const current = session({ codexHome: '/tmp/orca/codex-accounts/account-1/home' })

    const prepared = await prepareAiVaultSessionForResume(current)

    expect(prepared.codexHome).toBe('/tmp/orca/codex-accounts/account-2/home')
    expect(prepareSessionResume).toHaveBeenCalledWith({
      agent: 'codex',
      sessionId: current.sessionId,
      filePath: current.filePath,
      codexHome: current.codexHome,
      executionHostId: 'local'
    })
  })

  it('keeps a per-account session unchanged when the host declines to repin', async () => {
    stubPreparation(vi.fn().mockResolvedValue({ useRealCodexHome: false }))
    const current = session({ codexHome: '/tmp/orca/codex-accounts/account-1/home' })

    await expect(prepareAiVaultSessionForResume(current)).resolves.toBe(current)
  })

  it('preserves a remote session home without a host request', async () => {
    const prepareSessionResume = vi.fn().mockRejectedValue(new Error('agent_session_conflict'))
    stubPreparation(prepareSessionResume)
    const current = session({
      codexHome: '/home/user/.orca/codex-accounts/account-1/home',
      executionHostId: 'ssh:server-1' as AiVaultSession['executionHostId']
    })

    await expect(prepareAiVaultSessionForResume(current)).resolves.toBe(current)
    expect(prepareSessionResume).not.toHaveBeenCalled()
  })

  it.each(['claude', 'omp', 'codex'] as const)(
    'keeps the home-only path for a stale-owned %s row when copying or opening native chat',
    async (agent) => {
      const prepareSessionResume = vi.fn().mockRejectedValue(new Error('agent_session_conflict'))
      stubPreparation(prepareSessionResume)
      const stale = session({ agent, codexHome: null })

      await expect(prepareAiVaultSessionForResume(stale)).resolves.toBe(stale)
      expect(prepareSessionResume).not.toHaveBeenCalled()
    }
  )
})

describe('prepareAiVaultSessionForTerminalResume', () => {
  it.each([
    [
      'desktop',
      new Error(
        "Error invoking remote method 'aiVault:prepareSessionResume': Error: aiVault.prepareSessionResume: method_not_found"
      )
    ],
    [
      'web',
      Object.assign(new Error('Unknown method: aiVault.prepareSessionResume'), {
        code: 'method_not_found'
      })
    ]
  ])(
    'continues ordinary paired Resume after the exact %s old-host refusal',
    async (_client, error) => {
      const prepareSessionResume = vi.fn().mockRejectedValue(error)
      stubPreparation(prepareSessionResume)
      const remote = session({ agent: 'claude', executionHostId: 'runtime:paired' })

      await expect(prepareAiVaultSessionForTerminalResume(remote)).resolves.toBe(remote)
      expect(prepareSessionResume).toHaveBeenCalledWith(
        expect.objectContaining({ executionHostId: 'runtime:paired', codexHome: null })
      )
    }
  )

  it.each(['claude', 'omp', 'codex'] as const)(
    'checks a stale %s row before any CLI launch can be planned',
    async (agent) => {
      const prepareSessionResume = vi.fn().mockRejectedValue(new Error('agent_session_conflict'))
      stubPreparation(prepareSessionResume)
      const stale = session({ agent, codexHome: null })

      await expect(prepareAiVaultSessionForTerminalResume(stale)).rejects.toThrow(
        'agent_session_conflict'
      )
      expect(prepareSessionResume).toHaveBeenCalledWith({
        agent,
        sessionId: stale.sessionId,
        filePath: stale.filePath,
        codexHome: null,
        executionHostId: 'local'
      })
    }
  )

  it('keeps a paired non-Codex row when an older host returns only the original neutral result', async () => {
    const prepareSessionResume = vi.fn().mockResolvedValue({ useRealCodexHome: false })
    stubPreparation(prepareSessionResume)
    const remote = session({
      agent: 'claude',
      executionHostId: 'runtime:paired',
      codexHome: null
    })

    await expect(prepareAiVaultSessionForTerminalResume(remote)).resolves.toBe(remote)
    expect(prepareSessionResume).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'claude', executionHostId: 'runtime:paired' })
    )
  })

  it.each(['claude', 'omp', 'codex'] as const)(
    'keeps the same paired host and home after an ownership-only preparation result for %s',
    async (agent) => {
      const prepareSessionResume = vi.fn().mockResolvedValue({ useRealCodexHome: false })
      stubPreparation(prepareSessionResume)
      const remote = session({ agent, executionHostId: 'runtime:paired', codexHome: null })

      await expect(prepareAiVaultSessionForTerminalResume(remote)).resolves.toBe(remote)
      expect(prepareSessionResume).toHaveBeenCalledWith(
        expect.objectContaining({ executionHostId: 'runtime:paired', filePath: remote.filePath })
      )
    }
  )

  it.each([
    'agent_session_conflict',
    'agent_session_ownership_unknown',
    'forbidden',
    'remote_runtime_unavailable',
    'Invalid aiVault.prepareSessionResume response'
  ])('refuses a paired terminal resume on %s', async (failure) => {
    const prepareSessionResume = vi.fn().mockRejectedValue(new Error(failure))
    stubPreparation(prepareSessionResume)
    const remote = session({ agent: 'claude', executionHostId: 'runtime:paired' })

    await expect(prepareAiVaultSessionForTerminalResume(remote)).rejects.toThrow(failure)
  })

  it('does not skip required Codex home preparation on an old paired host', async () => {
    const prepareSessionResume = vi
      .fn()
      .mockRejectedValue(new Error('aiVault.prepareSessionResume: method_not_found'))
    stubPreparation(prepareSessionResume)
    const remote = session({
      executionHostId: 'runtime:paired',
      codexHome: '/tmp/orca/codex-runtime-home/home'
    })

    await expect(prepareAiVaultSessionForTerminalResume(remote)).rejects.toThrow('method_not_found')
    expect(prepareSessionResume).toHaveBeenCalledWith(
      expect.objectContaining({ codexHome: remote.codexHome })
    )
  })

  it('keeps a paired Codex row on its recorded account home during ownership admission', async () => {
    const prepareSessionResume = vi.fn().mockResolvedValue({
      useRealCodexHome: false,
      substituteCodexHome: '/host/orca/codex-accounts/account-b/home'
    })
    stubPreparation(prepareSessionResume)
    const remote = session({
      executionHostId: 'runtime:paired',
      codexHome: '/host/orca/codex-accounts/account-a/home'
    })

    await expect(prepareAiVaultSessionForTerminalResume(remote)).resolves.toBe(remote)
    expect(prepareSessionResume).toHaveBeenCalledWith(
      expect.objectContaining({ executionHostId: 'runtime:paired', codexHome: null })
    )
  })

  it('does not treat an unrelated method failure as missing resume preparation', async () => {
    stubPreparation(vi.fn().mockRejectedValue(new Error('terminal.send: method_not_found')))
    const remote = session({ agent: 'claude', executionHostId: 'runtime:paired' })

    await expect(prepareAiVaultSessionForTerminalResume(remote)).rejects.toThrow(
      'terminal.send: method_not_found'
    )
  })

  it('refuses a malformed successful response from a paired web host', async () => {
    stubPreparation(vi.fn().mockResolvedValue({}))
    const remote = session({ agent: 'claude', executionHostId: 'runtime:paired' })

    await expect(prepareAiVaultSessionForTerminalResume(remote)).rejects.toThrow(
      'Invalid aiVault.prepareSessionResume response'
    )
  })

  it('requires the exact missing method message as well as the web error code', async () => {
    stubPreparation(
      vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('Unknown method: terminal.send'), { code: 'method_not_found' })
        )
    )
    const remote = session({ agent: 'claude', executionHostId: 'runtime:paired' })

    await expect(prepareAiVaultSessionForTerminalResume(remote)).rejects.toThrow('terminal.send')
  })

  it('never applies the old-host fallback to a local row', async () => {
    stubPreparation(
      vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Error invoking remote method 'aiVault:prepareSessionResume': Error: aiVault.prepareSessionResume: method_not_found"
          )
        )
    )
    const local = session({ agent: 'claude' })

    await expect(prepareAiVaultSessionForTerminalResume(local)).rejects.toThrow('method_not_found')
  })
})

describe('prepareAiVaultSessionForFork', () => {
  // A fork of a chat-owned conversation must run under the selected account, as a resume does.
  it('repins a chat-owned per-account session, asking the host as a fork', async () => {
    const prepareSessionResume = vi.fn().mockResolvedValue({
      useRealCodexHome: false,
      substituteCodexHome: '/tmp/orca/codex-accounts/account-2/home'
    })
    stubPreparation(prepareSessionResume)
    const owned = session({
      codexHome: '/tmp/orca/codex-accounts/account-1/home',
      structuredSession: { sessionId: 'session-1', workspaceId: 'worktree-1' }
    })

    const prepared = await prepareAiVaultSessionForFork(owned)

    expect(prepared.codexHome).toBe('/tmp/orca/codex-accounts/account-2/home')
    expect(prepareSessionResume).toHaveBeenCalledWith({
      agent: 'codex',
      sessionId: owned.sessionId,
      filePath: owned.filePath,
      codexHome: owned.codexHome,
      executionHostId: 'local',
      fork: true
    })
  })

  it('does not ask the host for a home that needs no preparation', async () => {
    const prepareSessionResume = vi.fn()
    stubPreparation(prepareSessionResume)
    const owned = session({
      agent: 'claude',
      codexHome: null,
      structuredSession: { sessionId: 'session-1', workspaceId: 'worktree-1' }
    })

    await expect(prepareAiVaultSessionForFork(owned)).resolves.toBe(owned)
    expect(prepareSessionResume).not.toHaveBeenCalled()
  })
})

describe('dropDeletedSshResumeCwd', () => {
  it('leaves a live SSH session alone, scanner command and all', async () => {
    const pathExists = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('window', { api: { fs: { pathExists } } })
    const remote = session({ executionHostId: 'ssh:server-1', cwd: '/home/ada/wt/feat-x' })

    // Why: dropping the cwd here would strand every ordinary remote resume at the workspace root.
    await expect(dropDeletedSshResumeCwd(remote)).resolves.toBe(remote)
    expect(pathExists).toHaveBeenCalledWith({
      filePath: '/home/ada/wt/feat-x',
      connectionId: 'server-1'
    })
  })

  it('never probes a host for a local session', async () => {
    const pathExists = vi.fn()
    vi.stubGlobal('window', { api: { fs: { pathExists } } })
    const local = session({ cwd: '/repo' })

    await expect(dropDeletedSshResumeCwd(local)).resolves.toBe(local)
    expect(pathExists).not.toHaveBeenCalled()
  })

  it('keeps the recorded folder when the SSH host cannot answer', async () => {
    const pathExists = vi.fn().mockRejectedValue(new Error('CONNECTION_LOST'))
    vi.stubGlobal('window', { api: { fs: { pathExists } } })
    const remote = session({ executionHostId: 'ssh:server-1', cwd: '/home/ada/wt/feat-x' })

    // Why: losing the host is not evidence the folder is gone (ssh-execution-boundary.md).
    await expect(dropDeletedSshResumeCwd(remote)).resolves.toBe(remote)
    expect(pathExists).toHaveBeenCalled()
  })

  it('keeps the recorded folder for an agent that can only resume there', async () => {
    const pathExists = vi.fn().mockResolvedValue(false)
    vi.stubGlobal('window', { api: { fs: { pathExists } } })
    const kimi = session({ agent: 'kimi', executionHostId: 'ssh:server-1', cwd: '/home/ada/wt/x' })

    // Why: kimi-cli 1.52 silently opens a new empty session with the same id from any other folder.
    await expect(dropDeletedSshResumeCwd(kimi)).resolves.toBe(kimi)
  })
})

function stubPreparation(prepareSessionResume: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal('window', { api: { aiVault: { prepareSessionResume } } })
}

function session(overrides: Partial<AiVaultSession> = {}): AiVaultSession {
  return {
    id: 'local:codex:session-1:/tmp/rollout.jsonl',
    executionHostId: 'local',
    agent: 'codex',
    sessionId: 'session-1',
    title: 'Legacy session',
    cwd: '/repo',
    branch: null,
    model: null,
    filePath: '/tmp/rollout.jsonl',
    codexHome: null,
    createdAt: null,
    updatedAt: null,
    modifiedAt: '2026-07-20T00:00:00.000Z',
    messageCount: 1,
    totalTokens: 0,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: "codex resume 'session-1'",
    subagent: null,
    ...overrides
  }
}
