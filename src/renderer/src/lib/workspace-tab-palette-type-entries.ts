import {
  resolveTerminalTabTitle,
  resolveUnifiedTabLabel
} from '../../../shared/tab-title-resolution'
import type { Tab } from '../../../shared/tab-types'
import { buildPaletteTabDocument } from './palette-match/tab-document'
import { resolveOpenTabOccupantAgent } from './open-tab-occupant-agent'
import {
  collectAgentMetadataFromIndex,
  type AgentMetadataTabIndex
} from './workspace-tab-agent-metadata'
import type {
  BuildSearchableWorkspaceTabsOptions,
  SearchableWorkspaceTab,
  WorkspaceTabContentType
} from './workspace-tab-palette-search'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type { Worktree } from '../../../shared/worktree/types'
import { isTuiAgent } from '../../../shared/tui-agent-config'

/** Everything the type-specific entry builders below need per worktree. */
export type PaletteTabEntryContext = {
  worktreeName: string
  branch: string
  repoName: string
  terminalLayoutsByTabId: BuildSearchableWorkspaceTabsOptions['terminalLayoutsByTabId']
  agentStatusByPaneKey: BuildSearchableWorkspaceTabsOptions['agentStatusByPaneKey']
  retainedAgentsByPaneKey: BuildSearchableWorkspaceTabsOptions['retainedAgentsByPaneKey']
  sleepingAgentSessionsByPaneKey: BuildSearchableWorkspaceTabsOptions['sleepingAgentSessionsByPaneKey']
  paneForegroundAgentByPaneKey: BuildSearchableWorkspaceTabsOptions['paneForegroundAgentByPaneKey']
  worktree: Worktree
  ambiguousWorktreeIds: ReadonlySet<string>
  agentIndex: AgentMetadataTabIndex
}

/** Fields shared by every entry: identity + sort + current-tab stamp. */
export type PaletteTabBaseEntry = Pick<
  SearchableWorkspaceTab,
  | 'tab'
  | 'worktree'
  | 'repoName'
  | 'worktreeSortIndex'
  | 'groupSortIndex'
  | 'tabSortIndex'
  | 'isCurrentTab'
  | 'isCurrentWorktree'
>

export function pushTerminalTabEntry({
  baseEntry,
  tab,
  terminalTab,
  generatedTitlesEnabled,
  context
}: {
  baseEntry: PaletteTabBaseEntry
  tab: Tab & { contentType: 'terminal' }
  terminalTab: TerminalTab | null | undefined
  generatedTitlesEnabled: boolean
  context: PaletteTabEntryContext
}): SearchableWorkspaceTab {
  const terminalTitle = terminalTab
    ? resolveTerminalTabTitle(terminalTab, generatedTitlesEnabled, 'Terminal')
    : 'Terminal'
  const title = resolveUnifiedTabLabel(
    {
      ...tab,
      customLabel: tab.customLabel ?? terminalTab?.customTitle ?? null,
      quickCommandLabel: tab.quickCommandLabel ?? terminalTab?.quickCommandLabel,
      generatedLabel: tab.generatedLabel ?? terminalTab?.generatedTitle
    },
    generatedTitlesEnabled,
    terminalTitle
  )
  const typeAliases = ['terminal tab', 'terminal']
  return {
    ...baseEntry,
    title,
    secondaryText: '',
    titleSearchText: title,
    secondarySearchTexts: [],
    typeSearchAliases: typeAliases,
    document: buildPaletteTabDocument({
      id: tab.id,
      title,
      secondaryTexts: [],
      worktreeName: context.worktreeName,
      branch: context.branch,
      repoName: context.repoName,
      typeAliases
    }),
    agentMetadata: collectAgentMetadataFromIndex(
      context.agentIndex,
      tab.entityId,
      context.worktree,
      context.ambiguousWorktreeIds
    ),
    occupantAgent: resolveOpenTabOccupantAgent({
      tabId: tab.entityId,
      title,
      defaultTitle: terminalTab?.defaultTitle,
      launchAgent: terminalTab?.launchAgent,
      layout: context.terminalLayoutsByTabId?.[tab.entityId],
      agentStatusByPaneKey: context.agentStatusByPaneKey,
      retainedAgentsByPaneKey: context.retainedAgentsByPaneKey,
      sleepingAgentSessionsByPaneKey: context.sleepingAgentSessionsByPaneKey,
      paneForegroundAgentByPaneKey: context.paneForegroundAgentByPaneKey
    })
  }
}

export function pushAgentSessionTabEntry({
  baseEntry,
  tab,
  generatedTitlesEnabled,
  context
}: {
  baseEntry: PaletteTabBaseEntry
  tab: Tab & { contentType: Extract<WorkspaceTabContentType, 'agent-session'> }
  generatedTitlesEnabled: boolean
  context: PaletteTabEntryContext
}): SearchableWorkspaceTab {
  // Why resolveUnifiedTabLabel: the conversation title lives in `label`;
  // customLabel stays authoritative so a renamed session keeps its name.
  const title = resolveUnifiedTabLabel(tab, generatedTitlesEnabled, 'Agent session')
  const typeAliases = ['agent session', 'chat', 'native chat']
  return {
    ...baseEntry,
    title,
    secondaryText: '',
    titleSearchText: title,
    secondarySearchTexts: [],
    typeSearchAliases: typeAliases,
    document: buildPaletteTabDocument({
      id: tab.id,
      title,
      secondaryTexts: [],
      worktreeName: context.worktreeName,
      branch: context.branch,
      repoName: context.repoName,
      typeAliases
    }),
    // Why collectAgentMetadataFromIndex: structured sessions report status
    // under the unified tab id, so the same anchor works for prompts and
    // task titles as the terminal branch.
    agentMetadata: collectAgentMetadataFromIndex(
      context.agentIndex,
      tab.entityId,
      context.worktree,
      context.ambiguousWorktreeIds
    ),
    occupantAgent: isTuiAgent(tab.agentSessionAgent) ? tab.agentSessionAgent : null
  }
}
