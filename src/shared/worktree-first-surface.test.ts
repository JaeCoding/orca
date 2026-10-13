import { describe, expect, it } from 'vitest'
import { shouldSeedWorktreePrimaryTerminal } from './worktree-first-surface'

describe('a created workspace first surface', () => {
  it.each([
    ['blank', { callerProvidesSurface: false }, true],
    ['chat', { callerProvidesSurface: true }, false],
    [
      'chat with its own setup tab',
      { callerProvidesSurface: true, setupLaunchMode: 'new-tab' as const },
      false
    ],
    [
      'chat with horizontal setup',
      { callerProvidesSurface: true, setupLaunchMode: 'split-horizontal' as const },
      true
    ],
    [
      'chat with vertical setup',
      { callerProvidesSurface: true, setupLaunchMode: 'split-vertical' as const },
      true
    ],
    ['terminal startup', { callerProvidesSurface: true, startupNeedsTerminal: true }, true],
    ['issue command', { callerProvidesSurface: true, issueCommandNeedsTerminal: true }, true]
  ])('%s seeds a primary terminal only when needed', (_label, intent, expected) => {
    expect(shouldSeedWorktreePrimaryTerminal({ hasPrimarySurface: false, ...intent })).toBe(
      expected
    )
    expect(shouldSeedWorktreePrimaryTerminal({ hasPrimarySurface: true, ...intent })).toBe(false)
  })
})
