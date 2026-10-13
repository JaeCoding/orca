import { afterEach, describe, expect, it, vi } from 'vitest'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import {
  installOwnership,
  PROVIDER_SESSION
} from '../ai-vault/structured-session-ownership.test-support'
import { prepareAiVaultSessionResume } from './ai-vault-resume'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const local = {
  agent: 'codex' as const,
  sessionId: PROVIDER_SESSION,
  filePath: `/sessions/rollout-${PROVIDER_SESSION}.jsonl`,
  codexHome: null,
  executionHostId: 'local' as const
}

afterEach(() => setStructuredAgentSessionHost(null))

describe('desktop resume host admission', () => {
  it('continues resume preparation when chat-host initialization fails on a neutral row', async () => {
    const failure = new Error('chat host could not start')
    const ensureStructuredSessionOwnership = vi.fn().mockRejectedValue(failure)
    const prepareSessionResume = vi.fn().mockResolvedValue({ useRealCodexHome: false })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      await expect(
        prepareAiVaultSessionResume(local, {
          ensureStructuredSessionOwnership,
          prepareSessionResume
        })
      ).resolves.toEqual({ useRealCodexHome: false })
      expect(prepareSessionResume).toHaveBeenCalledWith(local)
      expect(warning).toHaveBeenCalledWith(
        '[ai-vault] native chat host setup failed during terminal resume:',
        failure
      )
    } finally {
      warning.mockRestore()
    }
  })

  it('still refuses an actual owner when chat-host initialization fails', async () => {
    installOwnership()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const prepareSessionResume = vi.fn()

    try {
      await expect(
        prepareAiVaultSessionResume(local, {
          ensureStructuredSessionOwnership: vi
            .fn()
            .mockRejectedValue(new Error('host unavailable')),
          prepareSessionResume
        })
      ).rejects.toThrow('agent_session_conflict')
      expect(prepareSessionResume).not.toHaveBeenCalled()
    } finally {
      warning.mockRestore()
    }
  })

  it.each([
    { codexHome: '/managed', fork: false },
    { codexHome: null, fork: true }
  ])('keeps chat-host setup failures for existing home or fork requests %j', async (caseArgs) => {
    const failure = new Error('host unavailable')
    const prepareSessionResume = vi.fn()

    await expect(
      prepareAiVaultSessionResume(
        { ...local, ...caseArgs },
        {
          ensureStructuredSessionOwnership: vi.fn().mockRejectedValue(failure),
          prepareSessionResume
        }
      )
    ).rejects.toBe(failure)
    expect(prepareSessionResume).not.toHaveBeenCalled()
  })

  it.each(['claude', 'omp', 'codex'] as const)(
    'refuses an owned native %s row before home preparation',
    async (agent) => {
      installOwnership(
        agent === 'omp'
          ? { handle: { transport: 'acp', agent: 'omp', nativeId: PROVIDER_SESSION } }
          : { provider: agent }
      )
      const prepareSessionResume = vi.fn()

      await expect(
        prepareAiVaultSessionResume({ ...local, agent }, { prepareSessionResume })
      ).rejects.toThrow('agent_session_conflict')
      expect(prepareSessionResume).not.toHaveBeenCalled()
    }
  )

  it('allows an owned conversation to fork with the existing fork flag', async () => {
    installOwnership()
    const prepareSessionResume = vi.fn().mockResolvedValue({ useRealCodexHome: false })

    await expect(
      prepareAiVaultSessionResume({ ...local, fork: true }, { prepareSessionResume })
    ).resolves.toEqual({ useRealCodexHome: false })
    expect(prepareSessionResume).toHaveBeenCalledWith({ ...local, fork: true })
  })

  it('routes a same-ID paired row to its host before local ownership admission', async () => {
    installOwnership()
    const prepareSessionResume = vi.fn()
    const prepareRuntimeSessionResume = vi.fn().mockResolvedValue({ useRealCodexHome: false })
    const ensureStructuredSessionOwnership = vi.fn()
    const remote = { ...local, executionHostId: 'runtime:paired' as const }

    await expect(
      prepareAiVaultSessionResume(remote, {
        prepareSessionResume,
        prepareRuntimeSessionResume,
        ensureStructuredSessionOwnership
      })
    ).resolves.toEqual({ useRealCodexHome: false })
    expect(prepareRuntimeSessionResume).toHaveBeenCalledWith('paired', remote)
    expect(prepareSessionResume).not.toHaveBeenCalled()
    expect(ensureStructuredSessionOwnership).not.toHaveBeenCalled()
  })

  it('does not equate a same-ID SSH row with this native host', async () => {
    installOwnership()
    const ensureStructuredSessionOwnership = vi.fn()
    const prepareSessionResume = vi.fn()

    await expect(
      prepareAiVaultSessionResume(
        { ...local, filePath: '/home/ada/session.jsonl', executionHostId: 'ssh:server' },
        { prepareSessionResume, ensureStructuredSessionOwnership }
      )
    ).resolves.toEqual({ useRealCodexHome: false })
    expect(ensureStructuredSessionOwnership).not.toHaveBeenCalled()
    expect(prepareSessionResume).not.toHaveBeenCalled()
  })

  it('keeps WSL home preparation without mistaking a same-ID row for native', async () => {
    installOwnership()
    const ensureStructuredSessionOwnership = vi.fn()
    const prepareSessionResume = vi.fn().mockResolvedValue({ useRealCodexHome: true })
    const wsl = {
      ...local,
      filePath: '\\\\wsl.localhost\\Ubuntu\\home\\ada\\session.jsonl'
    }

    await expect(
      prepareAiVaultSessionResume(wsl, { prepareSessionResume, ensureStructuredSessionOwnership })
    ).resolves.toEqual({ useRealCodexHome: true })
    expect(ensureStructuredSessionOwnership).not.toHaveBeenCalled()
    expect(prepareSessionResume).toHaveBeenCalledWith(wsl)
  })
})
