import {
  AGENT_CHAT_PERMISSION_MODE_OPTION_ID,
  newChatPermissionMode
} from '../../shared/agent-chat-permission-mode'
import type { AgentSessionStoreTransactions } from './agent-session-store-transactions'

/** One startup transaction; saved choices and other provider options stay authoritative. */
export function backfillAgentSessionPermissionModes(
  store: AgentSessionStoreTransactions,
  defaultMode: unknown
): Promise<void> {
  if (store.readOnly) {
    return Promise.resolve()
  }
  return store.transact((draft) => {
    for (const [sessionId, record] of draft.records) {
      if (record.options?.[AGENT_CHAT_PERMISSION_MODE_OPTION_ID] !== undefined) {
        continue
      }
      const permissionMode = newChatPermissionMode(record.provider, defaultMode)
      if (permissionMode) {
        draft.records.set(sessionId, {
          ...record,
          options: { ...record.options, [AGENT_CHAT_PERMISSION_MODE_OPTION_ID]: permissionMode }
        })
      }
    }
  })
}
