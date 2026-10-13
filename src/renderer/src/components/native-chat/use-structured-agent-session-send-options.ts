import { useCallback, type RefObject } from 'react'
import { AGENT_SESSION_SEND_OPTIONS_RUNTIME_CAPABILITY } from '../../../../shared/agent-session-create-capabilities'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { StructuredAgentSessionOptionState } from '../../../../shared/structured-agent-session-options'
import {
  structuredAgentSessionOptionView,
  structuredAgentSessionSendSelection,
  type StructuredAgentSessionPendingPick
} from '../../../../shared/structured-agent-session-option-view'
import { useStructuredAgentSessionHostCapability } from '@/runtime/structured-agent-session-host-capability'
import { getStructuredAgentSessionLaunchSelection } from '@/lib/structured-agent-session-launch-options'
import type { StructuredAgentSessionLaunchView } from './use-native-chat-provisional-launch'

/** What each send carries to a host that takes it: the model and effort the composer shows now. */
export function useStructuredAgentSessionSendOptions(
  target: RuntimeClientTarget,
  sessionId: string,
  launch: StructuredAgentSessionLaunchView | undefined,
  refs: {
    optionStateRef: RefObject<StructuredAgentSessionOptionState>
    pendingOptionRef: RefObject<StructuredAgentSessionPendingPick | null>
  }
): () => Readonly<Record<string, string>> | undefined {
  const { optionStateRef, pendingOptionRef } = refs
  const takesOptions = useStructuredAgentSessionHostCapability(
    target,
    AGENT_SESSION_SEND_OPTIONS_RUNTIME_CAPABILITY
  )
  return useCallback(() => {
    if (!takesOptions) {
      return undefined
    }
    // Read, not rendered: a pick the launch just took is not in this render's props yet.
    const selection = getStructuredAgentSessionLaunchSelection(sessionId)
    const view = structuredAgentSessionOptionView(
      optionStateRef.current,
      selection?.seed ?? launch?.seedOptions,
      selection?.held ?? launch?.heldOptions ?? {}
    )
    return structuredAgentSessionSendSelection(view, pendingOptionRef.current)
  }, [launch, optionStateRef, pendingOptionRef, sessionId, takesOptions])
}
