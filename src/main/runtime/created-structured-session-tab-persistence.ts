import { defaultAgentChatLabel } from '../../shared/agent-session-chat-label'
import type { StructuredAgentId } from '../../shared/agent-session-provider-handle'
import type { ExecutionHostId } from '../../shared/execution-host'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import {
  placeNewTab,
  workspaceOrEmpty
} from '../../shared/workspace-layout/workspace-layout-command-steps'
import { loadWorkspaceLayout } from '../../shared/workspace-layout/workspace-layout-load'
import { nameBasedLoadContext } from '../../shared/workspace-layout/workspace-layout-minted-ids'
import { saveWorkspaceLayout } from '../../shared/workspace-layout/workspace-layout-save'
import { getHeadlessMobileSessionGroupId } from './mobile-session-layout-projection'

/** Use the existing layout insertion path; group persistence only updates placement. */
export function insertCreatedStructuredSessionTab(
  session: WorkspaceSessionState,
  hostId: ExecutionHostId,
  input: { workspaceId: string; sessionId: string; agent: StructuredAgentId }
): WorkspaceSessionState {
  const loaded = loadWorkspaceLayout(hostId, session, nameBasedLoadContext())
  const workspace = workspaceOrEmpty(loaded.layout, input.workspaceId)
  const id = `agent-session:${input.sessionId}`
  if (workspace.tabs.some((tab) => tab.id === id)) {
    return session
  }
  loaded.layout.workspaces[input.workspaceId] = placeNewTab(
    workspace,
    {
      id,
      entityId: input.sessionId,
      kind: 'agent-session',
      agentSessionAgent: input.agent,
      customTitle: null,
      color: null,
      createdAt: Date.now()
    },
    { index: 0 },
    {
      mintId: () => getHeadlessMobileSessionGroupId(input.workspaceId),
      mintLeafId: () => id,
      now: Date.now
    }
  )
  loaded.facts.tabLabels[input.workspaceId] = {
    ...loaded.facts.tabLabels[input.workspaceId],
    [id]: defaultAgentChatLabel(input.agent)
  }
  return saveWorkspaceLayout(loaded)
}
