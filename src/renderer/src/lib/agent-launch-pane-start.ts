// Session-only: this pane's own spawn answers first, and its answer gates the prompt's paste.

const pendingStarts = new Map<string, (started: boolean) => void>()

// Not `makePaneKey`: that validates the leaf id, and a launch must never fail over bookkeeping.
function startKey(tabId: string, leafId: string): string {
  return JSON.stringify([tabId, leafId])
}

/** Registered before the pane exists, so its first spawn already answers it. */
export function awaitAgentLaunchPaneStart(tabId: string, leafId: string): Promise<boolean> {
  const key = startKey(tabId, leafId)
  pendingStarts.get(key)?.(false)
  return new Promise((resolve) => {
    pendingStarts.set(key, resolve)
  })
}

export function settleAgentLaunchPaneStart(
  tabId: string | undefined,
  leafId: string | undefined,
  started: boolean
): void {
  if (tabId && leafId) {
    const key = startKey(tabId, leafId)
    const settle = pendingStarts.get(key)
    pendingStarts.delete(key)
    settle?.(started)
  }
}
