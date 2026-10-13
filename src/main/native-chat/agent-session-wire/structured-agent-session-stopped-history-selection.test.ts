// The handover's delivery of stopped history: never on a steer or for anything but a person's
// ordinary send, carried only by a words-only send, injected with its record written first, and
// never a reason a send fails.

import { describe, expect, it, vi } from 'vitest'
import { agentSessionFailureFact } from '../../../shared/agent-session-failure'
import { agentSessionFailureWords } from '../../../shared/agent-session-failure-words'
import { agentJournalSubmissionKey } from '../../../shared/agent-session-journal-item-key'
import {
  AGENT_JOURNAL_THREAD_SCOPE,
  type AgentJournalMessageItem,
  type AgentJournalSubmission,
  type AgentJournalTurnScope
} from '../../../shared/agent-session-journal-types'
import type { AgentSessionContextUsage } from '../../../shared/agent-session-context-usage'
import type { JournalStoppedMessageInjection } from '../agent-session-journal/journal-row-schema'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import {
  carriedStoppedHistory,
  injectStoppedHistory
} from './structured-agent-session-stopped-history-selection'

function message(text: string): AgentJournalMessageItem {
  return { kind: 'message', role: 'user', blocks: [{ type: 'text', text }] }
}

function stopped(id: string, sequence: number): AgentJournalSubmission {
  return {
    clientMessageId: id,
    fence: 1,
    payloadFingerprint: id,
    submittedAt: sequence,
    resolvedAt: sequence,
    providerItemId: null,
    handoverRecorded: true,
    acceptedSequence: sequence,
    origin: 'client',
    source: { kind: 'user' },
    dispatchState: 'rejected',
    ...agentSessionFailureWords(agentSessionFailureFact('cancelled', { neverReachedAgent: true }), {
      surface: 'rejection'
    })
  }
}

const NEXT: AgentJournalSubmission = {
  ...stopped('next', 20),
  dispatchState: 'pending',
  reason: null,
  rejection: undefined
}

function handover(
  options: {
    turnScope?: AgentJournalTurnScope
    contextUsage?: AgentSessionContextUsage
    inject?: StructuredAgentSessionAdapter['injectStoppedMessages']
    record?: (injection: JournalStoppedMessageInjection) => Promise<void>
  } = {}
) {
  const submissions = [stopped('old', 2), stopped('new', 9), NEXT]
  const recorded: JournalStoppedMessageInjection[] = []
  const logger = { warn: vi.fn(), error: vi.fn() }
  const ctx = {
    sessionId: 'session-1',
    fence: 1,
    logger,
    adapter: options.inject ? { injectStoppedMessages: options.inject } : {},
    journal: {
      submissions: () => submissions,
      liveTurnScope: () => options.turnScope ?? AGENT_JOURNAL_THREAD_SCOPE,
      contextUsage: () => options.contextUsage ?? {},
      context: { floor: () => null },
      itemBody: (itemId: string) =>
        message(
          submissions.find((entry) => agentJournalSubmissionKey(entry.clientMessageId) === itemId)!
            .clientMessageId
        ),
      stoppedHistory: {
        carried: () => new Map(),
        injected: () => new Map(),
        recordInjection: async (injection: JournalStoppedMessageInjection) => {
          await options.record?.(injection)
          recorded.push(injection)
          return { epoch: 'epoch-1', sequence: recorded.length }
        }
      }
    }
  }
  return { ctx, recorded, logger }
}

const STOPPED = [
  { clientMessageId: 'old', words: 'old' },
  { clientMessageId: 'new', words: 'new' }
]

describe('the stopped history a handover delivers', () => {
  it('a words-only send carries every owed message, oldest first', () => {
    const { ctx } = handover()
    expect(carriedStoppedHistory(ctx, NEXT, message('next'))).toEqual({
      messages: STOPPED,
      covers: ['old', 'new']
    })
  })

  it('delivers none, leaving them owed, when the agent reports a nearly full context', async () => {
    const full: AgentSessionContextUsage = {
      window: { tokens: 200_000, capturedAt: 1 },
      used: {
        kind: 'report',
        model: 'm',
        usedTokens: 199_000,
        windowTokens: 200_000,
        percentage: 99,
        categories: [],
        capturedAt: 1
      }
    }
    expect(
      carriedStoppedHistory(handover({ contextUsage: full }).ctx, NEXT, message('next'))
    ).toBeNull()
    const inject = vi.fn<NonNullable<StructuredAgentSessionAdapter['injectStoppedMessages']>>()
    const injecting = handover({ contextUsage: full, inject })
    await injectStoppedHistory(injecting.ctx, NEXT, message('next'))
    expect(inject).not.toHaveBeenCalled()
    expect(injecting.recorded).toEqual([])
  })

  it('a steer into a running turn, a slash command or a send with an image delivers none', async () => {
    const steer = handover({ turnScope: { kind: 'turn', turnItemId: 'turn-1' } })
    expect(carriedStoppedHistory(steer.ctx, NEXT, message('next'))).toBeNull()
    const inject = vi.fn<NonNullable<StructuredAgentSessionAdapter['injectStoppedMessages']>>()
    const steerInject = handover({ turnScope: { kind: 'turn', turnItemId: 'turn-1' }, inject })
    await injectStoppedHistory(steerInject.ctx, NEXT, message('next'))
    expect(inject).not.toHaveBeenCalled()
    expect(steerInject.recorded).toEqual([])

    expect(carriedStoppedHistory(handover().ctx, NEXT, message('/review'))).toBeNull()
    const withImage: AgentJournalMessageItem = {
      ...message('see'),
      blocks: [
        { type: 'text', text: 'see' },
        { type: 'image-ref', path: '/tmp/shot.png' }
      ]
    }
    expect(carriedStoppedHistory(handover().ctx, NEXT, withImage)).toBeNull()
  })
})

describe('injecting the stopped messages owed', () => {
  it('records the injection before writing it, and records nothing more when the agent took it', async () => {
    const order: string[] = []
    const inject = vi.fn(async () => {
      order.push('inject')
      return { outcome: 'accepted' as const }
    })
    const { ctx, recorded } = handover({
      inject,
      record: async () => {
        order.push('record')
      }
    })
    await injectStoppedHistory(ctx, NEXT, message('next'))

    expect(order).toEqual(['record', 'inject'])
    expect(inject).toHaveBeenCalledWith({ sessionId: 'session-1', fence: 1, messages: STOPPED })
    expect(recorded).toEqual([{ injectionId: expect.any(String), messageIds: ['old', 'new'] }])
  })

  it('records a proven refusal, so they are owed again', async () => {
    const { ctx, recorded } = handover({
      inject: async () => ({ outcome: 'refused', reason: 'Codex is running a turn' })
    })
    await injectStoppedHistory(ctx, NEXT, message('next'))

    expect(recorded).toEqual([
      { injectionId: expect.any(String), messageIds: ['old', 'new'] },
      { injectionId: recorded[0]!.injectionId, refused: true }
    ])
  })

  it('leaves an unknown or thrown injection covered, never to be injected again, and logs it', async () => {
    for (const inject of [
      async () => ({ outcome: 'unknown' as const, reason: 'timed out' }),
      async () => {
        throw new Error('lost contact')
      }
    ]) {
      const { ctx, recorded, logger } = handover({ inject })
      await injectStoppedHistory(ctx, NEXT, message('next'))

      expect(recorded).toHaveLength(1)
      expect(logger.warn).toHaveBeenCalledTimes(1)
    }
  })

  it('writes nothing to the agent when the record cannot be written, so they stay owed', async () => {
    const inject = vi.fn<NonNullable<StructuredAgentSessionAdapter['injectStoppedMessages']>>()
    const { ctx, logger } = handover({
      inject,
      record: async () => {
        throw new Error('disk full')
      }
    })
    await injectStoppedHistory(ctx, NEXT, message('next'))

    expect(inject).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})
