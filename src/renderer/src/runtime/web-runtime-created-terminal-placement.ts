import type { CreateWebRuntimeSessionTerminalArgs } from './web-runtime-session-types'
import { webTerminalPlacementParentTabId } from './web-session-terminal-placement'
import { refreshWebRuntimeSessionTabsSnapshot } from './web-runtime-session-snapshot'
import { settleWebRuntimeTerminalPlacement } from './web-runtime-terminal-placement-settlement'

export async function refreshCreatedWebRuntimeTerminalPlacement(
  environmentId: string,
  args: CreateWebRuntimeSessionTerminalArgs,
  createdTabId: string | undefined,
  pairingRevision: number | undefined
): Promise<void> {
  const placementTabId =
    createdTabId && (args.targetGroupId || args.afterTabId) ? createdTabId : undefined
  await refreshWebRuntimeSessionTabsSnapshot(environmentId, args.worktreeId, {
    expectedEnvironmentPairingRevision: pairingRevision,
    // Why: the publication can beat the RPC response; replay it once after caller intent exists.
    acceptCurrentSnapshot:
      Boolean(createdTabId) && (args.activate !== false || Boolean(placementTabId)),
    // Why: a placement record needs a post-create list; a deduped in-flight one can predate it.
    ...(placementTabId ? { afterCurrentInFlight: true } : {})
  })
  if (placementTabId) {
    await settleWebRuntimeTerminalPlacement(
      environmentId,
      args.worktreeId,
      webTerminalPlacementParentTabId(placementTabId),
      {
        groupId: args.targetGroupId,
        afterTabId: args.afterTabId,
        activate: args.activate !== false
      }
    )
  }
}
