import { defaultAgentChatLabel } from '../../shared/agent-session-chat-label'
import type { StructuredAgentId } from '../../shared/agent-session-provider-handle'
import type {
  RuntimeMobileSessionAgentTab,
  RuntimeMobileSessionTabsSnapshot
} from '../../shared/runtime-types'
import type { TabGroup } from '../../shared/tab-types'
import {
  insertTabIdAtPreviousPosition,
  insertTabIdIntoOrder
} from '../../shared/workspace-layout/tab-order'
import { getHeadlessMobileSessionGroupId } from './mobile-session-layout-projection'

export function buildNewStructuredSessionTabSnapshot(
  existing: RuntimeMobileSessionTabsSnapshot | undefined,
  input: {
    workspaceId: string
    sessionId: string
    agent: StructuredAgentId
    activate: boolean
    tabPosition?: 'first'
  },
  savedGroup: TabGroup | undefined
): RuntimeMobileSessionTabsSnapshot {
  const id = `agent-session:${input.sessionId}`
  const tab: RuntimeMobileSessionAgentTab = {
    type: 'agent-session',
    id,
    title: defaultAgentChatLabel(input.agent),
    sessionId: input.sessionId,
    agent: input.agent,
    isActive: input.activate,
    ...(input.tabPosition ? { initialTabPosition: input.tabPosition } : {})
  }
  const siblings = (existing?.tabs ?? []).map((candidate) => ({
    ...candidate,
    isActive: input.activate ? false : candidate.isActive
  }))
  const tabs = input.tabPosition === 'first' ? [tab, ...siblings] : [...siblings, tab]
  const priorGroups = existing?.tabGroups ?? [
    {
      id: getHeadlessMobileSessionGroupId(input.workspaceId),
      activeTabId: existing?.activeTabId ?? null,
      tabOrder: []
    }
  ]
  const groupId =
    priorGroups.find((group) => group.id === savedGroup?.id)?.id ??
    priorGroups.find((group) => group.id === existing?.activeGroupId)?.id ??
    priorGroups[0]!.id
  const tabGroups = priorGroups.map((group) =>
    group.id === groupId
      ? {
          ...group,
          activeTabId: input.activate ? id : group.activeTabId,
          tabOrder:
            input.tabPosition === 'first'
              ? insertTabIdIntoOrder(
                  group.tabOrder,
                  existing?.tabs ?? [],
                  id,
                  false,
                  undefined,
                  'first'
                )
              : insertTabIdAtPreviousPosition(group.tabOrder, savedGroup?.tabOrder ?? [], id)
        }
      : group
  )
  return {
    worktree: input.workspaceId,
    publicationEpoch: existing?.publicationEpoch ?? `structured:${Date.now().toString(36)}`,
    snapshotVersion: (existing?.snapshotVersion ?? 0) + 1,
    activeGroupId: input.activate ? groupId : (existing?.activeGroupId ?? groupId),
    activeTabId: input.activate ? id : (existing?.activeTabId ?? null),
    activeTabType: input.activate ? 'agent-session' : (existing?.activeTabType ?? null),
    tabGroups,
    ...(existing?.tabGroupLayout ? { tabGroupLayout: existing.tabGroupLayout } : {}),
    tabs
  }
}
