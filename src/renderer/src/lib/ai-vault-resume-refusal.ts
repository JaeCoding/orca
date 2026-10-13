import { aiVaultAgentLabel, type AiVaultAgent } from '../../../shared/ai-vault-types'
import { translate } from '@/i18n/i18n'
import { compactIpcErrorMessage } from './ipc-error'

export function isAiVaultOwnershipRefusal(message: string): boolean {
  const code = compactIpcErrorMessage(message)
  return code === 'agent_session_conflict' || code === 'agent_session_ownership_unknown'
}

export function describeAiVaultResumeFailure(error: unknown, agent: AiVaultAgent): string {
  const message = error instanceof Error ? error.message : null
  const code = message ? compactIpcErrorMessage(message) : null
  if (code === 'agent_session_conflict') {
    return translate(
      'auto.lib.aiVaultResumeRefusal.openInChat',
      '{{value0}} is already open in a native chat. Open that chat, or choose Resume in New CLI to make a copy.',
      { value0: aiVaultAgentLabel(agent) }
    )
  }
  if (code === 'agent_session_ownership_unknown') {
    return translate(
      'auto.lib.aiVaultResumeRefusal.ownershipUnknown',
      'Orca cannot safely resume this {{value0}} session in a terminal. Open its native chat and try again.',
      { value0: aiVaultAgentLabel(agent) }
    )
  }
  return (
    message ??
    translate(
      'auto.components.right.sidebar.AiVaultPanel.prepareSessionResumeFailed',
      'Could not prepare this session for resume.'
    )
  )
}
