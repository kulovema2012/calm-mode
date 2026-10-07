import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fallbackPoints, fitRecap, parsePoints, recapLines, stepAwayMinutes, toggleLabel, wrapText } from './calm-recap'

const BAND = {
  plugin: 'calm-recap',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const ANSWER = 'Made the pricing cards blue. The footer still needs your logo.'

/** The world beneath the plugin, and one finished turn: "make the pricing cards blue". */
async function start($: Engine, on: On, conversation: Array<{ role: string; text: string }> = []) {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '- Made the cards blue\n- Needs you: send the logo', usage: {} } }) as never)
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__calm-recap__${e.name}` } }) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }) as never)
  on('command.run', () => ({ text: '' }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('classic.SessionStart', () => ({}) as never)
  on('session.messages', () => ({ value: conversation.map(m => ({ ...m, toolUses: [] })) }) as never)
  await $.session.start({ cwd: '', surface: 'terminal', isInteractive: true })
  return clock
}

async function finishTurn($: Engine, reason: 'answer' | 'aborted' = 'answer') {
  await $.turn.start({ text: 'make the pricing cards blue', turnId: 't1' })
  await $.turn.complete({ answer: ANSWER, durationMs: 90_000, isAborted: reason === 'aborted', turnId: 't1', reason } as never)
}

test('helpers: points, wrapping, away steps and the leaf label', () => {
  expect(fallbackPoints(ANSWER)).toEqual(['Made the pricing cards blue.', 'The footer still needs your logo.'])
  expect(parsePoints('- One\n- Two\n- Three\n- Four')).toEqual(['One', 'Two', 'Three'])
  expect(wrapText('one two three four five', 9)).toEqual(['one two', 'three', 'four five'])
  expect(stepAwayMinutes(5, 1)).toBe(10)
  expect(stepAwayMinutes(1, -1)).toBe(1)
  const settings = { buttonLabel: 'Calm Recap', cyberpunk: false, awayMinutes: 5, recapStyle: 'band', cacheMeter: false } as const
  expect(toggleLabel(settings, true)).toBe('● Calm Recap: ON')
  expect(toggleLabel({ ...settings, cyberpunk: true }, false)).toBe('🍃 CALM RECAP//OFF')
})

test('the band holds only its buttons until there is something to recap', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'recap-toggle' }))?.props.label).toBe('● Calm Recap: ON')
  expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeUndefined()
  await ui.unmount()
})

test('after 5 quiet minutes the Welcome back card shows; Got it clears it', async ($, on) => {
  const clock = await start($, on)
  await finishTurn($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(4 * 60_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeUndefined()
  await clock.advance(60_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Welcome back · away 5m/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Answered · took 1m 30s/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /make the pricing cards blue/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /➜ Needs you: send the logo/ })).toBeDefined()
  await ui.press({ key: 'recap-ok' })
  expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeUndefined()
  await ui.unmount()
})

test('a stopped answer says so', async ($, on) => {
  const clock = await start($, on)
  await finishTurn($, 'aborted')
  await clock.advance(5 * 60_000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Stopped · you pressed Esc/ })).toBeDefined()
  await ui.unmount()
})

test('typing again before the time is up means no card', async ($, on) => {
  const clock = await start($, on)
  await finishTurn($)
  await clock.advance(60_000)
  await $.turn.start({ text: 'and the header too', turnId: 't2' })
  await clock.advance(10 * 60_000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeUndefined()
  await ui.unmount()
})

test('claude --resume shows the card from the saved conversation', async ($, on) => {
  const clock = await start($, on, [
    { role: 'user', text: 'make the pricing cards blue' },
    { role: 'assistant', text: ANSWER },
    { role: 'user', text: '<system-reminder>ignore me</system-reminder>' },
  ])
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 7200, prompt_cache_likely_expired: true } as never)
  await clock.advance(600)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Welcome back · away 2h/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Resumed session · cache expired/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /make the pricing cards blue/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ignore me/ })).toBeUndefined()
  await ui.unmount()
})

test('/recap shows the card now; /recap off turns it all off', async ($, on) => {
  await start($, on, [
    { role: 'user', text: 'make the pricing cards blue' },
    { role: 'assistant', text: ANSWER },
  ])
  const shown = await $.command.run({ command: 'recap', args: '' } as never)
  expect(shown.text).toBe('Showing the Welcome back card above the prompt.')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeDefined()
  await $.command.run({ command: 'recap', args: 'off' } as never)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeUndefined()
  expect((await ui.find({ key: 'recap-toggle' }))?.props.label).toBe('○ Calm Recap: OFF')
  const refused = await $.command.run({ command: 'recap', args: '' } as never)
  expect(refused.text).toBe('Calm Recap is off. Type /recap on first.')
  await ui.unmount()
})

test('pane style keeps one line with Open recap; the pane holds the card', { options: { recapStyle: 'pane' } }, async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  await start($, on, [
    { role: 'user', text: 'make the pricing cards blue' },
    { role: 'assistant', text: ANSWER },
  ])
  await $.command.run({ command: 'recap', args: '' } as never)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ key: 'recap-open' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /What Claude did/ })).toBeUndefined()
  await band.unmount()
  const pane = await $.ui.mount({
    plugin: 'calm-recap',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'calm-recap',
    props: { title: 'Welcome back', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } },
  } as never)
  expect(await pane.find({ type: 'Text', text: /What Claude did/ })).toBeDefined()
  expect(await pane.find({ key: 'recap-pane-ok' })).toBeDefined()
  await pane.unmount()
})

test('the card fits a short band: rules, then the question, then extra points go', () => {
  const recap = {
    turnId: 't', phase: 'done', tookMs: 60_000, points: ['One', 'Two', 'Three'], lastAsked: 'make it blue',
    awaySince: 0, isShowing: true, isResumed: false, isCacheCold: false,
  } as const
  const theme = { done: '✓ ', stopped: '■ ', sep: ' · ', rule: '─', shout: (t: string) => t, duration: () => '1m 0s', accent: 'claude', warn: 'warning', title: undefined } as never
  const all = recapLines({ ...recap, points: [...recap.points] }, theme, false, 60)
  expect(all.map(l => l.kind)).toEqual(['divider', 'status', 'divider', 'heading', 'point', 'point', 'point', 'divider', 'askedHeading', 'asked'])
  expect(fitRecap(all, 5).map(l => l.kind)).toEqual(['status', 'heading', 'point', 'point', 'point'])
  expect(fitRecap(all, 3).map(l => l.kind)).toEqual(['status', 'heading', 'point'])
})

test('settings: the same tabbed panel, three tabs', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'recap-settings' })
  expect((await ui.find({ key: 'tab-display' }))?.props.hotkey).toBe('1')
  expect((await ui.find({ key: 'set-cyber' }))?.props.label).toBe('○ Off')
  expect(await ui.find({ key: 'set-label' })).toBeDefined()
  await ui.press({ key: 'tab-recap' })
  expect(await ui.find({ type: 'Text', text: ' 5m ' })).toBeDefined()
  await ui.press({ key: 'away-up' })
  expect(await ui.find({ type: 'Text', text: ' 10m ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Away after: 10 minutes/ })).toBeDefined()
  expect((await ui.find({ key: 'set-recap-style' }))?.props.label).toBe('Band')
  await ui.press({ key: 'tab-status' })
  expect((await ui.find({ key: 'set-cache' }))?.props.label).toBe('○ Off')
  await ui.unmount()
})

test('the status-line switch runs the installer', async ($, on) => {
  const runs: string[][] = []
  on('process.run', (_$, e) => {
    runs.push([...(e as unknown as { argv: string[] }).argv])
    return { value: { exitCode: 0, stdout: 'Added the cache meter to the right end of your status line.\n', stderr: '' } } as never
  })
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'recap-settings' })
  await ui.press({ key: 'tab-status' })
  await ui.press({ key: 'set-cache' })
  const changes = runs.filter(argv => argv[2] !== 'status')
  expect(changes.length).toBe(1)
  expect(changes[0]?.[2]).toBe('install')
  expect((await ui.find({ key: 'set-cache' }))?.props.label).toBe('◉ On')
  await ui.unmount()
})

test('cyberpunk: leaf button, neon dashed rules', { options: { cyberpunk: true } }, async ($, on) => {
  await start($, on, [
    { role: 'user', text: 'make the pricing cards blue' },
    { role: 'assistant', text: ANSWER },
  ])
  await $.command.run({ command: 'recap', args: '' } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'recap-toggle' }))?.props.label).toBe('🍃 CALM RECAP//ON')
  const rules = await ui.findAll({ type: 'Text', text: /^┄{20,}$/ })
  expect(rules.length).toBe(3)
  expect(rules[0]?.props.color).toBe('#ff2bd6')
  await ui.unmount()
})
