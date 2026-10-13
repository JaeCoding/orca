import { describe, expect, it } from 'vitest'
import { agentSessionFailureFact, type SubmissionRejectionKind } from './agent-session-failure'
import { agentSessionFailureWords } from './agent-session-failure-words'
import type {
  AgentJournalItemBody,
  AgentJournalMessageItem,
  AgentJournalSubmission
} from './agent-session-journal-types'
import { MAX_PROMPT_BYTES } from './rpc-contract/structured-agent-session-message-params'
import {
  agentSessionSendCarriesStoppedHistory,
  agentSessionSendDeliversStoppedHistory,
  agentSessionStoppedHistoryOwed,
  selectStoppedHistory,
  STOPPED_MESSAGE_FRAMING_BYTES,
  withStoppedHistory,
  type StoppedHistoryJournal
} from './agent-session-stopped-history'

function message(
  text: string,
  extra: Partial<AgentJournalMessageItem> = {}
): AgentJournalMessageItem {
  return {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text }],
    ...extra
  }
}

function sent(
  id: string,
  sequence: number,
  extra: Partial<AgentJournalSubmission> = {}
): AgentJournalSubmission {
  return {
    clientMessageId: id,
    fence: 1,
    payloadFingerprint: `fp-${id}`,
    dispatchState: 'pending',
    providerItemId: null,
    reason: null,
    submittedAt: sequence,
    resolvedAt: null,
    handoverRecorded: true,
    acceptedSequence: sequence,
    origin: 'client',
    source: { kind: 'user' },
    ...extra
  }
}

function rejected(
  kind: SubmissionRejectionKind,
  extra: { neverReachedAgent?: true } = {}
): Partial<AgentJournalSubmission> {
  return {
    dispatchState: 'rejected',
    ...agentSessionFailureWords(agentSessionFailureFact(kind, extra), {
      surface: 'rejection'
    })
  }
}

/** A Stop's withdrawal with proof the agent never got it. */
const STOPPED = rejected('cancelled', { neverReachedAgent: true })

function owed(
  submissions: AgentJournalSubmission[],
  options: {
    carried?: Record<string, string[]>
    injected?: Record<string, string[]>
    clearSequence?: number
    bodies?: Record<string, AgentJournalItemBody>
  } = {}
): string[] {
  const journal: StoppedHistoryJournal = {
    submissions,
    carried: new Map(Object.entries(options.carried ?? {})),
    injected: new Map(
      Object.entries(options.injected ?? {}).map(([id, messageIds]) => [id, { messageIds }])
    ),
    clearSequence: options.clearSequence ?? 0,
    body: (id) => options.bodies?.[id] ?? message(id)
  }
  return agentSessionStoppedHistoryOwed(journal).map((entry) => entry.clientMessageId)
}

describe('which stopped messages the agent is owed', () => {
  it("owes a person's own sends a Stop took back unwritten, in the order they were sent", () => {
    expect(owed([sent('b', 5, STOPPED), sent('a', 2, STOPPED), sent('live', 7)])).toEqual([
      'a',
      'b'
    ])
  })

  it('never owes a withdrawal without proof it never reached the agent, as old journals hold', () => {
    expect(owed([sent('a', 2, rejected('cancelled'))])).toEqual([])
  })

  it('never owes a send in doubt, such as one Claude had started when Stop cancelled it', () => {
    expect(owed([sent('a', 2, { dispatchState: 'unknown', reason: 'doubt' })])).toEqual([])
  })

  it('never owes mail, a task preamble, a queued card, a command, a goal or a typed slash command', () => {
    const bodies: Record<string, AgentJournalItemBody> = {
      command: message('/compact', { command: { name: 'compact' } }),
      goal: message('ship it', { sentAs: 'goal' }),
      mail: message('mail', {
        from: { kind: 'agent', senders: [], orchestration: null }
      })
    }
    expect(
      owed(
        [
          sent('mail', 1, { ...STOPPED, source: { kind: 'agent' } }),
          sent('mailBody', 2, STOPPED),
          sent('preamble', 3, {
            ...STOPPED,
            source: undefined,
            origin: 'host'
          }),
          sent('card', 4, { ...STOPPED, queuedMessageId: 'card' }),
          sent('command', 5, STOPPED),
          sent('goal', 6, STOPPED),
          sent('slash', 7, STOPPED)
        ],
        {
          bodies: {
            ...bodies,
            mailBody: bodies.mail!,
            slash: message('/review foo')
          }
        }
      )
    ).toEqual([])
  })

  it('owes a stopped message by its words alone, and none that has no words', () => {
    const image = { type: 'image-ref' as const, path: '/tmp/shot.png' }
    const journal: StoppedHistoryJournal = {
      submissions: [sent('a', 2, STOPPED), sent('b', 3, STOPPED)],
      carried: new Map(),
      injected: new Map(),
      clearSequence: 0,
      body: (id) =>
        id === 'a'
          ? message('', { blocks: [image] })
          : message('', {
              blocks: [{ type: 'text', text: 'look' }, image, { type: 'text', text: 'here' }]
            })
    }
    expect(agentSessionStoppedHistoryOwed(journal)).toEqual([
      { clientMessageId: 'b', words: 'look\nhere' }
    ])
  })

  it('owes nothing from before the latest /clear', () => {
    expect(
      owed([sent('old', 2, STOPPED), sent('new', 9, STOPPED)], {
        clearSequence: 5
      })
    ).toEqual(['new'])
  })

  it('a carrier accepted, pending, in doubt or refused after a possible write covers what it carried', () => {
    for (const carrier of [
      sent('c', 9, { dispatchState: 'accepted' }),
      sent('c', 9),
      sent('c', 9, {
        dispatchState: 'unknown',
        reason: 'lost',
        recovered: true
      }),
      sent('c', 9, rejected('providerRejected')),
      sent('c', 9, rejected('notSignedIn')),
      sent('c', 9, rejected('providerExited')),
      sent('c', 9, rejected('hostFault')),
      sent('c', 9, rejected('cancelled')),
      sent('c', 9, {
        ...STOPPED,
        answeredInTurn: { turnItemId: 'turn', via: 'start' }
      })
    ]) {
      expect(owed([sent('a', 2, STOPPED), carrier], { carried: { c: ['a'] } })).toEqual([])
    }
  })

  it('a carrier refused before any write leaves what it carried owed again', () => {
    for (const kind of ['queueFull', 'writeFailed'] as const) {
      expect(
        owed([sent('a', 2, STOPPED), sent('c', 9, rejected(kind))], {
          carried: { c: ['a'] }
        })
      ).toEqual(['a'])
    }
  })

  it('any carrier refused with proof it never reached the agent leaves what it carried owed', () => {
    // Pi's sign-in check runs before it records a prompt; ACP's lost child before it writes one.
    for (const kind of ['notSignedIn', 'providerExited', 'providerRejected'] as const) {
      expect(
        owed([sent('a', 2, STOPPED), sent('c', 9, rejected(kind, { neverReachedAgent: true }))], {
          carried: { c: ['a'] }
        })
      ).toEqual(['a'])
    }
  })

  it('a carrier a Stop withdrew unwritten flattens with what it carried, in send order', () => {
    expect(
      owed([sent('a', 2, STOPPED), sent('b', 3, STOPPED), sent('c', 9, STOPPED)], {
        carried: { c: ['a', 'b'] }
      })
    ).toEqual(['a', 'b', 'c'])
  })

  it('any covering carrier covers, though an earlier one was refused', () => {
    expect(
      owed(
        [
          sent('a', 2, STOPPED),
          sent('c1', 5, rejected('writeFailed')),
          sent('c2', 9, { dispatchState: 'accepted' })
        ],
        { carried: { c1: ['a'], c2: ['a'] } }
      )
    ).toEqual([])
  })

  it('a carrier no longer in the journal covers nothing', () => {
    expect(owed([sent('a', 2, STOPPED)], { carried: { gone: ['a'] } })).toEqual(['a'])
  })

  it('an injection record covers what it names, whatever came of the write', () => {
    // A proven refusal removes the record, so only a standing one is read.
    expect(
      owed([sent('a', 2, STOPPED), sent('b', 3, STOPPED), sent('c', 4, STOPPED)], {
        injected: { first: ['a'], second: ['c'] }
      })
    ).toEqual(['b'])
  })

  it('either kind of coverage covers, and a stopped message stays owed until one does', () => {
    expect(
      owed([sent('a', 2, STOPPED), sent('b', 3, STOPPED), sent('c', 9, rejected('writeFailed'))], {
        carried: { c: ['a', 'b'] },
        injected: { first: ['b'] }
      })
    ).toEqual(['a'])
  })
})

describe('which sends carry stopped history', () => {
  const user = { source: { kind: 'user' } }

  it("a person's ordinary send carries it, a queued card's hand-off too", () => {
    expect(agentSessionSendDeliversStoppedHistory(user, message('next'))).toBe(true)
    expect(
      agentSessionSendDeliversStoppedHistory({ queuedMessageId: 'card' }, message('card'))
    ).toBe(true)
  })

  it('a slash command, a command, mail or an orchestration preamble does not', () => {
    expect(agentSessionSendDeliversStoppedHistory(user, message('/review'))).toBe(false)
    expect(
      agentSessionSendDeliversStoppedHistory(
        user,
        message('/compact', { command: { name: 'compact' } })
      )
    ).toBe(false)
    expect(
      agentSessionSendDeliversStoppedHistory({ source: { kind: 'agent' } }, message('mail'))
    ).toBe(false)
    expect(agentSessionSendDeliversStoppedHistory({}, message('preamble'))).toBe(false)
    const mail = message('task', {
      from: { kind: 'agent', senders: [], orchestration: null }
    })
    expect(agentSessionSendDeliversStoppedHistory({ queuedMessageId: 'card' }, mail)).toBe(false)
  })
})

describe('what one delivery holds', () => {
  const stopped = (id: string, words: string) => ({
    clientMessageId: id,
    words
  })
  const SHORT = message('go ahead with that')
  // Quotes double in JSON: each big one is admissible alone (about 200 KiB of a send's 256 KiB).
  const big = '"'.repeat(100 * 1024)

  it('holds every owed message in the order sent while their words fit', () => {
    const owed = [stopped('a', 'one'), stopped('b', 'two')]
    expect(selectStoppedHistory(owed, SHORT)).toEqual({
      messages: owed,
      covers: ['a', 'b']
    })
    expect(selectStoppedHistory([], SHORT)).toBeNull()
  })

  it('keeps the newest, then older ones while the whole fits one send, and covers those left out', () => {
    const owed = [
      stopped('a', 'first'),
      stopped('b', big),
      stopped('c', 'third'),
      stopped('d', big)
    ]
    expect(selectStoppedHistory(owed, SHORT)).toEqual({
      messages: [owed[0], owed[2], owed[3]],
      covers: ['a', 'b', 'c', 'd']
    })
  })

  it('leaves them all owed when the newest does not fit beside the send', () => {
    // Each admissible alone; together they would be a send larger than the person could make.
    expect(
      selectStoppedHistory([stopped('a', 'first'), stopped('b', big)], message(big))
    ).toBeNull()
  })

  it('counts each message with the framing of either transport, and the send beside them', () => {
    // 3,000 one-letter messages: the framing, not the words, decides how many fit.
    const owed = Array.from({ length: 3_000 }, (_, index) => stopped(`m${index}`, 'x'))
    const delivery = selectStoppedHistory(owed, SHORT)!
    const fits = Math.floor(
      (MAX_PROMPT_BYTES - JSON.stringify('go ahead with that').length) /
        (JSON.stringify('x').length + STOPPED_MESSAGE_FRAMING_BYTES)
    )
    expect(delivery.messages).toHaveLength(fits)
    expect(delivery.messages.at(-1)).toBe(owed.at(-1))
    expect(delivery.covers).toHaveLength(3_000)
  })
})

describe('a carried send', () => {
  it('only a words-only send carries, as its words alone bound its size', () => {
    expect(agentSessionSendCarriesStoppedHistory(message('next'))).toBe(true)
    expect(
      agentSessionSendCarriesStoppedHistory(
        message('', {
          blocks: [
            { type: 'text', text: 'see' },
            { type: 'image-ref', path: '/x.png' }
          ]
        })
      )
    ).toBe(false)
    expect(agentSessionSendCarriesStoppedHistory(message(''))).toBe(false)
  })

  it("leads with each stopped message and Claude's interrupted record, then the person's words", () => {
    const body = message('', {
      blocks: [
        { type: 'text', text: 'go ahead' },
        { type: 'text', text: 'please' }
      ]
    })
    expect(
      withStoppedHistory(body, [
        { clientMessageId: 'a', words: 'say pinecone' },
        { clientMessageId: 'b', words: 'then stop' }
      ])
    ).toEqual(
      message(
        'say pinecone\n\n[Request interrupted by user]\n\nthen stop\n\n[Request interrupted by user]\n\ngo ahead\nplease'
      )
    )
  })
})
