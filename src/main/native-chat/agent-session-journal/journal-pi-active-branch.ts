import type { AgentJournalItemIdentity } from '../../../shared/agent-session-journal-types'
import type { NativeChatMessage } from '../../../shared/native-chat-types'

export type PiTranscriptBranchEntry = {
  id: string
  parentId: string | null
  message: NativeChatMessage | null
  identity: AgentJournalItemIdentity
}

/** Pi reloads the last persisted entry, then follows its parent chain. */
export function selectActivePiBranch(entries: readonly PiTranscriptBranchEntry[]): {
  messages: NativeChatMessage[]
  identities: AgentJournalItemIdentity[]
} {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  if (byId.size !== entries.length) {
    throw new Error('Pi session has duplicate branch identities')
  }
  const branch: PiTranscriptBranchEntry[] = []
  const visited = new Set<string>()
  let current = entries.at(-1)
  while (current) {
    if (visited.has(current.id)) {
      throw new Error('Pi session branch contains a cycle')
    }
    visited.add(current.id)
    branch.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  const messages: NativeChatMessage[] = []
  const identities: AgentJournalItemIdentity[] = []
  for (const entry of branch.toReversed()) {
    if (entry.message) {
      messages.push(entry.message)
      identities.push(entry.identity)
    }
  }
  return { messages, identities }
}
