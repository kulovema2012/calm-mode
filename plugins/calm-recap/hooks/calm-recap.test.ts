import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cleanTitle, fallbackPoints, fitRecap, keepWarmDecision, keepWarmUntil, parsePoints, parseCitedPoints, findRow, resumeFromCacheState, parseWindowsLocation, isLocationFresh, parseMacLocation, recapLines, stepAwayMinutes, toggleLabel, weatherSymbol, weatherText, wrapText } from './calm-recap'

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

/** What the plugin toasted in the current test. */
let toasts: string[] = []

const ANSWER = 'Made the pricing cards blue. The footer still needs your logo.'

/** The world beneath the plugin, and one finished turn: "make the pricing cards blue". */
async function start($: Engine, on: On, conversation: Array<{ role: string; text: string }> = []) {
  toasts = []
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '- Made the cards blue\n- Needs you: send the logo', usage: {} } }) as never)
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__calm-recap__${e.name}` } }) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }) as never)
  on('command.run', () => ({ text: '' }))
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined } as never
  })
  on('classic.SessionStart', () => ({}) as never)
  on('session.messages', () => ({ value: conversation.map(m => ({ ...m, toolUses: [] })) }) as never)
  await $.session.start({ cwd: '', surface: 'terminal', isInteractive: true })
  return clock
}

async function finishTurn($: Engine, reason: 'answer' | 'aborted' = 'answer') {
  await $.turn.start({ text: 'make the pricing cards blue', turnId: 't1' })
  await $.turn.complete({ answer: ANSWER, durationMs: 90_000, isAborted: reason === 'aborted', turnId: 't1', reason } as never)
}

test('helpers: points, wrapping, away steps and the theme icons', () => {
  expect(fallbackPoints(ANSWER)).toEqual(['Made the pricing cards blue.', 'The footer still needs your logo.'])
  expect(parsePoints('- One\n- Two\n- Three\n- Four')).toEqual(['One', 'Two', 'Three'])
  expect(wrapText('one two three four five', 9)).toEqual(['one two', 'three', 'four five'])
  expect(stepAwayMinutes(5, 1)).toBe(10)
  expect(stepAwayMinutes(1, -1)).toBe(1)
  const settings = { buttonLabel: 'Calm Recap', cyberpunk: false, awayMinutes: 5, recapStyle: 'band', cacheMeter: false, weather: true, weatherCity: '', jobNaming: true } as const
  expect(toggleLabel(settings, true)).toBe('🍃 Calm Recap ●')
  expect(toggleLabel({ ...settings, cyberpunk: true }, false)).toBe('🌃 CALM RECAP ⭘')
})

test('the band holds only its buttons until there is something to recap', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'recap-toggle' }))?.props.label).toBe('🍃 Calm Recap ●')
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
  expect((await ui.find({ key: 'recap-toggle' }))?.props.label).toBe('🍃 Calm Recap ○')
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
  expect((await ui.find({ key: 'set-cyber' }))?.props.label).toBe('○')
  expect(await ui.find({ key: 'set-label' })).toBeDefined()
  await ui.press({ key: 'tab-recap' })
  expect(await ui.find({ type: 'Text', text: ' 5m ' })).toBeDefined()
  await ui.press({ key: 'away-up' })
  expect(await ui.find({ type: 'Text', text: ' 10m ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Away after: 10 minutes/ })).toBeDefined()
  expect((await ui.find({ key: 'set-recap-style' }))?.props.label).toBe('Band')
  await ui.press({ key: 'tab-status' })
  expect((await ui.find({ key: 'set-cache' }))?.props.label).toBe('○')
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
  expect((await ui.find({ key: 'set-cache' }))?.props.label).toBe('◉')
  await ui.unmount()
})

test('cyberpunk: night-city button, neon dashed rules', { options: { cyberpunk: true } }, async ($, on) => {
  await start($, on, [
    { role: 'user', text: 'make the pricing cards blue' },
    { role: 'assistant', text: ANSWER },
  ])
  await $.command.run({ command: 'recap', args: '' } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'recap-toggle' }))?.props.label).toBe('🌃 CALM RECAP ⏻')
  const rules = await ui.findAll({ type: 'Text', text: /^┄{20,}$/ })
  expect(rules.length).toBe(3)
  expect(rules[0]?.props.color).toBe('#ff2bd6')
  await ui.unmount()
})

test('weather codes become symbols', () => {
  expect(weatherSymbol(0, true)).toBe('☀')
  expect(weatherSymbol(0, false)).toBe('☾')
  expect(weatherSymbol(2, true)).toBe('⛅')
  expect(weatherSymbol(63, true)).toBe('🌧')
  expect(weatherText({ symbol: '⛅', tempC: 30.6 })).toBe('⛅ 31°C')
  expect(weatherText({ symbol: '☀', tempC: 29, city: 'Bangkok' })).toBe('📍 Bangkok ☀ 29°C')
  expect(weatherText({ symbol: '☀', tempC: 29, city: 'Llanfairpwllgwyngyll' })).toBe('📍 Llanfairpwllgwyng… ☀ 29°C')
})

/** ipwho.is and Open-Meteo, answered from memory; counts the requests. */
function fakeWeather(on: On, calls: string[]) {
  on('http.fetch', (_$, e) => {
    const url = String((e as unknown as { url: string }).url)
    calls.push(url)
    const text = url.includes('ipwho.is')
      ? JSON.stringify({ success: true, latitude: 13.75, longitude: 100.5, city: 'Bangkok' })
      : url.includes('bigdatacloud')
        ? JSON.stringify({ city: 'Si Racha', locality: 'Si Racha', principalSubdivision: 'Chon Buri' })
      : url.includes('geocoding-api')
        ? JSON.stringify(url.includes('Nowhereville') ? {} : { results: [{ name: 'Khon Kaen', latitude: 16.44, longitude: 102.83 }] })
        : JSON.stringify({ current: { temperature_2m: 30.6, weather_code: 2, is_day: 1 } })
    return { value: { status: 200, ok: true, headers: {}, text } } as never
  })
}

test('by default the weather shows beside the gear and refreshes every 15 minutes', async ($, on) => {
  const calls: string[] = []
  fakeWeather(on, calls)
  const clock = await start($, on)
  await clock.advance(10)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '📍 Bangkok? ⛅ 31°C  ' })).toBeDefined()
  await clock.advance(15 * 60_000)
  expect(calls.filter(url => url.includes('ipwho.is')).length).toBe(1)
  expect(calls.filter(url => url.includes('open-meteo')).length).toBe(2)
  await ui.unmount()
})

test('turned off, the weather makes no requests and shows nothing', { options: { weather: false } }, async ($, on) => {
  const calls: string[] = []
  fakeWeather(on, calls)
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /°C/ })).toBeUndefined()
  expect(calls).toEqual([])
  await ui.press({ key: 'recap-settings' })
  expect((await ui.find({ key: 'set-weather' }))?.props.label).toBe('○')
  await ui.unmount()
})

// ── Keep warm ───────────────────────────────────────────────────────────────

const FORKED = { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 0 } } }

/** An in-memory ~/.claude/calm-cache-state, keyed by file name (the engine normalizes the paths it hands hooks). */
function fakeStateDir(on: On, files: Map<string, string>, sessionId: string) {
  const name = (e: unknown) => String((e as { path: string }).path).split(/[\\/]/).pop() ?? ''
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('session.id', () => ({ value: sessionId }) as never)
  on('fs.exists', (_$, e) => ({ value: files.has(name(e)) }) as never)
  on('fs.read', (_$, e) => ({ value: files.get(name(e)) ?? '' }) as never)
  on('fs.write', (_$, e) => {
    files.set(name(e), (e as unknown as { text: string }).text)
    return { value: undefined } as never
  })
}

test('keep-warm decisions and durations', () => {
  const now = 1_000_000
  const at = (minutes: number) => (now + minutes * 60_000) / 1000
  expect(keepWarmDecision(null, 0, now)).toBe('no-meter')
  expect(keepWarmDecision({ ttl: '5m', expiresAt: at(3), warm: true }, 0, now)).toBe('short-cache')
  expect(keepWarmDecision({ ttl: '1h', expiresAt: at(4), warm: true }, 0, now)).toBe('ping')
  expect(keepWarmDecision({ ttl: '1h', expiresAt: at(-1), warm: false }, 0, now)).toBe('cold')
  expect(keepWarmUntil('2h', now)).toBe(now + 2 * 3_600_000)
  expect(keepWarmUntil('later', now)).toBeUndefined()
})

test('/recap keepwarm pings 5 minutes before the cache expires', async ($, on) => {
  const files = new Map<string, string>([['s1.json', JSON.stringify({ ttl: '1h', expiresAt: (1_000_000 + 10 * 60_000) / 1000, warm: true })]])
  fakeStateDir(on, files, 's1')
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return FORKED as never
  })
  const clock = await start($, on)
  const said = await $.command.run({ command: 'recap', args: 'keepwarm on' } as never)
  expect(said.text).toBe('Keep warm is on (stops after 20 pings in a row).')
  await clock.advance(4 * 60_000)
  expect(forks).toBe(0)
  await clock.advance(2 * 60_000)
  expect(forks).toBe(1)
  expect(JSON.parse(files.get('s1.keepwarm.json') ?? '{}').isOn).toBe(true)
  const off = await $.command.run({ command: 'recap', args: 'keepwarm off' } as never)
  expect(off.text).toBe('Keep warm is off.')
  expect(JSON.parse(files.get('s1.keepwarm.json') ?? '{}').isOn).toBe(false)
})

test('the Status line tab has a Keep warm switch', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'recap-settings' })
  await ui.press({ key: 'tab-status' })
  expect((await ui.find({ key: 'set-keepwarm' }))?.props.label).toBe('○')
  await ui.unmount()
})

// ── Done line ───────────────────────────────────────────────────────────────

test('job titles are plain words', () => {
  expect(cleanTitle('fix the menu in `src/nav.tsx` please')).toBe('Fix the menu in please')
  expect(cleanTitle('')).toBe('Your request')
  expect(cleanTitle('a'.repeat(30) + ' ' + 'b'.repeat(30)).length <= 50).toBe(true)
})

test('after an answer the band says All done, with the job name and how long it took', async ($, on) => {
  const clock = await start($, on)
  await finishTurn($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '✓ All done · Make the pricing cards blue · took 1m 30s' })).toBeDefined()
  // Haiku's name replaces the stand-in when it arrives
  await clock.advance(10)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /✓ All done · Made the cards blue · took 1m 30s/ })).toBeDefined()
  await ui.unmount()
})

test('cyberpunk done line: ALL DONE // NAME // took 01:30', { options: { cyberpunk: true, jobNaming: false } }, async ($, on) => {
  await start($, on)
  await finishTurn($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '◆ ALL DONE // MAKE THE PRICING CARDS BLUE // took 01:30' })).toBeDefined()
  await ui.unmount()
})

test('a stopped job says so; a new message clears the line while Claude works', async ($, on) => {
  await start($, on)
  await finishTurn($, 'aborted')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /■ Stopped · Make the pricing cards blue · you pressed Esc/ })).toBeDefined()
  await $.turn.start({ text: 'try again', turnId: 't2' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Stopped|All done/ })).toBeUndefined()
  await ui.unmount()
})

test('the Job naming switch lives in the Display tab', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'recap-settings' })
  expect((await ui.find({ key: 'set-naming' }))?.props.label).toBe('◉')
  await ui.unmount()
})

// ── Resume without its SessionStart event (v0.6.1) ─────────────────────────

const SAVED = [
  { role: 'user', text: 'make the pricing cards blue' },
  { role: 'assistant', text: ANSWER },
]

test('away time and a cold cache are read from the status line record', () => {
  const now = 10_000_000
  expect(resumeFromCacheState(null, now)).toEqual({ secondsAway: undefined, isCacheCold: false })
  expect(resumeFromCacheState({ ttl: '1h', expiresAt: (now - 3_600_000) / 1000, warm: false }, now)).toEqual({
    secondsAway: 7200,
    isCacheCold: true,
  })
  expect(resumeFromCacheState({ ttl: '1h', expiresAt: (now + 50 * 60_000) / 1000, warm: true }, now)).toEqual({
    secondsAway: 600,
    isCacheCold: false,
  })
})

test('a resumed conversation shows Welcome back even when its SessionStart event came too early', async ($, on) => {
  const files = new Map<string, string>()
  files.set('s1.json', JSON.stringify({ ttl: '1h', expiresAt: (1_000_000 - 3_600_000) / 1000, warm: false }))
  fakeStateDir(on, files, 's1')
  const clock = await start($, on, SAVED)
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Welcome back · away 2h/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cache expired/ })).toBeDefined()
  await ui.unmount()
})

test('without a cache record the resumed card leaves out the away time', async ($, on) => {
  fakeStateDir(on, new Map(), 's1')
  const clock = await start($, on, SAVED)
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /away/ })).toBeUndefined()
  await ui.unmount()
})

test('a new conversation shows no resume card', async ($, on) => {
  fakeStateDir(on, new Map(), 's1')
  const clock = await start($, on)
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeUndefined()
  await ui.unmount()
})

test('typing right after resuming skips the resume card', async ($, on) => {
  fakeStateDir(on, new Map(), 's1')
  const clock = await start($, on, SAVED)
  await $.turn.start({ text: 'next thing', turnId: 't2' })
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeUndefined()
  await ui.unmount()
})

test('the event and the fallback show one card, with the away time from the event', async ($, on) => {
  fakeStateDir(on, new Map(), 's1')
  const clock = await start($, on, SAVED)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 1800 } as never)
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Text', text: /Welcome back · away 30m/ })).length).toBe(1)
  await ui.unmount()
})

// ── Weather city ────────────────────────────────────────────────────────────

test('a typed Weather city is used instead of the internet address', { options: { weatherCity: 'Khon Kaen' } }, async ($, on) => {
  const calls: string[] = []
  fakeWeather(on, calls)
  const clock = await start($, on)
  await clock.advance(10)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /📍 Khon Kaen ⛅ 31°C/ })).toBeDefined()
  expect(calls.filter(url => url.includes('ipwho.is')).length).toBe(0)
  // Found once, then kept: the next reading does not search again.
  await clock.advance(15 * 60_000)
  expect(calls.filter(url => url.includes('geocoding-api')).length).toBe(1)
  await ui.unmount()
})

test('/recap weather city sets the city and shows it right away', async ($, on) => {
  const calls: string[] = []
  fakeWeather(on, calls)
  const clock = await start($, on)
  await clock.advance(10)
  const reply = await $.command.run({ command: 'recap', args: 'weather city Khon Kaen' } as never)
  expect(JSON.stringify(reply)).toContain('Khon Kaen')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /📍 Khon Kaen/ })).toBeDefined()
  await ui.unmount()
})

test('a city that cannot be found shows no weather', { options: { weatherCity: 'Nowhereville' } }, async ($, on) => {
  const calls: string[] = []
  fakeWeather(on, calls)
  const clock = await start($, on)
  await clock.advance(10)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /°C/ })).toBeUndefined()
  expect(calls.filter(url => url.includes('ipwho.is')).length).toBe(0)
  await ui.unmount()
})

// ── macOS location ──────────────────────────────────────────────────────────

test('the macOS helper line becomes a place', () => {
  expect(parseMacLocation('16.44671|102.833|Khon Kaen|(null)|Khon Kaen\n')).toEqual({ latitude: 16.44671, longitude: 102.833, city: 'Khon Kaen' })
  expect(parseMacLocation('13.75|100.5|(null)||Bangkok')).toEqual({ latitude: 13.75, longitude: 100.5, city: 'Bangkok' })
  expect(parseMacLocation('kCLErrorDomain error 1')).toBeUndefined()
  expect(parseMacLocation('')).toBeUndefined()
})

/** A Mac: HOME under /Users, and CoreLocationCLI answering (or missing) for every path tried. */
function fakeMac(on: On, runs: string[][], stdout: string | null | 'refused') {
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/Users/me' : undefined }) as never)
  on('process.run', (_$, e) => {
    const argv = [...(e as unknown as { argv: string[] }).argv]
    runs.push(argv)
    if (!String(argv[0]).includes('CoreLocationCLI')) return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
    return (stdout === null
      ? { value: { exitCode: 127, stdout: '', stderr: 'not found' } }
      : stdout === 'refused'
        ? { value: { exitCode: 1, stdout: '', stderr: 'location access denied' } }
        : { value: { exitCode: 0, stdout, stderr: '' } }) as never
  })
}

test('on a Mac with the location helper, the weather uses the real position', async ($, on) => {
  const calls: string[] = []
  const runs: string[][] = []
  fakeWeather(on, calls)
  fakeMac(on, runs, '16.44671|102.833|Khon Kaen|(null)|Khon Kaen\n')
  const clock = await start($, on)
  await clock.advance(10)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /📍 Khon Kaen ⛅ 31°C/ })).toBeDefined()
  expect(calls.filter(url => url.includes('ipwho.is')).length).toBe(0)
  expect(runs.some(argv => argv[0] === 'CoreLocationCLI')).toBe(true)
  await ui.unmount()
})

test('on a Mac without the helper, the internet address is used as before', async ($, on) => {
  const calls: string[] = []
  const runs: string[][] = []
  fakeWeather(on, calls)
  fakeMac(on, runs, null)
  const clock = await start($, on)
  await clock.advance(10)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /📍 Bangkok\? / })).toBeDefined()
  expect(runs.filter(argv => String(argv[0]).includes('CoreLocationCLI')).length).toBe(3)
  await ui.unmount()
})

test('a typed city wins over the macOS helper', { options: { weatherCity: 'Khon Kaen' } }, async ($, on) => {
  const calls: string[] = []
  const runs: string[][] = []
  fakeWeather(on, calls)
  fakeMac(on, runs, '13.75|100.5|Bangkok||Bangkok')
  const clock = await start($, on)
  await clock.advance(10)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /📍 Khon Kaen/ })).toBeDefined()
  expect(runs.some(argv => String(argv[0]).includes('CoreLocationCLI'))).toBe(false)
  await ui.unmount()
})

// ── Where the city came from ────────────────────────────────────────────────

test('a guessed city is marked with "?", a typed or Mac one is not', () => {
  expect(weatherText({ symbol: '☀', tempC: 29, city: 'Bangkok', source: 'ip' })).toBe('📍 Bangkok? ☀ 29°C')
  expect(weatherText({ symbol: '☀', tempC: 29, city: 'Buri Ram', source: 'mac' })).toBe('📍 Buri Ram ☀ 29°C')
  expect(weatherText({ symbol: '☀', tempC: 29, city: 'Khon Kaen', source: 'typed' })).toBe('📍 Khon Kaen ☀ 29°C')
})

test('the Mac position shows without "?"', async ($, on) => {
  const calls: string[] = []
  const runs: string[][] = []
  fakeWeather(on, calls)
  fakeMac(on, runs, '15.29|103.29|Satuek District||Buri Ram')
  const clock = await start($, on)
  await clock.advance(10)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /📍 Satuek District ⛅/ })).toBeDefined()
  await ui.unmount()
})

test('a Mac whose helper failed asks it again after 15 minutes, not an hour', async ($, on) => {
  const calls: string[] = []
  const runs: string[][] = []
  fakeWeather(on, calls)
  fakeMac(on, runs, 'refused')
  const clock = await start($, on)
  await clock.advance(10)
  const helperRuns = () => runs.filter(argv => String(argv[0]).includes('CoreLocationCLI')).length
  expect(helperRuns()).toBe(3)
  await clock.advance(15 * 60_000)
  expect(helperRuns()).toBe(6)
})

test('a Mac without the helper keeps its guess for the hour', async ($, on) => {
  const calls: string[] = []
  const runs: string[][] = []
  fakeWeather(on, calls)
  fakeMac(on, runs, null)
  const clock = await start($, on)
  await clock.advance(10)
  await clock.advance(15 * 60_000)
  expect(runs.filter(argv => String(argv[0]).includes('CoreLocationCLI')).length).toBe(3)
})


test('a saved location is reused for an hour only when it says where it came from', () => {
  const now = 10_000_000
  expect(isLocationFresh({ at: now - 10 * 60_000, source: 'mac' }, now)).toBe(true)
  expect(isLocationFresh({ at: now - 61 * 60_000, source: 'mac' }, now)).toBe(false)
  // Saved by an older version: no source, so checked again at once.
  expect(isLocationFresh({ at: now - 10 * 60_000 }, now)).toBe(false)
  expect(isLocationFresh(undefined, now)).toBe(false)
})

// ── Windows location ────────────────────────────────────────────────────────

test('the Windows location line becomes a fix', () => {
  expect(parseWindowsLocation('13.0912|100.9301|50000\r\n')).toEqual({ latitude: 13.0912, longitude: 100.9301, accuracyM: 50000 })
  expect(parseWindowsLocation('NaN|NaN|0')).toBeUndefined()
  expect(parseWindowsLocation('')).toBeUndefined()
})

/** A Windows PC: USERPROFILE set, and PowerShell answering the location script with `stdout` (or failing). */
function fakeWindows(on: On, runs: string[][], stdout: string, exitCode = 0) {
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? 'C:\\Users\\me' : undefined }) as never)
  on('process.run', (_$, e) => {
    const argv = [...(e as unknown as { argv: string[] }).argv]
    runs.push(argv)
    return { value: { exitCode: argv[0] === 'powershell.exe' ? exitCode : 1, stdout, stderr: '' } } as never
  })
}

test('on Windows a fix within 50 km names the city without "?"', async ($, on) => {
  const calls: string[] = []
  const runs: string[][] = []
  fakeWeather(on, calls)
  fakeWindows(on, runs, '13.09|100.93|50000')
  const clock = await start($, on)
  await clock.advance(10)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /📍 Si Racha ⛅/ })).toBeDefined()
  expect(calls.filter(url => url.includes('ipwho.is')).length).toBe(0)
  expect(runs.some(argv => argv[0] === 'powershell.exe')).toBe(true)
  await ui.unmount()
})

test('on Windows a fix rougher than 50 km falls back to the guess', async ($, on) => {
  const calls: string[] = []
  const runs: string[][] = []
  fakeWeather(on, calls)
  fakeWindows(on, runs, '13.09|100.93|80000')
  const clock = await start($, on)
  await clock.advance(10)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /📍 Bangkok\? / })).toBeDefined()
  expect(calls.filter(url => url.includes('bigdatacloud')).length).toBe(0)
  await ui.unmount()
})

test('on Windows with location access off, the guess is used', async ($, on) => {
  const calls: string[] = []
  const runs: string[][] = []
  fakeWeather(on, calls)
  fakeWindows(on, runs, '', 3)
  const clock = await start($, on)
  await clock.advance(10)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /📍 Bangkok\? / })).toBeDefined()
  await ui.unmount()
})

// ── Clickable recap ─────────────────────────────────────────────────────────

test('cited points keep their step numbers apart from the text', () => {
  expect(parseCitedPoints('- Made the cards blue [2]\n- Needs you: send the logo [3].\n- Checked it')).toEqual({
    points: ['Made the cards blue', 'Needs you: send the logo', 'Checked it'],
    refs: [2, 3, null],
  })
  expect(parsePoints('- Made the cards blue [2]')).toEqual(['Made the cards blue'])
})

test('a chat row is found again by how its text starts', () => {
  const rows = [
    { kind: 'user' as const, requestId: 'u1', text: 'make the pricing cards blue' },
    { kind: 'assistant' as const, requestId: 'a1', text: 'Made the pricing cards blue.' },
  ]
  expect(findRow(rows, 'assistant', 'Made the pricing cards blue. The footer still needs your logo.')).toBe('a1')
  expect(findRow(rows, 'user', 'make the pricing cards blue')).toBe('u1')
  expect(findRow(rows, 'assistant', 'Something else entirely')).toBeNull()
})

test('each recap point ends in ↗, and pressing it scrolls the chat to that reply', async ($, on) => {
  // What Claude Code draws beneath the plugin for a message row.
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => ($.ui.resolve(e) as unknown as { Box: (props: object) => never }).Box({}))
  on('ui.render', { component: 'UserMessage' }, ($, e) => ($.ui.resolve(e) as unknown as { Box: (props: object) => never }).Box({}))
  const clock = await start($, on, [
    { role: 'user', text: 'make the pricing cards blue' },
    { role: 'assistant', text: ANSWER },
  ])
  const row = await $.ui.mount({ plugin: 'calm-recap', component: 'AssistantMessage', requestId: 'msg-1', surface: 'terminal', props: { text: ANSWER, isFirstOfReply: true } } as never)
  await row.unmount()
  const asked = await $.ui.mount({ plugin: 'calm-recap', component: 'UserMessage', requestId: 'msg-0', surface: 'terminal', props: { text: 'make the pricing cards blue' } } as never)
  await asked.unmount()
  await $.command.run({ command: 'recap', args: '' } as never)
  await clock.advance(10)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const keys: string[] = []
  for (let i = 0; i < 20; i++) {
    if ((await ui.find({ key: `recap-go-${i}` })) !== undefined) keys.push(`recap-go-${i}`)
  }
  // Two points and "You last asked".
  expect(keys.length).toBe(3)
  await ui.press({ key: keys[0] ?? '' })
  await ui.press({ key: keys[2] ?? '' })
  // The test engine has no chat to scroll, so each press tries and says it could not.
  expect(toasts.filter(toast => toast.includes('could not scroll there')).length).toBe(2)
  await ui.unmount()
})

test('recap lines carry their link on the last line of each point and of the question', () => {
  const recap = {
    turnId: 't1', phase: 'done' as const, tookMs: 0, lastAsked: 'make the pricing cards blue', awaySince: 0,
    isShowing: true, isResumed: false, isCacheCold: false,
    points: ['Made the cards blue', 'Needs you: send the logo'],
    targets: ['tool-1', null], fallbackTarget: 'msg-1', askedTarget: 'msg-0',
  }
  const lines = recapLines(recap, { done: '✓ ', stopped: '■ ', sep: ' · ', rule: '─', shout: (t: string) => t, duration: () => '1m 0s', accent: 'claude', warn: 'warning', title: undefined } as never, false, 60).filter(line => line.target !== undefined)
  expect(lines.map(line => line.target)).toEqual(['tool-1', 'msg-1', 'msg-0'])
})
