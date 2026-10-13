import { describe, expect, it } from 'vitest'
import {
  assertOpenCodeCopyUsesLocalStore,
  isOpenCode2LaunchCommand,
  selectOpenCodeHookAgent
} from './opencode-launch-command'

describe('isOpenCode2LaunchCommand', () => {
  it.each(['opencode2', '/usr/local/bin/opencode2', 'opencode2.exe', 'opencode2.cmd'])(
    'recognizes %s',
    (command) => {
      expect(isOpenCode2LaunchCommand(command)).toBe(true)
    }
  )

  it.each(['opencode', 'echo opencode2', 'opencode2-helper'])('rejects %s', (command) => {
    expect(isOpenCode2LaunchCommand(command)).toBe(false)
  })
})

describe('OpenCode hook selection', () => {
  it.each([
    'opencode --session fixture',
    '"C:\\tools\\opencode.exe" --session fixture',
    '/usr/local/bin/opencode'
  ])('preserves disabled v1 identity for %s', (command) => {
    expect(selectOpenCodeHookAgent(undefined, command, (agent) => agent === 'opencode2')).toBeNull()
  })
  it('trusts the supplied identity for wrapped or renamed commands', () => {
    expect(selectOpenCodeHookAgent('opencode', 'opencode2', () => true)).toBe('opencode')
    expect(
      selectOpenCodeHookAgent('opencode2', 'my-wrapper', (agent) => agent === 'opencode2')
    ).toBe('opencode2')
  })
})

describe('selectOpenCodeHookAgent after a sleep prefix', () => {
  it('selects OpenCode 2 hooks instead of the v1 fallback', () => {
    expect(selectOpenCodeHookAgent(undefined, 'sleep 30 && opencode2', () => true)).toBe(
      'opencode2'
    )
    expect(
      selectOpenCodeHookAgent(undefined, 'sleep 30 && opencode2', (agent) => agent === 'opencode')
    ).toBeNull()
  })
})

describe('OpenCode host-local copy launch', () => {
  it.each(
    [['--server', 'http://synthetic-server'], ['--server=http://synthetic-server']].map((args) => ({
      args
    }))
  )('refuses an explicit server route before a copy', ({ args }) => {
    expect(() => assertOpenCodeCopyUsesLocalStore(args)).toThrow('Remove --server')
  })
  it.each(
    [[], ['--standalone'], ['--', '--server'], ['--prompt=explain --server']].map((args) => ({
      args
    }))
  )('keeps ordinary local and positional argument meanings', ({ args }) => {
    expect(() => assertOpenCodeCopyUsesLocalStore(args)).not.toThrow()
  })
})
