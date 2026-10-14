import type { ReadableAgentAttentionUnread } from '@/attention/agent-attention-contract'
import {
  resolveTerminalTabAttentionBadge,
  terminalTabHasUnreadActivity
} from '@/components/tab-bar/terminal-tab-activity-status'
import { resolveRecentWorkspaceTabStatus } from '@/lib/recent-workspace-tab-rows'
import type { TabPaneInputSources } from '@/components/sidebar/smart-attention'
import type { OpenTabPaletteItem, OpenTabRecentRow } from './worktree-jump-palette-model'
import type { Worktree } from '../../../shared/worktree/types'

function isCurrentOpenTabItem(item: OpenTabPaletteItem): boolean {
  return item.type === 'browser-page' ? item.result.isCurrentPage : item.result.isCurrentTab
}

export function shouldIncludeOpenTabInRecentSection({
  item,
  worktree,
  row,
  paneSources,
  unreadTerminalTabs,
  unreadAgentCompletionPanes,
  now
}: {
  item: OpenTabPaletteItem
  worktree: Worktree
  row: OpenTabRecentRow['row']
  paneSources: TabPaneInputSources
  unreadTerminalTabs: Record<string, ReadableAgentAttentionUnread>
  unreadAgentCompletionPanes: Record<string, ReadableAgentAttentionUnread>
  now: number
}): boolean {
  if (worktree.isArchived) {
    return false
  }
  if (!isCurrentOpenTabItem(item)) {
    return true
  }
  // Why: the badge gate below reads terminal-tab attention state; agent-session
  // rows have no terminal tab and are always offered, like non-current rows.
  if (item.type === 'workspace-tab' && item.result.contentType === 'agent-session') {
    return true
  }
  if (!row.terminalTab) {
    return false
  }
  const badge = resolveTerminalTabAttentionBadge({
    status: resolveRecentWorkspaceTabStatus(row, paneSources, now),
    hasUnread: terminalTabHasUnreadActivity({
      terminalTabId: row.terminalTab.id,
      unreadTerminalTabs,
      unreadAgentCompletionPanes
    })
  })
  // Why: a settled outcome on the tab you are on is not news; a failure ranks like a completion.
  return (
    badge != null &&
    badge !== 'done' &&
    badge !== 'failed' &&
    badge !== 'interrupted' &&
    badge !== 'unconfirmed'
  )
}
