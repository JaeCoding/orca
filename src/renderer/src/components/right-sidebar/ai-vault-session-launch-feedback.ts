import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { agentLabel } from './ai-vault-session-filters'
import type { AiVaultAgent } from '../../../../shared/ai-vault-types'

export function notifyAiVaultSessionQueued(agent: AiVaultAgent): void {
  toast.success(
    translate(
      'auto.components.right.sidebar.AiVaultPanel.agentSessionQueued',
      '{{value0}} session queued',
      { value0: agentLabel(agent) }
    )
  )
}

export function notifyAiVaultSessionPreparationFailure(
  error: unknown,
  describeFailure: (message: string) => string = (message) => message
): void {
  toast.error(
    error instanceof Error
      ? describeFailure(error.message)
      : translate(
          'auto.components.right.sidebar.AiVaultPanel.prepareSessionResumeFailed',
          'Could not prepare this session for resume.'
        )
  )
}
