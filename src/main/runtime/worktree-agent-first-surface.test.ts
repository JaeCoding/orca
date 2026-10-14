import { describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { RuntimePtyController } from './runtime-pty-controller-contract'
import type { RuntimeMobileSessionTabsResult } from '../../shared/runtime-types'

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

function orderedTabs(snapshot: RuntimeMobileSessionTabsResult) {
  return (
    snapshot.tabGroups?.flatMap((group) =>
      group.tabOrder.map((id) =>
        snapshot.tabs.find(
          (tab) => tab.id === id || (tab.type === 'terminal' && tab.parentTabId === id)
        )
      )
    ) ?? []
  )
}

describe('host-created workspaces awaiting their agent chat', () => {
  it.each([
    ['new-tab', false, false, false],
    ['new-tab', true, true, false],
    ['new-tab', true, false, true],
    ['split-horizontal', false, false, false],
    ['split-horizontal', true, true, true],
    ['split-vertical', false, true, false],
    ['split-vertical', true, false, true],
    ['new-tab', true, false, false, true]
  ] as const)(
    'places chat first (%s, defaults=%s, wait=%s, activate=%s)',
    async (
      setupScriptLaunchMode,
      withDefaults,
      wait,
      activate,
      terminalFallback: boolean = false
    ) => {
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
      const { runtimeStore, getSession } = makeRuntimeStoreWithWorkspaceSession(
        getDefaultWorkspaceSession()
      )
      const runtime = new OrcaRuntimeService({
        ...runtimeStore,
        getRepo: (id) => (id === repo.id ? repo : undefined),
        getRepos: () => [repo],
        getSettings: () => ({ ...runtimeStore.getSettings(), setupScriptLaunchMode })
      })
      if (terminalFallback) {
        runtime.syncWindowGraph(0, { tabs: [], leaves: [] })
      }
      const spawn = vi.fn<NonNullable<RuntimePtyController['spawn']>>(async (args) => {
        if (!args.worktreeId || !args.tabId || !args.leafId) {
          throw new Error('missing pane identity')
        }
        const ptyId = `pty-${spawn.mock.calls.length}`
        if (terminalFallback && args.command === 'claude') {
          expect(getSession().tabGroups?.[args.worktreeId]?.[0]?.tabOrder[0]).toBe(args.tabId)
        }
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
      const before = await runtime.listMobileSessionTabs(`id:${result.worktree.id}`)
      const publications: RuntimeMobileSessionTabsResult[] = []
      runtime.onMobileSessionTabsChanged((snapshot) => publications.push(snapshot))
      if (terminalFallback) {
        const { tab } = await runtime.createMobileSessionTerminal(`id:${result.worktree.id}`, {
          command: 'claude',
          launchAgent: 'claude',
          tabPosition: 'first',
          activate: false
        })
        const fallback = await runtime.listMobileSessionTabs(`id:${result.worktree.id}`)
        expect(orderedTabs(fallback)[0]?.id).toBe(tab.id)
        expect(fallback.activeTabId).toBe(before.activeTabId)
        expect(getSession().tabGroups?.[result.worktree.id]?.[0]?.tabOrder[0]).toBe(tab.parentTabId)
        expect(publications).toHaveLength(1)
        expect(orderedTabs(publications[0])[0]?.id).toBe(tab.id)
        return
      }
      await runtime.publishStructuredAgentSessionTab({
        workspaceId: result.worktree.id,
        sessionId: 'chat-1',
        agent: 'claude',
        activate,
        tabPosition: 'first'
      })
      const snapshot = await runtime.listMobileSessionTabs(`id:${result.worktree.id}`)
      expect(orderedTabs(snapshot).map((tab) => tab?.type)).toEqual([
        'agent-session',
        ...Array.from(
          { length: withDefaults ? (setupScriptLaunchMode === 'new-tab' ? 3 : 2) : 1 },
          () => 'terminal'
        )
      ])
      expect(orderedTabs(snapshot)[0]?.id).toBe('agent-session:chat-1')
      expect(snapshot.activeTabId).toBe(activate ? 'agent-session:chat-1' : before.activeTabId)
      expect(publications).toHaveLength(1)
      expect(
        publications.every((frame) => orderedTabs(frame)[0]?.id === 'agent-session:chat-1')
      ).toBe(true)
      expect(getSession().tabGroups?.[result.worktree.id]?.[0]?.tabOrder[0]).toBe(
        'agent-session:chat-1'
      )

      const restarted = new OrcaRuntimeService(runtimeStore)
      await restarted.listMobileSessionTabs(`id:${result.worktree.id}`)
      restarted.projectStructuredAgentSessionTab({
        workspaceId: result.worktree.id,
        sessionId: 'chat-1',
        agent: 'claude',
        activate: false
      })
      expect(
        orderedTabs(await restarted.listMobileSessionTabs(`id:${result.worktree.id}`))[0]?.id
      ).toBe('agent-session:chat-1')
      const group = snapshot.tabGroups?.[0]
      if (!group) {
        throw new Error('missing created group')
      }
      const movedOrder = [...group.tabOrder.slice(1), 'agent-session:chat-1']
      await runtime.moveMobileSessionTab(`id:${result.worktree.id}`, {
        kind: 'reorder',
        tabId: 'agent-session:chat-1',
        targetGroupId: group.id,
        tabOrder: movedOrder
      })
      await runtime.publishStructuredAgentSessionTab({
        workspaceId: result.worktree.id,
        sessionId: 'chat-1',
        agent: 'claude',
        activate: true,
        tabPosition: 'first'
      })
      expect(getSession().tabGroups?.[result.worktree.id]?.[0]?.tabOrder).toEqual(movedOrder)
      await runtime.publishStructuredAgentSessionTab({
        workspaceId: result.worktree.id,
        sessionId: 'later',
        agent: 'claude',
        activate: false
      })
      expect(
        orderedTabs(await runtime.listMobileSessionTabs(`id:${result.worktree.id}`)).at(-1)?.id
      ).toBe('agent-session:later')
    }
  )
})
