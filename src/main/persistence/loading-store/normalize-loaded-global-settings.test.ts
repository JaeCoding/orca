import { homedir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { normalizeLoadedGlobalSettings } from './normalize-loaded-global-settings'
import { prepareLoadedTerminalSettings } from './prepare-loaded-terminal-settings'
import { prepareLoadedProfileSettings } from './prepare-loaded-profile-settings'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { applyAgentPermissionMode } from '../../../shared/tui-agent-permissions'

// Simulates a profile created before the dedicated Experimental switch was persisted.
function normalizeLegacyProfile(overrides: Record<string, unknown>): PersistedState['settings'] {
  const defaults = getDefaultPersistedState(homedir())
  const settings: Partial<GlobalSettings> = { ...defaults.settings }
  delete settings.experimentalActivity
  delete settings.experimentalAgentDashboardPopout
  Object.assign(settings, overrides)
  const parsed: PersistedState = { ...defaults, settings: settings as GlobalSettings }
  const noop = (): void => {}
  const terminal = prepareLoadedTerminalSettings(parsed, noop)
  const profile = prepareLoadedProfileSettings(parsed, defaults, noop)
  return normalizeLoadedGlobalSettings(parsed, terminal, profile)
}

describe('retired Agents sidebar setting', () => {
  it('does not mark new profiles as migrated', () => {
    expect(normalizeLegacyProfile({}).agentsSidebarMigratedFromExperimental).toBe(false)
  })

  it('drops the old visibility setting while preserving migration metadata', () => {
    const normalized = normalizeLegacyProfile({
      experimentalActivity: true,
      showAgentsSidebar: false
    })
    expect('showAgentsSidebar' in normalized).toBe(false)
    expect(normalized.agentsSidebarMigratedFromExperimental).toBe(true)
  })
})

describe('retired managed servers experiment', () => {
  it('drops the stored toggle, since managed servers are the default SSH path', () => {
    expect('experimentalManagedServers' in normalizeLegacyProfile({})).toBe(false)
    expect(
      'experimentalManagedServers' in normalizeLegacyProfile({ experimentalManagedServers: true })
    ).toBe(false)
  })
})

describe('retired chat default selectors', () => {
  it('keeps Chat UI on while dropping both older keys from a saved profile', () => {
    const normalized = normalizeLegacyProfile({
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: false,
      openAgentTabsInChatByDefault: true
    })
    expect(normalized.experimentalNativeChat).toBe(true)
    expect(normalized).not.toHaveProperty('experimentalStructuredNativeChat')
    expect(normalized).not.toHaveProperty('openAgentTabsInChatByDefault')
  })

  it('turns Chat UI off when new tabs opened in the terminal, dropping both older keys', () => {
    const normalized = normalizeLegacyProfile({
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: false,
      openAgentTabsInChatByDefault: false
    })
    expect(normalized.experimentalNativeChat).toBe(false)
    expect(normalized).not.toHaveProperty('experimentalStructuredNativeChat')
    expect(normalized).not.toHaveProperty('openAgentTabsInChatByDefault')
  })
})

describe('structured chat shell environment settings', () => {
  it('keeps a valid saved list and an explicit opt-out', () => {
    const normalized = normalizeLegacyProfile({
      nativeChatInheritShellEnvironment: false,
      nativeChatShellEnvironmentVariables: ['HTTPS_PROXY', 'CODEX_LB_API_KEY']
    })
    expect(normalized.nativeChatInheritShellEnvironment).toBe(false)
    expect(normalized.nativeChatShellEnvironmentVariables).toEqual([
      'HTTPS_PROXY',
      'CODEX_LB_API_KEY'
    ])
  })

  it('degrades a malformed hand-edited value to the defaults instead of failing a chat', () => {
    const normalized = normalizeLegacyProfile({
      nativeChatInheritShellEnvironment: 'no',
      nativeChatShellEnvironmentVariables: 'HTTPS_PROXY, CODEX_LB_API_KEY'
    })
    expect(normalized.nativeChatInheritShellEnvironment).toBe(true)
    expect(normalized.nativeChatShellEnvironmentVariables).toEqual([])
  })

  it('drops non-string and invalid entries from a saved list', () => {
    expect(
      normalizeLegacyProfile({
        nativeChatShellEnvironmentVariables: ['HTTPS_PROXY', 7, null, 'not valid', 'HTTPS_PROXY']
      }).nativeChatShellEnvironmentVariables
    ).toEqual(['HTTPS_PROXY'])
  })
})

describe('machine name setting', () => {
  it('trims persisted names and defaults missing legacy values to automatic detection', () => {
    expect(normalizeLegacyProfile({ machineName: '  Build server  ' }).machineName).toBe(
      'Build server'
    )
    expect(normalizeLegacyProfile({ machineName: undefined }).machineName).toBe('')
    expect(normalizeLegacyProfile({ machineName: 'x'.repeat(300) }).machineName).toHaveLength(255)
  })
})

describe('chat appearance settings', () => {
  it('normalizes old and malformed profiles on load', () => {
    expect(normalizeLegacyProfile({}).nativeChatAppearance).toBeUndefined()
    expect(
      normalizeLegacyProfile({
        nativeChatAppearance: { fontSize: 40, codeFontSize: 1, width: 'wide' }
      }).nativeChatAppearance
    ).toEqual({ fontSize: 20, codeFontSize: 10, width: 'wide' })
    expect(
      normalizeLegacyProfile({
        nativeChatAppearance: { fontSize: 14, codeFontSize: 12, width: 'comfortable' }
      }).nativeChatAppearance
    ).toBeUndefined()
  })
})

describe('the new-chat permission setting', () => {
  it.each([
    ['manual', 'ask'],
    ['yolo', 'full-access']
  ] as const)('seeds a profile without it from %s Agent Permissions', (mode, expected) => {
    const normalized = normalizeLegacyProfile({
      nativeChatPermissionMode: undefined,
      ...applyAgentPermissionMode({ mode })
    })
    expect(normalized.nativeChatPermissionMode).toBe(expected)
  })

  // Seeded once: after the next save the setting is the user's, not a mirror of Agent Permissions.
  it('keeps a saved value when Agent Permissions change afterwards', () => {
    const normalized = normalizeLegacyProfile({
      nativeChatPermissionMode: 'ask',
      ...applyAgentPermissionMode({ mode: 'yolo' })
    })
    expect(normalized.nativeChatPermissionMode).toBe('ask')
  })
})

describe('Windows chat permission seeding', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it.each([
    { shell: 7 },
    { shell: false },
    { shell: {} },
    { shell: [] },
    { shell: null },
    { shell: undefined }
  ])(
    'loads an absent permission choice with a missing or non-string shell: $shell',
    ({ shell }) => {
      const normalized = normalizeLegacyProfile({
        nativeChatPermissionMode: undefined,
        terminalWindowsShell: shell
      })
      expect(normalized.nativeChatPermissionMode).toBe('full-access')
    }
  )

  it('uses the default PowerShell family for a malformed shell', () => {
    const normalized = normalizeLegacyProfile({
      nativeChatPermissionMode: undefined,
      terminalWindowsShell: 7,
      agentDefaultArgs: {
        claude: '`--dangerously-skip-permissions',
        codex: '`--dangerously-bypass-approvals-and-sandbox'
      }
    })
    expect(normalized.nativeChatPermissionMode).toBe('full-access')
  })

  it.each([
    { shell: 'powershell.exe', escape: '`' },
    { shell: 'C:\\Tools\\PowerShell\\pwsh.exe', escape: '`' },
    { shell: 'cmd.exe', escape: '^' },
    { shell: 'C:\\Tools\\Custom Shell\\cmd.exe', escape: '^' },
    { shell: 'git-bash', escape: '\\' },
    { shell: 'C:\\Tools\\Custom Shell\\bash.exe', escape: '\\' },
    { shell: 'wsl.exe', escape: '\\' }
  ])('keeps the saved $shell family and custom path', ({ shell, escape }) => {
    const normalized = normalizeLegacyProfile({
      nativeChatPermissionMode: undefined,
      terminalWindowsShell: shell,
      agentDefaultArgs: {
        claude: `${escape}--dangerously-skip-permissions`,
        codex: `${escape}--dangerously-bypass-approvals-and-sandbox`
      }
    })
    expect(normalized.nativeChatPermissionMode).toBe('full-access')
    expect(normalized.terminalWindowsShell).toBe(shell)
  })

  it.each(['ask', 'accept-edits', 'auto', 'full-access'] as const)(
    'keeps a saved %s with a malformed shell',
    (mode) => {
      expect(
        normalizeLegacyProfile({
          nativeChatPermissionMode: mode,
          terminalWindowsShell: 7,
          ...applyAgentPermissionMode({ mode: 'manual' })
        }).nativeChatPermissionMode
      ).toBe(mode)
    }
  )

  it.each(['claude', 'codex'] as const)(
    'asks when %s does not bypass with a malformed shell',
    (agent) => {
      const terminal = applyAgentPermissionMode({ mode: 'yolo' })
      Object.assign(terminal.agentDefaultArgs, { [agent]: '--model custom' })
      expect(
        normalizeLegacyProfile({
          ...terminal,
          nativeChatPermissionMode: undefined,
          terminalWindowsShell: 7
        }).nativeChatPermissionMode
      ).toBe('ask')
    }
  )

  it('seeds from migrated arguments with a malformed shell', () => {
    const normalized = normalizeLegacyProfile({
      nativeChatPermissionMode: undefined,
      terminalWindowsShell: 7,
      agentYoloDefaultsMigrated: undefined,
      agentDefaultArgs: undefined,
      agentCmdOverrides: { claude: 'custom-claude' }
    })
    expect(normalized.agentDefaultArgs?.claude).toBe('')
    expect(normalized.agentDefaultArgs?.codex).toBe('--dangerously-bypass-approvals-and-sandbox')
    expect(normalized.nativeChatPermissionMode).toBe('ask')
  })
})
