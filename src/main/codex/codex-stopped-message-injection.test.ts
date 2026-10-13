// Stopped messages written into Codex's own log: one `thread/inject_items` holding each message and
// Codex's own user-role `<turn_aborted>` record, only while no turn runs, at most once.

import { describe, expect, it, vi } from 'vitest'
import { STOPPED_MESSAGE_FRAMING_BYTES } from '../../shared/agent-session-stopped-history'
import { CodexAppServerRequestError } from './codex-app-server-request-error'
import { CodexAppServerUnsupportedError } from './codex-app-server-session'
import {
  CODEX_TURN_ABORTED_MARKER,
  injectCodexStoppedMessages,
  type CodexInjectionHost
} from './codex-stopped-message-injection'

function session(answer: () => Promise<unknown> = async () => ({})) {
  const request = vi.fn(async (_method: string, _params?: Record<string, unknown>) => answer())
  const host: CodexInjectionHost = {
    ended: false,
    fence: 1,
    threadId: 'thread-1',
    activeTurnIds: new Set<string>(),
    dispatchPending: false,
    connection: { closed: false, request }
  }
  return { request, host }
}

const STOPPED = [{ clientMessageId: 'a', words: 'a' }]

function inject(host: CodexInjectionHost | undefined, messages = STOPPED) {
  return injectCodexStoppedMessages(host, { fence: 1, messages })
}

function userMessage(text: string) {
  return { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
}

describe('injecting stopped messages into Codex', () => {
  it('injects every message and its interruption in one call, as measured on 0.159.0', async () => {
    const { request, host } = session()
    const outcome = await inject(host, [
      { clientMessageId: 'a', words: 'Reply with only the word pinecone' },
      { clientMessageId: 'b', words: 'then rebuild' }
    ])

    expect(outcome).toEqual({ outcome: 'accepted' })
    expect(request.mock.calls).toEqual([
      [
        'thread/inject_items',
        {
          threadId: 'thread-1',
          items: [
            userMessage('Reply with only the word pinecone'),
            userMessage(CODEX_TURN_ABORTED_MARKER),
            userMessage('then rebuild'),
            userMessage(CODEX_TURN_ABORTED_MARKER)
          ]
        },
        { timeoutMs: 2_000 }
      ]
    ])
    expect(CODEX_TURN_ABORTED_MARKER).toBe(
      '<turn_aborted>\nThe user interrupted the previous turn on purpose. Any running unified exec processes may still be running in the background. If any tools/commands were aborted, they may have partially executed.\n</turn_aborted>'
    )
  })

  it('adds no more per message than the framing stopped history counts for it', async () => {
    const { request, host } = session()
    await inject(host, [{ clientMessageId: 'a', words: 'x' }])
    const items = request.mock.calls[0]![1]!.items
    expect(JSON.stringify(items).length - JSON.stringify('x').length).toBeLessThanOrEqual(
      STOPPED_MESSAGE_FRAMING_BYTES
    )
  })

  it('is refused, writing nothing, while a turn runs or a send is being handed over', async () => {
    for (const busy of [{ activeTurnIds: new Set(['turn-1']) }, { dispatchPending: true }]) {
      const { request, host } = session()
      expect(await inject({ ...host, ...busy })).toEqual({
        outcome: 'refused',
        reason: 'Codex is running a turn'
      })
      expect(request).not.toHaveBeenCalled()
    }
  })

  it('is refused, writing nothing, when Codex is gone or a later child took over', async () => {
    const { request, host } = session()
    for (const gone of [
      undefined,
      { ...host, ended: true },
      { ...host, fence: 2 },
      { ...host, connection: { ...host.connection, closed: true } }
    ]) {
      expect(await inject(gone)).toEqual({
        outcome: 'refused',
        reason: 'Codex ended before the injection'
      })
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('is refused by a Codex without the method, which then stops injecting for the session', async () => {
    // What Orca's connection makes of `-32601`: Codex refused it before touching history.
    const error = new CodexAppServerUnsupportedError('thread/inject_items is unsupported')
    const { host } = session(async () => {
      throw error
    })
    expect(await inject(host)).toEqual({ outcome: 'refused', reason: error.message })
    expect(host.cannotInjectHistory).toBe(true)
  })

  it('is unknown on any other error or lost contact: Codex may have recorded them', async () => {
    for (const error of [
      new CodexAppServerRequestError('thread/inject_items', -32603, 'persist failed'),
      new Error('codex app-server request timed out'),
      new Error('codex app-server connection closed')
    ]) {
      const { host } = session(async () => {
        throw error
      })
      expect(await inject(host)).toEqual({ outcome: 'unknown', reason: error.message })
      expect(host.cannotInjectHistory).toBeUndefined()
    }
  })
})
