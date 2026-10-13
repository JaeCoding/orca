const timestamp = '2026-10-12T12:00:00.000Z'

function turn(id: string, parentId: string | null, text = id, role = 'user') {
  return { type: 'message', id, parentId, timestamp, message: { role, content: text } }
}

function compact(id: string, parentId: string, firstKeptEntryId: string | null) {
  return {
    type: 'compaction',
    id,
    parentId,
    timestamp,
    firstKeptEntryId,
    summary: id,
    tokensBefore: 100
  }
}

const root = turn('root', null)
const kept = turn('kept', 'root')
const checkpoint = compact('summary', 'kept', 'kept')
const later = turn('later', 'summary', 'later', 'assistant')

// Verified against Pi 1.1.0 buildContextEntries + sessionEntryToContextMessages.
export const PI_CONTEXT_FIXTURES = [
  {
    name: 'kept range before latest compaction',
    entries: [root, kept, checkpoint, later],
    texts: ['summary', 'kept', 'later']
  },
  ...[null, 'missing', 'later'].map((firstKeptEntryId) => ({
    name: `no earlier kept range: ${firstKeptEntryId}`,
    entries: [root, kept, { ...checkpoint, firstKeptEntryId }, later],
    texts: ['summary', 'later']
  })),
  {
    name: 'latest of multiple compactions',
    entries: [
      root,
      kept,
      checkpoint,
      later,
      compact('latest', 'later', 'later'),
      turn('end', 'latest')
    ],
    texts: ['latest', 'later', 'end']
  },
  {
    name: 'older compaction inside kept range still renders',
    entries: [root, kept, checkpoint, later, compact('latest', 'later', 'kept')],
    texts: ['latest', 'kept', 'summary', 'later']
  },
  {
    name: 'branch summary with metadata leaf omits abandoned branch',
    entries: [
      root,
      turn('abandoned', 'root'),
      {
        type: 'branch_summary',
        id: 'branch',
        parentId: 'root',
        fromId: 'abandoned',
        summary: 'branch',
        timestamp
      },
      {
        type: 'label',
        id: 'label',
        parentId: 'branch',
        targetId: 'branch',
        label: 'saved',
        timestamp
      }
    ],
    texts: ['root', 'branch']
  },
  {
    name: 'compaction on abandoned sibling does not compact active ancestry',
    entries: [
      root,
      kept,
      checkpoint,
      turn('active', 'root'),
      { type: 'model_change', id: 'model', parentId: 'active', timestamp }
    ],
    texts: ['root', 'active']
  },
  {
    name: 'kept metadata and hidden system prompt preserve ancestry',
    entries: [
      root,
      { type: 'thinking_level_change', id: 'thinking', parentId: 'root', timestamp },
      turn('system', 'thinking', 'hidden', 'system'),
      turn('kept', 'system'),
      compact('summary', 'kept', 'thinking'),
      later
    ],
    texts: ['summary', 'kept', 'later']
  },
  {
    name: 'version 1 migration uses parsed file index including header',
    version: 1,
    entries: [
      { type: 'message', message: { role: 'user', content: 'root' }, timestamp },
      { type: 'model_change', provider: 'test', modelId: 'test', timestamp },
      { type: 'message', message: { role: 'user', content: 'kept' }, timestamp },
      {
        type: 'compaction',
        firstKeptEntryIndex: 3,
        summary: 'summary',
        tokensBefore: 100,
        timestamp
      },
      { type: 'message', message: { role: 'assistant', content: 'later' }, timestamp }
    ],
    texts: ['summary', 'kept', 'later']
  },
  {
    name: 'empty branch summary is hidden',
    entries: [
      root,
      {
        type: 'branch_summary',
        id: 'branch',
        parentId: 'root',
        fromId: 'root',
        summary: '',
        timestamp
      }
    ],
    texts: ['root']
  }
]
