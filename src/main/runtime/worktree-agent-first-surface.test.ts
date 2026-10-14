import { describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { RuntimePtyController } from './runtime-pty-controller-contract'

const {
  OrcaRuntimeService,
  computeWorktreePathMock,
  ensurePathWithinWorkspaceMock,
  getEffectiveHooks,
  getDefaultTabsLaunch,
  createSetupRunnerScript,
  listWorktrees
} = await import('./orca-runtime-test-mocks.spec')
await import('./orca-runtime-test-lifecycle.spec')
const { makeRuntimeStoreWithWorkspaceSession, store } =
  await import('./orca-runtime-test-fixtures.spec')

const DEFAULTS = {
  runCommands: true,
  tabs: [
    { title: 'Dev', command: 'pnpm dev' },
    { title: 'Tests', command: 'pnpm test' }
  ]
}

describe('host-created workspaces awaiting their agent chat', () => {
  it.each([
    ['new-tab', false, false, false],
    ['new-tab', true, true, false],
    ['split-horizontal', false, false, false]
  ] as const)(
    'provisions only the required terminals (%s, defaults=%s, wait=%s, activate=%s)',
    async (setupScriptLaunchMode, withDefaults, wait, activate) => {
      const path = '/tmp/workspaces/chat-create'
      const baseRepo = store.getRepo('repo-1')
      if (!baseRepo) {
        throw new Error('missing test repo')
      }
      const repo = {
        ...baseRepo,
        hookSettings: {
          mode: 'auto' as const,
          setupRunPolicy: 'run-by-default' as const,
          setupAgentStartupPolicy: wait
            ? ('wait-for-setup' as const)
            : ('start-immediately' as const),
          scripts: { setup: '', archive: '' }
        }
      }
      const { runtimeStore } = makeRuntimeStoreWithWorkspaceSession(getDefaultWorkspaceSession())
      const runtime = new OrcaRuntimeService({
        ...runtimeStore,
        getRepo: (id) => (id === repo.id ? repo : undefined),
        getRepos: () => [repo],
        getSettings: () => ({ ...runtimeStore.getSettings(), setupScriptLaunchMode })
      })
      const spawn = vi.fn<NonNullable<RuntimePtyController['spawn']>>(async () => {
        const ptyId = `pty-${spawn.mock.calls.length}`
        return { id: ptyId }
      })
      runtime.setPtyController({
        spawn,
        write: () => true,
        kill: () => true,
        getForegroundProcess: async () => null
      })
      computeWorktreePathMock.mockReturnValue(path)
      ensurePathWithinWorkspaceMock.mockReturnValue(path)
      vi.mocked(getEffectiveHooks).mockReturnValue({ scripts: { setup: 'pnpm install' } })
      vi.mocked(getDefaultTabsLaunch).mockReturnValue(withDefaults ? DEFAULTS : undefined)
      vi.mocked(createSetupRunnerScript).mockReturnValue({
        runnerScriptPath: '/repo/setup.sh',
        envVars: {},
        ...(wait ? { waitForAgentStartup: true } : {})
      })
      vi.mocked(listWorktrees).mockResolvedValue([
        { path, head: 'abc', branch: 'chat-create', isBare: false, isMainWorktree: false }
      ])

      const result = await runtime.createManagedWorktree({
        repoSelector: 'id:repo-1',
        name: 'chat-create',
        createdWithAgent: 'claude',
        promisedAgentChat: true,
        setupDecision: 'run',
        awaitTerminalProvisioning: true,
        observeSetupCompletion: true,
        activate
      })
      const commandCount = withDefaults ? 3 : setupScriptLaunchMode === 'new-tab' ? 1 : 2
      expect(spawn).toHaveBeenCalledTimes(commandCount)
      expect(spawn.mock.calls.filter(([args]) => args.command === 'pnpm dev')).toHaveLength(
        withDefaults ? 1 : 0
      )
      expect(spawn.mock.calls.filter(([args]) => args.command === 'pnpm test')).toHaveLength(
        withDefaults ? 1 : 0
      )
      expect(result.setupReceipt).toMatchObject({
        state: 'running',
        startupPolicy: wait ? 'wait-for-setup' : 'start-immediately',
        terminalHandle: expect.any(String)
      })
      const snapshot = await runtime.listMobileSessionTabs(`id:${result.worktree.id}`)
      expect(snapshot.tabs).toHaveLength(commandCount)
      if (setupScriptLaunchMode === 'new-tab' && !withDefaults) {
        expect(snapshot.tabs[0]?.title).toBe('Setup')
      }
    }
  )
})
