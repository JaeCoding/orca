// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ supported: true }))

vi.mock('@/lib/structured-agent-session-launch-options', () => ({
  getStructuredAgentSessionLaunchSelection: () => null
}))
vi.mock('@/runtime/structured-agent-session-host-capability', () => ({
  useStructuredAgentSessionHostCapability: () => mocks.supported
}))

import { CLAUDE_SESSION_OPTION_CATALOG } from '../../../../shared/agent-session-option-catalog-claude-codex'
import {
  applyStructuredAgentSessionModelCatalog,
  createStructuredAgentSessionOptionState
} from '../../../../shared/structured-agent-session-options'
import type { StructuredAgentSessionPendingPick } from '../../../../shared/structured-agent-session-option-view'
import { useStructuredAgentSessionSendOptions } from './use-structured-agent-session-send-options'

const levels = (...values: string[]) => values.map((value) => ({ value, label: value }))

function sendOptionsFor(supported: boolean, pending: StructuredAgentSessionPendingPick | null) {
  mocks.supported = supported
  const optionStateRef = {
    current: applyStructuredAgentSessionModelCatalog(
      createStructuredAgentSessionOptionState('claude', CLAUDE_SESSION_OPTION_CATALOG),
      CLAUDE_SESSION_OPTION_CATALOG,
      {
        origin: 'probe',
        fetchedAt: 1,
        models: [
          { id: 'opus[1m]', label: 'Opus', isDefault: false, efforts: levels('low', 'xhigh') }
        ]
      },
      { newLaunch: true }
    )
  }
  const { result } = renderHook(() =>
    useStructuredAgentSessionSendOptions(
      { kind: 'local' },
      'session-1',
      { kind: 'new', seedOptions: { model: 'claude-gone', effort: 'max' }, heldOptions: {} },
      { optionStateRef, pendingOptionRef: { current: pending } }
    )
  )
  return result.current
}

describe('what each composer send carries', () => {
  it('carries the shown model and effort to a host that takes them, on every send', () => {
    const sendOptions = sendOptionsFor(true, null)
    expect(sendOptions()).toEqual({ model: 'opus[1m]', effort: 'xhigh' })
    expect(sendOptions()).toEqual({ model: 'opus[1m]', effort: 'xhigh' })
  })

  it('carries a pick still on its way', () => {
    expect(sendOptionsFor(true, { id: 'model', value: 'sonnet' })()).toEqual({ model: 'sonnet' })
  })

  it('carries nothing to an older host', () => {
    expect(sendOptionsFor(false, null)()).toBeUndefined()
  })
})
