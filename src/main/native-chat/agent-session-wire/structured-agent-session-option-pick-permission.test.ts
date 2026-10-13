// A model or effort pick on a running chat writes the provider's answer to the record. That answer
// names only the provider's own options, so the chat's saved permission mode must survive it: the
// next start reads a missing mode as Ask.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import { adapterFor, fakeCodex } from '../../codex/codex-structured-session-adapter-fixture'
import type { CodexStructuredSessionAdapter } from '../../codex/codex-structured-session-adapter'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { openTestAgentSessionRecordStore } from '../../runtime/agent-session-record-store-test-harness'
import { openTestJournalHostDatabase } from '../agent-session-journal/journal-host-database-test-support'
import { NO_STRUCTURED_AGENTS } from './structured-agent-session-adapter-router-test-support'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION,
  hostTestAttachParams,
  hostTestOperationId,
  resetHostTestOperationIds
} from './structured-agent-session-host-test-data'
import { createStructuredAgentSessionLogger } from './structured-agent-session-logger'

const CALLER = { callerKey: 'client-1' }

let root: string
let store: AgentSessionRecordStore
let codex: CodexStructuredSessionAdapter
let host: StructuredAgentSessionHost

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-option-pick-permission-'))
  resetHostTestOperationIds()
  store = await openTestAgentSessionRecordStore(root)
  codex = adapterFor(fakeCodex())
  host = new StructuredAgentSessionHost({
    agents: NO_STRUCTURED_AGENTS,
    logger: createStructuredAgentSessionLogger(),
    store,
    adapter: codex,
    journalDatabase: openTestJournalHostDatabase(root),
    claimKeyId: 'key-1',
    mintSpawnToken: () => 'spawn-a',
    now: () => NOW
  })
})

afterEach(async () => {
  await host.flushAllStreamedEvents()
  await codex.closeAll()
  await rm(root, { recursive: true, force: true })
})

/** A running Codex chat started from these saved options. */
async function runningChat(options: Record<string, string>): Promise<void> {
  expect(await host.attach(CALLER, hostTestAttachParams(null, { options }))).toMatchObject({
    ok: true
  })
  expect(host.hasSession(SESSION)).toBe(true)
}

function pick(key: string, value: string) {
  const fields = { key, value }
  return host.setOption(CALLER, {
    envelope: {
      sessionId: SESSION,
      clientOperationId: hostTestOperationId(),
      expectedRuntimeFence: store.getRecord(SESSION)!.lease.runtimeFence,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.setOption',
        sessionId: SESSION,
        fields
      })
    },
    ...fields
  })
}

describe('a Codex model or effort pick on a running chat', () => {
  // An unrecognised saved string is kept as saved: launch already reads it as Ask.
  it.each(['full-access', 'ask', 'not-a-mode'])(
    'keeps the saved %s permission mode',
    async (permissionMode) => {
      await runningChat({ permissionMode, model: 'gpt-old', effort: 'high' })

      expect(await pick('model', 'gpt-picked')).toMatchObject({ ok: true })
      expect(store.getRecord(SESSION)?.options).toEqual({
        model: 'gpt-picked',
        permissionMode
      })

      expect(await pick('effort', 'low')).toMatchObject({ ok: true })
      expect(store.getRecord(SESSION)?.options).toEqual({
        model: 'gpt-picked',
        effort: 'low',
        permissionMode
      })
    }
  )

  it('still drops what the provider reset, and answers with only its own options', async () => {
    // Codex drops an effort chosen under another model; it never held the legacy Fast key.
    await runningChat({
      permissionMode: 'full-access',
      model: 'gpt-old',
      effort: 'high',
      fastMode: 'true'
    })

    const picked = await pick('model', 'gpt-picked')
    expect(picked.ok && picked.value.options).toEqual({ model: 'gpt-picked' })
    expect(store.getRecord(SESSION)?.options).toEqual({
      model: 'gpt-picked',
      permissionMode: 'full-access'
    })
  })

  it('writes no permission mode for a chat that never saved one', async () => {
    await runningChat({ model: 'gpt-old' })

    expect(await pick('model', 'gpt-picked')).toMatchObject({ ok: true })
    expect(store.getRecord(SESSION)?.options).toEqual({ model: 'gpt-picked' })
  })
})
