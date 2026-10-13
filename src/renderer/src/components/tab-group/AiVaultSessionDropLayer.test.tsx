// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readPayload: vi.fn(),
  prepareSessionResume: vi.fn(),
  launch: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@/lib/ai-vault-session-drag', () => ({
  AI_VAULT_SESSION_DRAG_END_EVENT: 'drag-end',
  AI_VAULT_SESSION_DRAG_START_EVENT: 'drag-start',
  clearAiVaultSessionDragData: vi.fn(),
  hasAiVaultSessionDragData: () => true,
  readAiVaultSessionDragData: mocks.readPayload
}))
vi.mock('@/lib/ai-vault-session-resume-preparation', () => ({
  prepareAiVaultSessionResumeRequest: mocks.prepareSessionResume
}))
vi.mock('@/lib/ai-vault-resume-target', () => ({
  canResumeAiVaultSessionOnTarget: () => true,
  getAiVaultResumeWorkspaceExecutionHostId: () => 'local',
  getAiVaultResumeWorkspaceTargetStatus: () => 'local'
}))
vi.mock('@/lib/ai-vault-resume-shell', () => ({ getAiVaultResumeWorkspaceWslDistro: () => null }))
vi.mock('@/lib/launch-ai-vault-session', () => ({ launchAiVaultSessionInNewTab: mocks.launch }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('./tab-drop-zone', () => ({ resolveDropZone: () => 'center' }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }))

import AiVaultSessionDropLayer from './AiVaultSessionDropLayer'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepareSessionResume.mockRejectedValue(new Error('agent_session_conflict'))
})

afterEach(() => cleanup())

describe('Session History drop', () => {
  it.each(['claude', 'omp', 'codex'] as const)(
    'prepares a stale %s row and refuses before terminal launch',
    async (agent) => {
      mocks.readPayload.mockReturnValue({
        agent,
        sessionId: 'session-1',
        sessionFilePath: '/tmp/session.jsonl',
        sessionExecutionHostId: 'local',
        codexHome: null,
        command: 'resume session-1'
      })
      const view = render(<AiVaultSessionDropLayer worktreeId="folder:folder-1" enabled />)
      const pane = document.createElement('div')
      pane.dataset.tabGroupBodyId = 'group-1'
      pane.dataset.worktreeId = 'folder:folder-1'
      pane.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100)
      view.container.append(pane)

      const layer = view.container.querySelector('[data-ai-vault-session-drop-layer]')
      if (!layer) {
        throw new Error('Drop layer missing')
      }
      layer.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100)
      const event = new MouseEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10
      })
      Object.defineProperty(event, 'dataTransfer', {
        value: { types: ['application/x-orca-ai-vault-session'] }
      })
      fireEvent(layer, event)

      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
      expect(mocks.prepareSessionResume).toHaveBeenCalledWith({
        agent,
        sessionId: 'session-1',
        filePath: '/tmp/session.jsonl',
        executionHostId: 'local',
        codexHome: null
      })
      expect(mocks.launch).not.toHaveBeenCalled()
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
    }
  )
})
