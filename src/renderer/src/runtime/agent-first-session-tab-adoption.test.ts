// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import { structuredAgentSessionTabId } from '../../../shared/structured-agent-session-projection'
import { applyLocalStructuredSessionTabSnapshots } from './local-structured-session-tabs-sync/snapshot-apply'
import { resetLocalStructuredSessionVersionForTests } from './local-structured-session-tabs-sync/inventory-generation-fence'
import { applyWebSessionTabsSnapshot } from './web-session-tabs-sync/snapshot-api'
import {
  ENV,
  LEAF_ID,
  NOW,
  WT,
  makeSnapshot,
  makeState,
  resetWebSessionTabsSyncTestState
} from './web-session-tabs-sync-test-harness'

afterEach(() => {
  resetLocalStructuredSessionVersionForTests()
  resetWebSessionTabsSyncTestState()
})

const terminal: RuntimeMobileSessionTabsResult['tabs'][number] = {
  type: 'terminal',
  id: `setup::${LEAF_ID}`,
  parentTabId: 'setup',
  leafId: LEAF_ID,
  title: 'Setup',
  isActive: true,
  status: 'ready',
  terminal: 'term-setup'
}

describe('first adoption of a new workspace agent', () => {
  it.each(['local', 'paired'] as const)(
    'inserts the agent first in the %s renderer and preserves later user moves',
    (owner) => {
      const setup = makeSnapshot([terminal], {
        tabGroups: [{ id: 'host-group-1', activeTabId: 'setup', tabOrder: ['setup'] }]
      })
      const empty = makeState()
      let state = { ...empty, ...applyWebSessionTabsSnapshot(empty, setup, ENV, NOW) }
      const terminalId = state.groupsByWorktree[WT][0].tabOrder[0]
      const agentId = 'agent-session:chat-1'
      const localAgentId = structuredAgentSessionTabId('chat-1')
      const snapshot = makeSnapshot(
        [
          {
            type: 'agent-session',
            id: agentId,
            sessionId: 'chat-1',
            agent: 'claude',
            title: 'Claude Chat',
            isActive: false,
            initialTabPosition: 'first'
          },
          terminal
        ],
        {
          snapshotVersion: 2,
          tabGroups: [{ id: 'host-group-1', activeTabId: 'setup', tabOrder: [agentId, 'setup'] }]
        }
      )
      const apply = (frame: RuntimeMobileSessionTabsResult) =>
        owner === 'local'
          ? applyLocalStructuredSessionTabSnapshots(state, [frame])
          : { ...state, ...applyWebSessionTabsSnapshot(state, frame, ENV, NOW) }
      const active = state.activeTabId
      state = apply(snapshot)
      expect(state.groupsByWorktree[WT][0].tabOrder).toEqual([localAgentId, terminalId])
      expect(state.activeTabId).toBe(active)
      state = {
        ...state,
        groupsByWorktree: {
          ...state.groupsByWorktree,
          [WT]: state.groupsByWorktree[WT].map((group) => ({
            ...group,
            tabOrder: [terminalId, localAgentId]
          }))
        }
      }
      state = apply({ ...snapshot, snapshotVersion: 3 })
      expect(state.groupsByWorktree[WT][0].tabOrder).toEqual([terminalId, localAgentId])
      state = apply({
        ...snapshot,
        snapshotVersion: 4,
        tabs: [
          ...snapshot.tabs,
          {
            type: 'agent-session',
            id: 'agent-session:later',
            sessionId: 'later',
            agent: 'claude',
            title: 'Claude Chat',
            isActive: false
          }
        ]
      })
      expect(state.groupsByWorktree[WT][0].tabOrder).toEqual([
        terminalId,
        localAgentId,
        structuredAgentSessionTabId('later')
      ])
    }
  )
})
