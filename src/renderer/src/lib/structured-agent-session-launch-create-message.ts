import { structuredAgentSessionCreateFingerprint } from '../../../shared/structured-agent-session-mutation'
import type { StructuredLaunchState } from './structured-agent-session-launch-registry'
import { notifyStructuredLaunchListeners } from './structured-agent-session-launch-registry'
import {
  prepareStructuredLaunchPromptForCreate,
  prepareLegacyStructuredLaunchPrompts
} from './structured-agent-session-launch-prompt'
import type { StructuredAgentLaunchReceipt } from './structured-agent-session-launch-recovery'
import { structuredAgentSessionListedPicks } from '../../../shared/structured-agent-session-option-view'
import { firstFrameOptionState } from '@/components/native-chat/use-structured-agent-session-option-state'
import {
  applyStructuredLaunchHeldOptions,
  settleStructuredLaunchCreateOptions
} from './structured-agent-session-launch-options'

/** Freeze what create carries once; an ambiguous reply always replays the same payload. */
export function prepareStructuredLaunchCreateMessage(state: StructuredLaunchState): void {
  const { intent } = state
  if (intent.createPrepared) {
    return
  }
  if (intent.createMessageSupport !== true) {
    prepareLegacyStructuredLaunchPrompts(intent.sessionId)
    intent.createPrepared = true
    notifyStructuredLaunchListeners()
    return
  }
  const firstMessage = prepareStructuredLaunchPromptForCreate(intent.sessionId, intent.target)
  const options = structuredLaunchCreateOptions(state)
  const params = {
    ...intent.params,
    ...(firstMessage ? { firstMessage } : {}),
    ...(options ? { options } : {})
  }
  intent.params = {
    ...params,
    envelope: {
      ...params.envelope,
      payloadFingerprint: structuredAgentSessionCreateFingerprint({
        sessionId: intent.sessionId,
        ...params
      })
    }
  }
  intent.createPrepared = true
  notifyStructuredLaunchListeners()
}

/** Picks held so far, and what the host's saved list moves a model it no longer names to: a first
 *  message starts its turn on the model the chat shows, as a later send does. */
function structuredLaunchCreateOptions(
  state: StructuredLaunchState
): Readonly<Record<string, string>> | undefined {
  const { intent, selection } = state
  // A resumed conversation runs the model it ran; only a new one starts from the saved selection.
  const shown = intent.params.resumeFrom
    ? null
    : firstFrameOptionState(intent.agent, intent.target, {
        newLaunch: true,
        worktree: intent.params.worktree,
        seedsModel: intent.seedOptions?.model !== undefined
      })
  const options = {
    ...selection.held,
    ...(shown && structuredAgentSessionListedPicks(shown, intent.seedOptions, selection.held))
  }
  return Object.keys(options).length ? options : undefined
}

/** Later picks use the normal option path without holding publication behind startup. */
export function publishStructuredLaunchCreateOptions(
  state: StructuredLaunchState,
  receipt: StructuredAgentLaunchReceipt
): StructuredAgentLaunchReceipt | Promise<StructuredAgentLaunchReceipt> {
  if (state.intent.createMessageSupport !== true) {
    return applyStructuredLaunchHeldOptions(state, receipt)
  }
  settleStructuredLaunchCreateOptions(state, state.intent.params.options ?? {})
  void applyStructuredLaunchHeldOptions(state, receipt).catch((error: unknown) => {
    console.warn('[native-chat] applying a launch option failed', error)
  })
  return receipt
}
