import type { Tab } from '../tab-types'

type PinnedTab = Pick<Tab, 'id' | 'isPinned'>

export function dedupeTabOrder(tabIds: string[]): string[] {
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const tabId of tabIds) {
    if (seen.has(tabId)) {
      continue
    }
    seen.add(tabId)
    deduped.push(tabId)
  }
  return deduped
}

export function partitionPinnedTabOrder(
  tabOrder: string[],
  tabs: readonly PinnedTab[],
  movingTabId: string
): string[] {
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]))
  const withoutMoving = dedupeTabOrder(tabOrder).filter((id) => id !== movingTabId)
  const pinnedIds = withoutMoving.filter((id) => tabById.get(id)?.isPinned)
  const unpinnedIds = withoutMoving.filter((id) => !tabById.get(id)?.isPinned)
  return [...pinnedIds, movingTabId, ...unpinnedIds]
}

export function applyTabOrderSortValues(tabs: Tab[], tabOrder: string[]): Tab[] {
  const orderMap = new Map(tabOrder.map((id, index) => [id, index]))
  return tabs.map((tab) => {
    const sortOrder = orderMap.get(tab.id)
    return sortOrder === undefined || sortOrder === tab.sortOrder ? tab : { ...tab, sortOrder }
  })
}

/**
 * Insert `tabId` after `anchorTabId` when both share a pin partition; otherwise at the end of the
 * new tab's partition. Explicit first placement starts that partition. Siblings keep their order.
 */
export function insertTabIdIntoOrder(
  tabOrder: readonly string[],
  tabs: readonly PinnedTab[],
  tabId: string,
  isPinned: boolean,
  anchorTabId?: string,
  position?: 'first'
): string[] {
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]))
  const order = dedupeTabOrder([...tabOrder]).filter((id) => id !== tabId)
  const firstUnpinnedIndex = order.findIndex((id) => !tabById.get(id)?.isPinned)
  const pinnedPrefixEnd = firstUnpinnedIndex === -1 ? order.length : firstUnpinnedIndex
  const anchorIndex = anchorTabId ? order.indexOf(anchorTabId) : -1
  const anchorIsPinned = anchorIndex !== -1 && tabById.get(order[anchorIndex])?.isPinned === true
  let index =
    position === 'first'
      ? isPinned
        ? 0
        : pinnedPrefixEnd
      : isPinned
        ? pinnedPrefixEnd
        : order.length
  if (position !== 'first' && anchorIndex !== -1) {
    index = anchorIsPinned === isPinned ? anchorIndex + 1 : pinnedPrefixEnd
  }
  order.splice(index, 0, tabId)
  return order
}

export function isReplaceablePreviewContentType(contentType: Tab['contentType']): boolean {
  return (
    contentType === 'editor' ||
    contentType === 'diff' ||
    contentType === 'conflict-review' ||
    contentType === 'check-details' ||
    contentType === 'chat-visual'
  )
}

/** Reinsert a missing tab beside its surviving predecessor without rotating its siblings. */
export function insertTabIdAtPreviousPosition(
  tabOrder: readonly string[],
  previousOrder: readonly string[],
  tabId: string
): string[] {
  const order = dedupeTabOrder([...tabOrder]).filter((id) => id !== tabId)
  const previousIndex = previousOrder.indexOf(tabId)
  if (previousIndex === -1) {
    return [...order, tabId]
  }
  const preceding = previousOrder.slice(0, previousIndex).findLast((id) => order.includes(id))
  order.splice(preceding ? order.indexOf(preceding) + 1 : 0, 0, tabId)
  return order
}

export function canReplacePreviewContentType(
  incomingContentType: Tab['contentType'],
  existingContentType: Tab['contentType']
): boolean {
  if (isReplaceablePreviewContentType(incomingContentType)) {
    return isReplaceablePreviewContentType(existingContentType)
  }
  return existingContentType === incomingContentType
}
