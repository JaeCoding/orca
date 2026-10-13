/**
 * Agent browser input must reach its page without touching the user's keyboard focus (#20595).
 *
 * The user's stand-in is the focused terminal; the agent drives a background browser tab.
 * Chromium routes <webview> input by the window's focus, so the failure shows up as host
 * keydowns (agent keys landing in the terminal) or a host focus change.
 * See docs/reference/agent-browser-focus-isolation.md.
 */

import { createServer, type Server } from 'node:http'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, getActiveWorktreeId, waitForActiveWorktree } from './helpers/store'

const PAGE_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Focus isolation probe</title></head>
  <body>
    <form id="form"><input id="probe" /></form>
    <textarea id="notes"></textarea>
    <button id="target" style="position:absolute;left:40px;top:80px;width:200px;height:60px">target</button>
    <script>
      window.__keys = []
      window.__submits = 0
      window.__clicks = 0
      window.__blurs = 0
      document.getElementById('probe').addEventListener('blur', () => { window.__blurs += 1 })
      addEventListener('keydown', (event) => window.__keys.push(event.key), true)
      document.getElementById('form').addEventListener('submit', (event) => {
        event.preventDefault()
        window.__submits += 1
      })
      document.getElementById('target').addEventListener('click', () => { window.__clicks += 1 })
    </script>
  </body>
</html>`

async function startProbeServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(PAGE_HTML)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Probe server did not bind a TCP port')
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  }
}

function readProperty(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' && key in value
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined
}

async function rpc(page: Page, method: string, params: Record<string, unknown>): Promise<unknown> {
  const response: unknown = await page.evaluate(
    ({ targetMethod, targetParams }) =>
      window.api.runtime.call({ method: targetMethod, params: targetParams }),
    { targetMethod: method, targetParams: params }
  )
  expect(
    readProperty(response, 'ok'),
    `${method} failed: ${JSON.stringify(readProperty(response, 'error'))}`
  ).toBe(true)
  return readProperty(response, 'result')
}

async function evalInPage(page: Page, pageId: string, expression: string): Promise<unknown> {
  return readProperty(await rpc(page, 'browser.eval', { page: pageId, expression }), 'result')
}

/** Focuses the terminal and records every host keydown and focus move from here on. */
async function focusTerminalAndWatchHost(page: Page): Promise<void> {
  await page.evaluate(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
    if (!textarea) {
      throw new Error('No terminal input to focus')
    }
    textarea.focus()
    const log: string[] = []
    Object.assign(window, { __hostFocusLog: log })
    window.addEventListener('keydown', (event) => log.push(`key:${event.key}`), true)
    window.addEventListener('focusin', (event) => {
      const target = event.target
      log.push(`focus:${target instanceof Element ? target.tagName : 'window'}`)
    })
  })
}

async function readHost(page: Page): Promise<{ log: string[]; terminalFocused: boolean }> {
  return page.evaluate(() => ({
    log: Reflect.get(window, '__hostFocusLog') ?? [],
    terminalFocused: document.activeElement?.classList.contains('xterm-helper-textarea') === true
  }))
}

/** Opens the probe in a browser tab, then puts the terminal back in front of it. */
async function openBackgroundProbeTab(page: Page, url: string): Promise<string> {
  await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  const worktreeId = await getActiveWorktreeId(page)
  expect(worktreeId).toBeTruthy()
  // Why: shown once so the page gets a viewport; a tab never shown can stay 0x0, and clicks miss.
  const pageId = await page.evaluate(
    ({ targetWorktreeId, targetUrl }) =>
      window.__store?.getState().createBrowserTab(targetWorktreeId, targetUrl, {
        title: 'Focus isolation probe',
        activate: true
      })?.activePageId ?? null,
    { targetWorktreeId: worktreeId!, targetUrl: url }
  )
  if (!pageId) {
    throw new Error('Failed to create the probe browser page')
  }
  // Why: the title exists before the probe's script runs; input sent earlier goes unrecorded.
  const readiness = `document.readyState === 'complete' && innerWidth > 0 && 'clicks' + window.__clicks`
  await expect.poll(() => evalInPage(page, pageId, readiness), { timeout: 20_000 }).toBe('clicks0')
  await ensureTerminalVisible(page)
  await expect.poll(() => evalInPage(page, pageId, readiness)).toBe('clicks0')
  return pageId
}

test('agent keys and text reach the page without leaving the user’s terminal', async ({
  orcaPage
}) => {
  test.setTimeout(120_000)
  const server = await startProbeServer()
  try {
    const pageId = await openBackgroundProbeTab(orcaPage, server.url)

    await focusTerminalAndWatchHost(orcaPage)
    await evalInPage(orcaPage, pageId, `document.getElementById('probe').focus()`)

    const probeValue = (): Promise<unknown> =>
      evalInPage(orcaPage, pageId, `document.getElementById('probe').value`)
    await rpc(orcaPage, 'browser.keypress', { page: pageId, key: 'Z' })
    await rpc(orcaPage, 'browser.type', { page: pageId, input: 'qr' })
    await expect.poll(probeValue).toBe('Zqr')
    await rpc(orcaPage, 'browser.keypress', { page: pageId, key: 'Enter' })
    await rpc(orcaPage, 'browser.fill', { page: pageId, element: '#probe', value: 'filled' })
    await expect.poll(probeValue).toBe('filled')

    const host = await readHost(orcaPage)
    expect(host.log).toEqual([])
    expect(host.terminalFocused).toBe(true)
    await expect
      .poll(() =>
        evalInPage(
          orcaPage,
          pageId,
          `JSON.stringify({ submits: window.__submits, keys: window.__keys })`
        )
      )
      // Why: `type` inserts text without key events, so only the keypresses log keydowns.
      .toBe(JSON.stringify({ submits: 1, keys: ['Z', 'Enter'] }))
  } finally {
    await server.close()
  }
})

test('agent clicks and presses reach the page without leaving the user’s terminal', async ({
  orcaPage
}) => {
  test.setTimeout(120_000)
  const server = await startProbeServer()
  try {
    const pageId = await openBackgroundProbeTab(orcaPage, server.url)
    await focusTerminalAndWatchHost(orcaPage)
    const clicks = (): Promise<unknown> => evalInPage(orcaPage, pageId, 'window.__clicks')

    await rpc(orcaPage, 'browser.click', { page: pageId, element: '#target' })
    await expect.poll(clicks).toBe('1')
    expect((await readHost(orcaPage)).terminalFocused).toBe(true)

    await rpc(orcaPage, 'browser.mouseMove', { page: pageId, x: 100, y: 100 })
    await rpc(orcaPage, 'browser.mouseDown', { page: pageId, button: 'left' })
    await rpc(orcaPage, 'browser.mouseUp', { page: pageId, button: 'left' })
    await expect.poll(clicks).toBe('2')
    expect((await readHost(orcaPage)).terminalFocused).toBe(true)

    // Why: the page must still see the field the agent clicked as focused, or menus close on blur.
    await rpc(orcaPage, 'browser.click', { page: pageId, element: '#probe' })
    await expect
      .poll(() =>
        evalInPage(
          orcaPage,
          pageId,
          `JSON.stringify({ active: document.activeElement.id, focused: document.hasFocus(), blurs: window.__blurs })`
        )
      )
      .toBe(JSON.stringify({ active: 'probe', focused: true, blurs: 0 }))
    expect((await readHost(orcaPage)).terminalFocused).toBe(true)

    // Why: text with a newline cannot be typed as key events; CDP delivers it with focus borrowed.
    await rpc(orcaPage, 'browser.fill', { page: pageId, element: '#notes', value: 'a\nb' })
    await expect
      .poll(() => evalInPage(orcaPage, pageId, `document.getElementById('notes').value`))
      .toBe('a\nb')
    expect((await readHost(orcaPage)).terminalFocused).toBe(true)

    // Why: the user's next keystroke is what the bug stole; it must reach the terminal, not the page.
    await orcaPage.keyboard.press('x')
    const host = await readHost(orcaPage)
    expect(host.log.filter((entry) => entry.startsWith('key:'))).toEqual(['key:x'])
    expect(host.terminalFocused).toBe(true)
    await expect
      .poll(() => evalInPage(orcaPage, pageId, 'JSON.stringify(window.__keys)'))
      .toBe('[]')
  } finally {
    await server.close()
  }
})
