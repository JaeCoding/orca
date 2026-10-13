import {
  AGENT_CHAT_PERMISSION_MODE_OPTION_ID,
  type AgentChatPermissionMode,
  newChatPermissionMode
} from '../../shared/agent-chat-permission-mode'
import type { AgentSessionStoreTransactions } from './agent-session-store-transactions'

/** One transaction as the chat host installs; before modes, chats ran their own agent's Arguments. */
export function backfillAgentSessionPermissionModes(
  store: AgentSessionStoreTransactions,
  ranWithFullAccess: (provider: string) => boolean
): Promise<void> {
  if (store.readOnly) {
    return Promise.resolve()
  }
  const modes = new Map<string, AgentChatPermissionMode | null>()
  const modeFor = (provider: string): AgentChatPermissionMode | null => {
    if (!modes.has(provider)) {
      const ran = ranWithFullAccess(provider) ? 'full-access' : 'ask'
      modes.set(provider, newChatPermissionMode(provider, ran))
    }
    return modes.get(provider) ?? null
  }
  return store.transact((draft) => {
    for (const [sessionId, record] of draft.records) {
      if (record.options?.[AGENT_CHAT_PERMISSION_MODE_OPTION_ID] !== undefined) {
        continue
      }
      const permissionMode = modeFor(record.provider)
      if (permissionMode) {
        draft.records.set(sessionId, {
          ...record,
          options: { ...record.options, [AGENT_CHAT_PERMISSION_MODE_OPTION_ID]: permissionMode }
        })
      }
    }
  })
}
