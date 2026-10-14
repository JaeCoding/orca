import type { Tab } from '../../../shared/tab-types'
import { getEditorDisplayLabel } from '@/components/editor/editor-labels'
import { buildPaletteTabDocument } from './palette-match/tab-document'
import {
  getPaletteWorktreeIdentity,
  isPaletteCurrentWorktree,
  resolvePaletteRepoForWorktree
} from './palette-repo-resolution'
import {
  resolveWorktreeBranchLabel,
  resolveWorktreeDisplayName
} from './worktree-default-display-name'
import { buildAgentMetadataTabIndex } from './workspace-tab-agent-metadata'
import {
  pushAgentSessionTabEntry,
  pushTerminalTabEntry,
  type PaletteTabBaseEntry,
  type PaletteTabEntryContext
} from './workspace-tab-palette-type-entries'
import type {
  BuildSearchableWorkspaceTabsOptions,
  SearchableWorkspaceTab,
  WorkspaceTabContentType
} from './workspace-tab-palette-search'
import {
  findAmbiguousWorktreeIds,
  findDuplicateIds,
  getUnifiedTabPaletteExecutionHostId,
  hasOpenFileExecutionHostEvidence,
  isOpenFileOwnedByWorktree,
  isUnifiedTabOwnedByWorktree
} from './unified-tab-host-ownership'
import type { OpenFile } from '@/store/slices/editor'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import { isWorkspaceTabContentType } from './workspace-tab-palette-content-type'

function getActiveUnifiedTabId({
  worktreeId,
  isCurrentWorktree,
  activeTabType,
  activeGroupIdByWorktree,
  groupsByWorktree
}: Pick<
  BuildSearchableWorkspaceTabsOptions,
  'activeGroupIdByWorktree' | 'activeTabType' | 'groupsByWorktree'
> & { worktreeId: string; isCurrentWorktree: boolean }): string | null {
  if (!isCurrentWorktree) {
    return null
  }
  const activeGroupId = activeGroupIdByWorktree[worktreeId]
  const activeGroup = activeGroupId
    ? (groupsByWorktree[worktreeId] ?? []).find((group) => group.id === activeGroupId)
    : undefined
  const activeUnifiedTabId = activeGroup?.activeTabId ?? null
  return activeTabType === 'terminal' ||
    activeTabType === 'editor' ||
    activeTabType === 'agent-session'
    ? activeUnifiedTabId
    : null
}

function isCurrentWorkspaceTab({
  tab,
  isCurrentWorktree,
  activeTabType,
  activeTabId,
  activeTabIdByWorktree,
  activeFileId,
  activeFileIdByWorktree,
  activeTabTypeByWorktree,
  activeUnifiedTabId
}: Pick<
  BuildSearchableWorkspaceTabsOptions,
  | 'activeFileId'
  | 'activeFileIdByWorktree'
  | 'activeTabId'
  | 'activeTabIdByWorktree'
  | 'activeTabType'
  | 'activeTabTypeByWorktree'
> & {
  tab: Tab & { contentType: WorkspaceTabContentType }
  isCurrentWorktree: boolean
  activeUnifiedTabId: string | null
}): boolean {
  if (!isCurrentWorktree) {
    return false
  }
  if (activeUnifiedTabId) {
    return activeUnifiedTabId === tab.id
  }
  // Why: agent-session tabs have their own visible type; editor-family and
  // browser/simulator types never own the stored active id of an editor row.
  const visibleType =
    tab.contentType === 'terminal'
      ? 'terminal'
      : tab.contentType === 'agent-session'
        ? 'agent-session'
        : 'editor'
  const storedType = activeTabTypeByWorktree[tab.worktreeId] ?? activeTabType
  if (storedType !== visibleType) {
    return false
  }
  return visibleType === 'terminal'
    ? (activeTabIdByWorktree[tab.worktreeId] ?? activeTabId) === tab.entityId
    : (activeFileIdByWorktree[tab.worktreeId] ?? activeFileId) === tab.entityId
}

export function buildSearchableWorkspaceTabEntries({
  worktrees,
  ownershipWorktrees,
  repoMap,
  repoMapByHostIdentity,
  worktreeOrder,
  unifiedTabsByWorktree,
  tabsByWorktree,
  openFiles,
  agentStatusByPaneKey,
  retainedAgentsByPaneKey,
  sleepingAgentSessionsByPaneKey,
  activeGroupIdByWorktree,
  groupsByWorktree,
  activeWorktreeId,
  activeWorkspaceExecutionHostId,
  activeTabType,
  activeTabId,
  activeTabIdByWorktree,
  activeFileId,
  activeFileIdByWorktree,
  activeTabTypeByWorktree,
  generatedTitlesEnabled,
  terminalLayoutsByTabId,
  paneForegroundAgentByPaneKey
}: BuildSearchableWorkspaceTabsOptions): SearchableWorkspaceTab[] {
  const entries: SearchableWorkspaceTab[] = []
  const seenTabIdentities = new Set<string>()
  const openFilesById = new Map<string, OpenFile[]>()
  for (const file of openFiles) {
    const bucket = openFilesById.get(file.id)
    if (bucket) {
      bucket.push(file)
    } else {
      openFilesById.set(file.id, [file])
    }
  }
  const agentIndex = buildAgentMetadataTabIndex({
    agentStatusByPaneKey,
    retainedAgentsByPaneKey,
    sleepingAgentSessionsByPaneKey
  })
  const ambiguousWorktreeIds = findAmbiguousWorktreeIds(ownershipWorktrees ?? worktrees)

  for (const worktree of worktrees) {
    const repoName =
      resolvePaletteRepoForWorktree(worktree, repoMap, repoMapByHostIdentity)?.displayName ?? ''
    const worktreeName = resolveWorktreeDisplayName(worktree)
    const branch = resolveWorktreeBranchLabel(worktree)
    const worktreeSortIndex =
      worktreeOrder.get(getPaletteWorktreeIdentity(worktree)) ??
      worktreeOrder.get(worktree.id) ??
      Number.MAX_SAFE_INTEGER
    const isCurrentWorktree = isPaletteCurrentWorktree(
      worktree,
      activeWorktreeId,
      activeWorkspaceExecutionHostId
    )
    const activeUnifiedTabId = getActiveUnifiedTabId({
      worktreeId: worktree.id,
      isCurrentWorktree,
      activeTabType,
      activeGroupIdByWorktree,
      groupsByWorktree
    })
    const groups = groupsByWorktree[worktree.id] ?? []
    const groupOrder = new Map(groups.map((group, index) => [group.id, index]))
    const tabOrder = new Map<string, number>()
    for (const group of groups) {
      group.tabOrder.forEach((tabId, index) => tabOrder.set(tabId, index))
    }
    const terminalTabs = new Map<string, TerminalTab | null>()
    for (const terminalTab of tabsByWorktree[worktree.id] ?? []) {
      terminalTabs.set(terminalTab.id, terminalTabs.has(terminalTab.id) ? null : terminalTab)
    }
    const entryContext: PaletteTabEntryContext = {
      worktreeName,
      branch,
      repoName,
      terminalLayoutsByTabId,
      agentStatusByPaneKey,
      retainedAgentsByPaneKey,
      sleepingAgentSessionsByPaneKey,
      paneForegroundAgentByPaneKey,
      worktree,
      ambiguousWorktreeIds,
      agentIndex
    }

    const unifiedTabs = unifiedTabsByWorktree[worktree.id] ?? []
    const duplicateTabIds = findDuplicateIds(unifiedTabs)
    for (const rawTab of unifiedTabs) {
      if (
        duplicateTabIds.has(rawTab.id) ||
        !isWorkspaceTabContentType(rawTab.contentType) ||
        !isUnifiedTabOwnedByWorktree(rawTab, worktree, ambiguousWorktreeIds)
      ) {
        continue
      }
      const tab = rawTab as Tab & { contentType: WorkspaceTabContentType }
      const tabIdentity = JSON.stringify([
        getUnifiedTabPaletteExecutionHostId(tab, worktree) ?? null,
        tab.id
      ])
      if (seenTabIdentities.has(tabIdentity)) {
        continue
      }
      const baseEntry: PaletteTabBaseEntry = {
        tab,
        worktree,
        repoName,
        worktreeSortIndex,
        groupSortIndex: groupOrder.get(tab.groupId) ?? Number.MAX_SAFE_INTEGER,
        tabSortIndex: tabOrder.get(tab.id) ?? tab.sortOrder,
        isCurrentTab: isCurrentWorkspaceTab({
          tab,
          isCurrentWorktree,
          activeTabType,
          activeTabId,
          activeTabIdByWorktree,
          activeFileId,
          activeFileIdByWorktree,
          activeTabTypeByWorktree,
          activeUnifiedTabId
        }),
        isCurrentWorktree
      }
      if (tab.contentType === 'terminal') {
        const terminalTab = terminalTabs.get(tab.entityId)
        // Why null: a duplicate terminal id resolves to null so the ghost row never renders.
        if (terminalTab === null) {
          continue
        }
        seenTabIdentities.add(tabIdentity)
        entries.push(
          pushTerminalTabEntry({
            baseEntry,
            tab: tab as Tab & { contentType: 'terminal' },
            terminalTab,
            generatedTitlesEnabled,
            context: entryContext
          })
        )
        continue
      }
      if (tab.contentType === 'agent-session') {
        seenTabIdentities.add(tabIdentity)
        entries.push(
          pushAgentSessionTabEntry({
            baseEntry,
            tab: tab as Tab & { contentType: 'agent-session' },
            generatedTitlesEnabled,
            context: entryContext
          })
        )
        continue
      }
      const files = openFilesById.get(tab.entityId)
      if (files?.length !== 1) {
        continue
      }
      const file = files.find(
        (candidate) =>
          candidate.worktreeId === worktree.id &&
          (!(
            hasOpenFileExecutionHostEvidence(candidate) || ambiguousWorktreeIds.has(worktree.id)
          ) ||
            isOpenFileOwnedByWorktree(candidate, worktree))
      )
      if (!file) {
        continue
      }
      const title = getEditorDisplayLabel(file)
      seenTabIdentities.add(tabIdentity)
      entries.push({
        ...baseEntry,
        title,
        secondaryText: file.relativePath,
        titleSearchText: title,
        secondarySearchTexts: [file.relativePath, file.filePath],
        document: buildPaletteTabDocument({
          id: tab.id,
          title,
          secondaryTexts: [file.relativePath, file.filePath],
          worktreeName,
          branch,
          repoName
        }),
        agentMetadata: [],
        occupantAgent: null
      })
    }
  }
  return entries
}
