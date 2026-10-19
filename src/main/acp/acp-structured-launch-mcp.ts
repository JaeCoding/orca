// The MCP servers an ACP launch passes to its agent. ACP agents own no MCP config of their own:
// the client supplies the servers each session starts with (`session/new.mcpServers`), so Orca
// reads the workspace's `.mcp.json` at every launch and maps the enabled servers into the request.
// Best effort: an unreadable or invalid config starts the session with no servers. The values here
// reach the agent, so they are read raw — the shared MCP inspection masks env values for display.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MCP_CONFIG_INSPECTION_MAX_SERVERS } from '../../shared/mcp-config-inspection-limits'
import type { EnvVariable, HttpHeader, McpServer } from './generated/acp-protocol.generated'
import type { StructuredAgentSessionLogger } from '../native-chat/agent-session-wire/structured-agent-session-logger'

const WORKSPACE_MCP_CONFIG = '.mcp.json'

function nameValuePairs(
  raw: unknown,
  server: string,
  field: string,
  logger: StructuredAgentSessionLogger | undefined
): { name: string; value: string }[] {
  if (raw === undefined || raw === null) {
    return []
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    logger?.warn('Workspace MCP server field is not an object; dropping it', {
      scope: 'acp-launch-mcp',
      server,
      field
    })
    return []
  }
  const pairs: { name: string; value: string }[] = []
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      logger?.warn('Workspace MCP server field value is not a string; dropping the entry', {
        scope: 'acp-launch-mcp',
        server,
        field,
        entry: name
      })
      continue
    }
    pairs.push({ name, value })
  }
  return pairs
}

/** One config entry as the session start names it; null skips an entry Orca cannot map. */
function toAcpMcpServer(
  name: string,
  raw: unknown,
  logger: StructuredAgentSessionLogger | undefined
): McpServer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    logger?.warn('Workspace MCP server entry is not an object; skipping it', {
      scope: 'acp-launch-mcp',
      server: name
    })
    return null
  }
  const entry = raw as Record<string, unknown>
  if (entry.enabled === false || entry.disabled === true) {
    return null
  }
  if (typeof entry.command === 'string' && entry.command.length > 0) {
    const args = Array.isArray(entry.args)
      ? entry.args.filter((arg): arg is string => typeof arg === 'string')
      : []
    return {
      name,
      command: entry.command,
      args,
      env: nameValuePairs(entry.env, name, 'env', logger) as EnvVariable[]
    }
  }
  if (typeof entry.url === 'string' && entry.url.length > 0) {
    if (entry.type === 'sse') {
      return {
        type: 'sse',
        name,
        url: entry.url,
        headers: nameValuePairs(entry.headers, name, 'headers', logger) as HttpHeader[]
      }
    }
    return {
      type: 'http',
      name,
      url: entry.url,
      headers: nameValuePairs(entry.headers, name, 'headers', logger) as HttpHeader[]
    }
  }
  logger?.warn('Workspace MCP server entry names no command or URL; skipping it', {
    scope: 'acp-launch-mcp',
    server: name
  })
  return null
}

/** The workspace `.mcp.json`'s enabled servers as the session start names them; never throws. */
export async function resolveAcpLaunchMcpServers(
  cwd: string,
  logger?: StructuredAgentSessionLogger
): Promise<McpServer[]> {
  let content: string
  try {
    content = await readFile(join(cwd, WORKSPACE_MCP_CONFIG), 'utf8')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    logger?.warn('Workspace MCP config is not valid JSON; continuing without it', {
      scope: 'acp-launch-mcp',
      path: WORKSPACE_MCP_CONFIG,
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
  const rawServers =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)['mcpServers']
      : null
  if (!rawServers || typeof rawServers !== 'object' || Array.isArray(rawServers)) {
    return []
  }
  const servers: McpServer[] = []
  for (const [name, raw] of Object.entries(rawServers as Record<string, unknown>)) {
    if (servers.length >= MCP_CONFIG_INSPECTION_MAX_SERVERS) {
      logger?.warn('Workspace MCP config exceeds the server limit; the rest are skipped', {
        scope: 'acp-launch-mcp',
        limit: MCP_CONFIG_INSPECTION_MAX_SERVERS
      })
      break
    }
    const server = toAcpMcpServer(name, raw, logger)
    if (server) {
      servers.push(server)
    }
  }
  return servers
}
