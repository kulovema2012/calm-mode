import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clampVolume, cleanName, fitChecklist, keepWarmDecision, keepWarmUntil, weatherSymbol, weatherText, fitRecap, mayPlay, recapLines, stepAwayMinutes, fallbackPoints, parsePoints, wrapText, musicCommand, nextTrack, trackName, windowsMusicScript } from './calm-mode'

/** argv of every player the plugin started in the current test. */
let spawned: string[][] = []
/** Every status-line write the plugin made in the current test. */
let statuses: unknown[] = []
/** Every toast the plugin raised in the current test. */
let toasts: string[] = []

const PLAN_TOOL = 'mcp__calm-mode__plan_steps'
const PROGRESS_TOOL = 'mcp__calm-mode__report_progress'

const BAND = {
  plugin: 'calm-mode',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

/** The world beneath the plugin: store, clock, a quiet model, plain tools. */
async function start($: Engine, on: On, onModelCall: () => void = () => undefined) {
  spawned = []
  statuses = []
  toasts = []
  mock.store(on)
  on('process.spawn', async function* (_$, e) {
    spawned.push([...e.argv])
    return { value: { code: 0, signal: null } } as never
  })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('model.complete', () => {
    onModelCall()
    return { value: { isAnswered: true, text: 'Build my landing page', usage: {} } } as never
  })
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'file contents' }) as never)
  on('command.run', () => ({ text: '' }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__calm-mode__${e.name}` } }) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }) as never)
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined } as never
  })
  on('classic.Notification', () => ({}) as never)
  on('classic.SessionStart', () => ({}) as never)
  on('ui.status', (_$, e) => {
    statuses.push(e)
    return { value: undefined } as never
  })
  await $.session.start({ cwd: '', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  return clock
}

test('names are cleaned into plain words', () => {
  expect(cleanName('Build the pricing section in `src/Pricing.tsx`')).toBe('Build the pricing section in')
  expect(cleanName('Fix the menu in src/app/nav.tsx so it opens')).toBe('Fix the menu in so it opens')
  expect(cleanName('update the footer.css colours')).toBe('Update the colours')
  const long = cleanName(
    'Rewrite the whole onboarding flow so that new customers understand every single option they see',
  )
  expect(long.length <= 60).toBe(true)
  expect(long.endsWith('…')).toBe(true)
  expect(cleanName('`npm run build`')).toBe('Working on it')
})

test('a to-do list plus a 60% report draws done, current, next and later rows', async ($, on) => {
  await start($, on)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Read your brand notes', status: 'completed', activeForm: 'Reading' },
      { content: 'Build the pricing section', status: 'in_progress', activeForm: 'Building' },
      { content: 'Add the contact form', status: 'pending', activeForm: 'Adding' },
      { content: 'Polish the footer', status: 'pending', activeForm: 'Polishing' },
    ],
  })
  await $.tool.call({ tool: PROGRESS_TOOL, task: 'Build the pricing section', percent: 60 } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: '✓ ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▶ ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '  60%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '  Next' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '  Up next' })).toBeDefined()
    expect(await ui.find({ key: 'calm-toggle' })).toBeDefined()
    await ui.unmount()
  }
})

test('a permission prompt shows Needs you', async ($, on) => {
  await start($, on)
  await $.classic.Notification({
    message: 'Claude needs your permission to use Bash',
    notification_type: 'permission_prompt',
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Needs you/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /needs your OK/ })).toBeDefined()
  await ui.unmount()
})

test('/calm off hides the band and leaves only the button', async ($, on) => {
  await start($, on)
  await $.command.run({ command: 'calm', args: 'off' } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Understand your request/ })).toBeUndefined()
  const button = await ui.find({ key: 'calm-toggle' })
  expect(button?.props.label).toBe('○ Calm Mode')
  await ui.unmount()
})

test('plan_steps then report_progress at 100 checks off step one and starts step two', async ($, on) => {
  await start($, on)
  await $.tool.call({ tool: PLAN_TOOL, steps: ['Read your notes', 'Build the page', 'Check it works'] } as never)
  await $.tool.call({ tool: PROGRESS_TOOL, task: 'Read your notes', percent: 100 } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Read your notes/ }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^Build the page/ }))?.props.bold).toBe(true)
  expect(await ui.find({ type: 'Text', text: '  Done' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  Working' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  Next' })).toBeDefined()
  await ui.unmount()
})

test('tools are denied before a plan exists and allowed after', async ($, on) => {
  await start($, on)
  const before = await $.tool.call({ tool: 'Read', file_path: 'notes.md' })
  expect(before.isError === true || before.deny !== undefined).toBe(true)
  expect(`${before.text ?? ''}${before.deny ?? ''}`).toMatch(/plan_steps/)

  await $.tool.call({ tool: PLAN_TOOL, steps: ['Read your notes', 'Write the answer'] } as never)
  const after = await $.tool.call({ tool: 'Read', file_path: 'notes.md' })
  expect(after.isError === true || after.deny !== undefined).toBe(false)
})

// ── Settings (v0.2.0) ──────────────────────────────────────────────────────

const TOOL_ROW = {
  plugin: 'calm-mode',
  component: 'ToolUse',
  props: {
    tool_use_id: 'tu1',
    tool: 'Read',
    input: { file_path: 'notes.md' },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
  },
} as const

test('the gear opens on/off buttons for every setting and a label field', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'set-hide' })).toBeUndefined()
  await ui.press({ key: 'calm-settings' })
  expect((await ui.find({ key: 'set-hide' }))?.props.label).toBe('◉')
  expect((await ui.find({ key: 'set-naming' }))?.props.label).toBe('◉')
  expect((await ui.find({ key: 'set-cyber' }))?.props.label).toBe('○')
  expect(await ui.find({ type: 'Text', text: /Neon pink and cyan look/ })).toBeDefined()
  expect(await ui.find({ key: 'set-label' })).toBeDefined()
  await ui.unmount()
})

test('pressing a setting button changes it through /config', async ($, on) => {
  const writes: Array<{ key: string; value: unknown }> = []
  on('config.list', () =>
    ({ value: ['hideToolRows', 'jobNaming', 'buttonLabel', 'cyberpunk'].map(field => ({ key: `calm-mode.${field}` })) }) as never,
  )
  on('config.set', (_$, e) => {
    writes.push({ key: e.key, value: e.value })
    return { value: e.value } as never
  })
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'calm-settings' })
  await ui.press({ key: 'set-cyber' })
  expect(writes).toEqual([{ key: 'calm-mode.cyberpunk', value: true }])
  expect((await ui.find({ key: 'set-cyber' }))?.props.label).toBe('◉')
  expect(await ui.find({ type: 'Text', text: /Cyberpunk: On\. Neon pink and cyan look\./ })).toBeDefined()
  await ui.input({ key: 'set-label', text: 'Zen' })
  expect((await ui.find({ key: 'calm-toggle' }))?.props.label).toBe('🍃 ZEN ⏻')
  await ui.unmount()
})

test('cyberpunk theme draws neon rows', { options: { cyberpunk: true, buttonLabel: 'Neo' } }, async ($, on) => {
  await start($, on)
  await $.tool.call({ tool: PLAN_TOOL, steps: ['Read your notes', 'Build the page'] } as never)
  await $.tool.call({ tool: PROGRESS_TOOL, task: 'Build the page', percent: 60 } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: '◆ ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▸ ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▰▰▰▰▰▰▱▱▱▱' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◢◤ BUILD MY LANDING PAGE/ })).toBeDefined()
    expect((await ui.find({ key: 'calm-toggle' }))?.props.label).toBe('🍃 NEO ⏻')
    await ui.unmount()
  }
})

test('tool rows hide by default and show when the setting is off', async ($, on) => {
  await start($, on)
  const hidden = await $.ui.mount({ ...TOOL_ROW, surface: 'terminal' })
  expect(await hidden.drawn()).toMatchObject({ type: 'Box', props: { display: 'none' } })
  await hidden.unmount()
})

test('tool rows stay visible with hide tool rows off', { options: { hideToolRows: false } }, async ($, on) => {
  on('ui.render', { component: 'ToolUse' }, (_$, e) => ({ type: 'Text', props: {}, children: [`row ${e.props.tool}`] }) as never)
  await start($, on)
  const shown = await $.ui.mount({ ...TOOL_ROW, surface: 'terminal' })
  expect(await shown.find({ type: 'Text', text: 'row Read' })).toBeDefined()
  await shown.unmount()
})

test('job naming on asks the model once per new job', async ($, on) => {
  let modelCalls = 0
  const clock = await start($, on, () => {
    modelCalls += 1
  })
  await clock.advance(10)
  expect(modelCalls >= 1).toBe(true)
})

test('job naming off never calls the model', { options: { jobNaming: false } }, async ($, on) => {
  let modelCalls = 0
  const clock = await start($, on, () => {
    modelCalls += 1
  })
  await clock.advance(10)
  expect(modelCalls).toBe(0)
})

test('plan_steps says "1 step" for a one-step plan and "N steps" otherwise', async ($, on) => {
  await start($, on)
  const one = await $.tool.call({ tool: PLAN_TOOL, steps: ['Reply to your test'] } as never)
  expect(String(one.result)).toBe('Planned 1 step. The first one has started.')
  const two = await $.tool.call({ tool: PLAN_TOOL, steps: ['Read your notes', 'Write the answer'] } as never)
  expect(String(two.result)).toBe('Planned 2 steps. The first one has started.')
})

// ── Music (v0.3.0) ─────────────────────────────────────────────────────────

test('music command per platform, built-in track by default', () => {
  const win = musicCommand('C:\\mods\\calm-mode', '', 35)
  expect(win?.[0]).toBe('powershell')
  expect(win).toContain('-EncodedCommand')
  expect(musicCommand('/Users/newk/calm-mode', '', 35)).toBeNull()
  expect(musicCommand('/Users/newk/calm-mode', '/Users/newk/song.mp3', 35)?.[0]).toBe('/bin/sh')
  expect(musicCommand('/home/newk/calm-mode', '', 35)).toEqual([
    'ffplay', '-nodisp', '-loglevel', 'quiet', '-loop', '0', '-volume', '35', '/home/newk/calm-mode/sounds/neon-drive.wav',
  ])
})

test('a music path cannot break out of the PowerShell string', () => {
  const script = windowsMusicScript("C:/x'; Remove-Item C:/ -Recurse; '.mp3", 35)
  expect(script).toContain("[Uri]'C:/x''; Remove-Item C:/ -Recurse; ''.mp3'")
})

test('music plays while Claude works in cyberpunk', { options: { cyberpunk: true } }, async ($, on) => {
  await start($, on)
  expect(spawned.length).toBe(1)
})

test('no music without cyberpunk', async ($, on) => {
  await start($, on)
  expect(spawned.length).toBe(0)
})

test('no music when the music setting is off', { options: { cyberpunk: true, music: false } }, async ($, on) => {
  await start($, on)
  expect(spawned.length).toBe(0)
})

test('the settings row has a music button and a music file field', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'calm-settings' })
  await ui.press({ key: 'tab-music' })
  expect((await ui.find({ key: 'set-music' }))?.props.label).toBe('◉')
  expect(await ui.find({ type: 'Text', text: /Turn Cyberpunk on/ })).toBeDefined()
  expect(await ui.find({ key: 'set-music-file' })).toBeDefined()
  await ui.unmount()
})

test('volume is clamped to 0..100 and reaches each player', () => {
  expect(clampVolume(140)).toBe(100)
  expect(clampVolume(-5)).toBe(0)
  expect(clampVolume('loud')).toBe(35)
  expect(windowsMusicScript('C:/song.mp3', 70)).toContain('$player.Volume = 0.70')
  expect(musicCommand('/home/newk/calm-mode', '', 80)).toContain('80')
})

test('the volume buttons step the music volume by 10', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'calm-settings' })
  await ui.press({ key: 'tab-music' })
  expect(await ui.find({ type: 'Text', text: ' 35% ' })).toBeDefined()
  await ui.press({ key: 'vol-up' })
  expect(await ui.find({ type: 'Text', text: ' 45% ' })).toBeDefined()
  await ui.press({ key: 'vol-down' })
  await ui.press({ key: 'vol-down' })
  expect(await ui.find({ type: 'Text', text: ' 25% ' })).toBeDefined()
  await ui.unmount()
})

test('volume 0 keeps the player off', { options: { cyberpunk: true, musicVolume: 0 } }, async ($, on) => {
  await start($, on)
  expect(spawned.length).toBe(0)
})

// ── Tracks (v0.4.0) ────────────────────────────────────────────────────────

test('the track button cycles through every track, then shuffle, then wraps', () => {
  expect(nextTrack('neon-drive')).toBe('night-rain')
  expect(nextTrack('chrome-ambient')).toBe('shuffle')
  expect(nextTrack('shuffle')).toBe('neon-drive')
  expect(trackName('hacker-pulse')).toBe('Hacker Pulse')
  expect(trackName('shuffle')).toBe('Shuffle')
})

test('the chosen track is the one that plays', { options: { cyberpunk: true, track: 'night-rain' } }, async ($, on) => {
  await start($, on)
  expect(spawned.length).toBe(1)
  expect(musicCommand('/home/newk/calm-mode', '', 35, 'sounds/night-rain.wav')).toContain(
    '/home/newk/calm-mode/sounds/night-rain.wav',
  )
})

test('shuffle plays one of the built-in tracks', { options: { cyberpunk: true, track: 'shuffle' } }, async ($, on) => {
  await start($, on)
  expect(spawned.length).toBe(1)
})

test('the track button shows and steps the track', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'calm-settings' })
  await ui.press({ key: 'tab-music' })
  expect((await ui.find({ key: 'set-track' }))?.props.label).toBe('♪ Neon Drive')
  await ui.press({ key: 'set-track' })
  expect((await ui.find({ key: 'set-track' }))?.props.label).toBe('♪ Night Rain')
  await ui.unmount()
})

// ── Away recap and cache meter (v0.5.0) ────────────────────────────────────

const FINISHED = { answer: 'Added the pricing section. The footer needs your logo.', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('the cache meter is never drawn in the band', async ($, on) => {
  await start($, on)
  await $.turn.complete({ ...FINISHED, usage: { model: 'm', input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
  await ui.unmount()
  expect(JSON.stringify(statuses)).not.toContain('cache')
})

test('the status-line button runs the installer and records the choice', async ($, on) => {
  const runs: string[][] = []
  on('process.run', (_$, e) => {
    runs.push([...(e as unknown as { argv: string[] }).argv])
    return { value: { exitCode: 0, stdout: 'Added the cache meter to the right end of your status line.\n', stderr: '' } } as never
  })
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'calm-settings' })
  await ui.press({ key: 'tab-status' })
  expect((await ui.find({ key: 'set-cache' }))?.props.label).toBe('○')
  await ui.press({ key: 'set-cache' })
  // On load the plugin only asks for the status; the press is the one change.
  expect(runs.filter(argv => argv[2] === 'status').length).toBe(1)
  const changes = runs.filter(argv => argv[2] !== 'status')
  expect(changes.length).toBe(1)
  expect(changes[0]?.[0]).toBe('node')
  expect(String(changes[0]?.[1])).toMatch(/statusline[\\/]install\.mjs$/)
  expect(changes[0]?.[2]).toBe('install')
  expect((await ui.find({ key: 'set-cache' }))?.props.label).toBe('◉')
  await ui.unmount()
})

test('fallback points: first sentences without code or markdown', () => {
  const answer = ['## Done', 'I fixed `src/a.ts`.', '```ts', 'const x = 1', '```', 'All good. Ship it! Extra.'].join(String.fromCharCode(10))
  expect(fallbackPoints(answer)).toEqual(['Done I fixed .', 'All good.', 'Ship it!'])
  expect(fallbackPoints('')).toEqual(['Claude finished without a written reply.'])
})

test('Haiku points: dashes and numbers stripped, at most three, "Needs you" kept', () => {
  const nl = String.fromCharCode(10)
  expect(parsePoints(['- Added the pricing section', '• Fixed the menu', '', '3) Tidied the footer', '- Needs you: send the logo'].join(nl))).toEqual([
    'Added the pricing section',
    'Fixed the menu',
    'Tidied the footer',
  ])
  expect(parsePoints('- Needs you: send the logo')).toEqual(['Needs you: send the logo'])
})

test('wrapText keeps lines within the width at word boundaries', () => {
  expect(wrapText('one two three four five', 9)).toEqual(['one two', 'three', 'four five'])
  expect(wrapText('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl'])
})

test('after 5 quiet minutes the band shows a Welcome back card; Got it clears it', async ($, on) => {
  const clock = await start($, on)
  await $.tool.call({ tool: PLAN_TOOL, steps: ['Build the page'] } as never)
  await $.tool.call({ tool: PROGRESS_TOOL, task: 'Build the page', percent: 100 } as never)
  await $.turn.complete(FINISHED as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /WELCOME BACK|Welcome back/ })).toBeUndefined()
  await clock.advance(5 * 60_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /You last asked/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Build my landing page/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /What Claude did/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^  • \S/ })).toBeDefined()
  await ui.press({ key: 'recap-ok' })
  expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeUndefined()
  await ui.unmount()
})

test('no Welcome back card with the away recap off', { options: { awayRecap: false } }, async ($, on) => {
  const clock = await start($, on)
  await $.turn.complete(FINISHED as never)
  await clock.advance(10 * 60_000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeUndefined()
  await ui.unmount()
})

// ── One shared player across sessions (v0.8.0) ─────────────────────────────

/** An in-memory ~/.claude for the lock file, as another session would leave it. Keyed by file name, because the
 * engine normalizes paths (on Windows a drive letter is added) before the fs hooks see them. */
function fakeHome(on: Parameters<typeof start>[1], files: Map<string, string>, sessionId: string) {
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

const LOCK = 'calm-mode-music.json'

test('lock rules: free, own, stale and busy', () => {
  expect(mayPlay(null, 'me', 10_000)).toBe(true)
  expect(mayPlay({ owner: null, heartbeat: 0 }, 'me', 10_000)).toBe(true)
  expect(mayPlay({ owner: 'me', heartbeat: 9_000 }, 'me', 10_000)).toBe(true)
  expect(mayPlay({ owner: 'other', heartbeat: 9_000 }, 'me', 10_000)).toBe(false)
  expect(mayPlay({ owner: 'other', heartbeat: 0 }, 'me', 10_000)).toBe(true)
})

test('a session stays quiet while another session holds the player', { options: { cyberpunk: true } }, async ($, on) => {
  const files = new Map([[LOCK, JSON.stringify({ owner: 'other-session', heartbeat: 1_000_000 })]])
  fakeHome(on, files, 'this-session')
  await start($, on)
  expect(spawned.length).toBe(0)
})

test('a session takes the player over when the other session went quiet', { options: { cyberpunk: true } }, async ($, on) => {
  const files = new Map([[LOCK, JSON.stringify({ owner: 'other-session', heartbeat: 1_000 })]])
  fakeHome(on, files, 'this-session')
  await start($, on)
  expect(spawned.length).toBe(1)
  expect(JSON.parse(files.get(LOCK) ?? '{}').owner).toBe('this-session')
})

test('finishing the job hands the player back', { options: { cyberpunk: true } }, async ($, on) => {
  const files = new Map<string, string>()
  fakeHome(on, files, 'this-session')
  await start($, on)
  expect(JSON.parse(files.get(LOCK) ?? '{}').owner).toBe('this-session')
  await $.turn.complete(FINISHED as never)
  expect(JSON.parse(files.get(LOCK) ?? '{}').owner).toBe(null)
})

// ── Resume recap and readable card (v0.9.0) ────────────────────────────────

test('claude --resume shows Welcome back from the saved conversation', async ($, on) => {
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'make the pricing cards blue', toolUses: [] },
      { role: 'assistant', text: 'Made the pricing cards blue. The footer still needs your logo.', toolUses: [] },
      { role: 'user', text: '<system-reminder>ignore me</system-reminder>', toolUses: [] },
    ],
  }) as never)
  const clock = await start($, on)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 7200, prompt_cache_likely_expired: true } as never)
  await clock.advance(600)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Welcome back · away 2h/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Resumed session · cache expired/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Where you left off/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /make the pricing cards blue/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ignore me/ })).toBeUndefined()
  await ui.unmount()
})

test('no resume card with the away recap off', { options: { awayRecap: false } }, async ($, on) => {
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'Done.', toolUses: [] }] }) as never)
  const clock = await start($, on)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 600 } as never)
  await clock.advance(600)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeUndefined()
  await ui.unmount()
})

test('the Welcome back card has no frame on any surface', async ($, on) => {
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'Done.', toolUses: [] }] }) as never)
  const clock = await start($, on)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 600 } as never)
  await clock.advance(600)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Box' })).some(box => box.props.borderStyle !== undefined)).toBe(false)
    await ui.unmount()
  }
})

test('the live checklist has no frame', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Box' })).some(box => box.props.borderStyle !== undefined)).toBe(false)
  await ui.unmount()
})

test('the cyberpunk Welcome back card uses dashed neon rules and no frame', { options: { cyberpunk: true } }, async ($, on) => {
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'Done.', toolUses: [] }] }) as never)
  const clock = await start($, on)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 600 } as never)
  await clock.advance(600)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Box' })).some(box => box.props.borderStyle !== undefined)).toBe(false)
  const rules = await ui.findAll({ type: 'Text', text: /^┄{20,}$/ })
  expect(rules.length).toBe(2)
  expect(rules[0]?.props.color).toBe('#ff2bd6')
  await ui.unmount()
})

test('sections of the Welcome back card are split by thin rules', async ($, on) => {
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'make the pricing cards blue', toolUses: [] },
      { role: 'assistant', text: 'Done.', toolUses: [] },
    ],
  }) as never)
  const clock = await start($, on)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 600 } as never)
  await clock.advance(600)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // under the header, after the status line, and before "You last asked"
  expect((await ui.findAll({ type: 'Text', text: /^─{20,}$/ })).length).toBe(3)
  await ui.unmount()
})

test('/calm recap shows the Welcome back card right away', async ($, on) => {
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'make the pricing cards blue', toolUses: [] },
      { role: 'assistant', text: 'Made the cards blue.', toolUses: [] },
    ],
  }) as never)
  await start($, on)
  const ran = await $.command.run({ command: 'calm', args: 'recap' } as never)
  expect(ran.text).toBe('Showing the Welcome back card above the prompt.')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeDefined()
  // this session's own last request wins over the saved one
  expect(await ui.find({ type: 'Text', text: /Build my landing page/ })).toBeDefined()
  await ui.unmount()
})

test('away time steps: 1 to 120 minutes, staying at the ends', () => {
  expect(stepAwayMinutes(5, 1)).toBe(10)
  expect(stepAwayMinutes(5, -1)).toBe(3)
  expect(stepAwayMinutes(7, 1)).toBe(10)
  expect(stepAwayMinutes(7, -1)).toBe(5)
  expect(stepAwayMinutes(1, -1)).toBe(1)
  expect(stepAwayMinutes(120, 1)).toBe(120)
})

test('the away buttons change how long before the card shows', async ($, on) => {
  const clock = await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'calm-settings' })
  await ui.press({ key: 'tab-recap' })
  expect(await ui.find({ type: 'Text', text: ' 5m ' })).toBeDefined()
  await ui.press({ key: 'away-down' })
  await ui.press({ key: 'away-down' })
  expect(await ui.find({ type: 'Text', text: ' 2m ' })).toBeDefined()
  await $.tool.call({ tool: PLAN_TOOL, steps: ['Build the page'] } as never)
  await $.tool.call({ tool: PROGRESS_TOOL, task: 'Build the page', percent: 100 } as never)
  await $.turn.complete(FINISHED as never)
  await clock.advance(2 * 60_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Welcome back/ })).toBeDefined()
  await ui.unmount()
})

// ── Bigger plan, fitted band, recap pane (v0.10.0) ─────────────────────────

const task = (i: number, status: 'done' | 'active' | 'upcoming') => ({
  id: `t${i}`,
  name: `Step ${i}`,
  status,
  percent: status === 'done' ? 100 : 0,
  hasReported: status === 'done',
})

test('a plan takes up to 12 steps', async ($, on) => {
  await start($, on)
  const steps = Array.from({ length: 14 }, (_, i) => `Do part ${i + 1}`)
  const planned = await $.tool.call({ tool: PLAN_TOOL, steps } as never)
  expect(String(planned.result)).toBe('Planned 12 steps. The first one has started.')
})

test('checklist folds finished steps, then later ones, to fit the rows', () => {
  const tasks = [task(1, 'done'), task(2, 'done'), task(3, 'done'), task(4, 'active'), task(5, 'upcoming'), task(6, 'upcoming')]
  expect(fitChecklist(tasks, 6)).toEqual({ foldedDone: 0, shown: tasks, foldedAfter: 0 })
  const four = fitChecklist(tasks, 4)
  expect(four.foldedDone).toBe(3)
  expect(four.shown.map(t => t.id)).toEqual(['t4', 't5', 't6'])
  const three = fitChecklist(tasks, 3)
  expect(three.foldedDone).toBe(3)
  expect(three.shown.map(t => t.id)).toEqual(['t4'])
  expect(three.foldedAfter).toBe(2)
})

test('the band never scrolls: a short band shows the folded checklist', async ($, on) => {
  await start($, on)
  const steps = Array.from({ length: 10 }, (_, i) => `Do part ${i + 1}`)
  await $.tool.call({ tool: PLAN_TOOL, steps } as never)
  await $.tool.call({ tool: PROGRESS_TOOL, task: 'Do part 6', percent: 40 } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, maxRows: 5 } })
  expect(await ui.find({ type: 'Text', text: /5 steps done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /more steps/ })).toBeDefined()
  await ui.unmount()
})

test('recap fitting drops rules, then the question, then extra points', () => {
  const recap = {
    jobId: 1, title: 'Build the page', phase: 'done', tookMs: 60_000, stepsDone: 2, stepsTotal: 2,
    points: ['First point', 'Second point', 'Third point'], lastAsked: 'make it blue',
    awaySince: 0, isShowing: true, isResumed: false, isCacheCold: false,
  } as const
  const theme = { icons: { done: '✓ ', active: '▶ ', paused: '‖ ', upcoming: '○ ' }, sep: ' · ', shout: (t: string) => t, duration: () => '1m 0s', accent: 'claude', done: 'success', warn: 'warning', title: undefined } as never
  const all = recapLines({ ...recap, points: [...recap.points] }, theme, false, 60)
  expect(all.map(l => l.kind)).toEqual(['divider', 'status', 'divider', 'heading', 'point', 'point', 'point', 'divider', 'askedHeading', 'asked'])
  expect(fitRecap(all, 7).map(l => l.kind)).toEqual(['status', 'heading', 'point', 'point', 'point', 'askedHeading', 'asked'])
  expect(fitRecap(all, 5).map(l => l.kind)).toEqual(['status', 'heading', 'point', 'point', 'point'])
  expect(fitRecap(all, 3).map(l => l.kind)).toEqual(['status', 'heading', 'point'])
})

test('pane style: the band keeps one line with Open recap', { options: { recapStyle: 'pane' } }, async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'Done.', toolUses: [] }] }) as never)
  await start($, on)
  await $.command.run({ command: 'calm', args: 'recap' } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'recap-open' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /What Claude did/ })).toBeUndefined()
  await ui.unmount()
})

test('the recap pane shows the full card with the job steps', async ($, on) => {
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'Done.', toolUses: [] }] }) as never)
  await start($, on)
  await $.tool.call({ tool: PLAN_TOOL, steps: ['Read your notes', 'Build the page'] } as never)
  await $.command.run({ command: 'calm', args: 'recap' } as never)
  const pane = await $.ui.mount({
    plugin: 'calm-mode',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'calm-recap',
    props: { title: 'Welcome back', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } },
  } as never)
  expect(await pane.find({ type: 'Text', text: /Welcome back/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Steps$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Read your notes/ })).toBeDefined()
  expect(await pane.find({ key: 'recap-pane-ok' })).toBeDefined()
  await pane.unmount()
})

// ── Tabbed settings panel (v0.11.0) ────────────────────────────────────────

test('settings show one tab at a time, switched by click or number key', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'calm-settings' })
  expect((await ui.find({ key: 'tab-display' }))?.props.hotkey).toBe('1')
  expect(await ui.find({ key: 'set-hide' })).toBeDefined()
  expect(await ui.find({ key: 'set-music' })).toBeUndefined()
  await ui.press({ key: 'tab-recap' })
  expect(await ui.find({ key: 'set-hide' })).toBeUndefined()
  expect(await ui.find({ key: 'set-away' })).toBeDefined()
  expect((await ui.find({ key: 'set-recap-style' }))?.props.label).toBe('Band')
  await ui.unmount()
})

test('Reset puts every setting back but leaves the status line alone', { options: { cyberpunk: true, musicVolume: 80, awayMinutes: 30 } }, async ($, on) => {
  const writes: string[] = []
  on('config.list', () => ({ value: ['cyberpunk', 'musicVolume', 'awayMinutes', 'cacheMeter'].map(f => ({ key: `calm-mode.${f}` })) }) as never)
  on('config.set', (_$, e) => {
    writes.push(e.key)
    return { value: e.value } as never
  })
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'calm-settings' })
  await ui.press({ key: 'set-reset' })
  expect(writes.sort()).toEqual(['calm-mode.awayMinutes', 'calm-mode.cyberpunk', 'calm-mode.musicVolume'])
  expect((await ui.find({ key: 'set-cyber' }))?.props.label).toBe('○')
  expect(await ui.find({ type: 'Text', text: /back to its default/ })).toBeDefined()
  await ui.unmount()
})

test('the job timer starts in the same column as the progress bars', async ($, on) => {
  await start($, on)
  await $.tool.call({ tool: PLAN_TOOL, steps: ['Read your notes', 'Build the page'] } as never)
  await $.tool.call({ tool: PROGRESS_TOOL, task: 'Build the page', percent: 60 } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const title = await ui.find({ type: 'Text', text: /^Build my landing page +$/ })
  const timer = await ui.find({ type: 'Text', text: /^⏱ / })
  const name = await ui.find({ type: 'Text', text: /^Build the page +$/ })
  expect(timer).toBeDefined()
  // the title cell spans the icon (2) and the name cell, so both start the next text at the same column
  expect(String(title?.text).length).toBe(2 + String(name?.text).length)
  await ui.unmount()
})

// ── Leaf and weather (v0.12.0) ─────────────────────────────────────────────

test('weather codes become symbols, with night versions of clear skies', () => {
  expect(weatherSymbol(0, true)).toBe('☀')
  expect(weatherSymbol(0, false)).toBe('☾')
  expect(weatherSymbol(2, true)).toBe('⛅')
  expect(weatherSymbol(3, true)).toBe('☁')
  expect(weatherSymbol(63, true)).toBe('🌧')
  expect(weatherSymbol(95, false)).toBe('⛈')
  expect(weatherText({ symbol: '⛅', tempC: 30.6 })).toBe('⛅ 31°C')
  expect(weatherText({ symbol: '☀', tempC: 29, city: 'Bangkok' })).toBe('📍 Bangkok ☀ 29°C')
  expect(weatherText({ symbol: '☀', tempC: 29, city: 'Llanfairpwllgwyngyll' })).toBe('📍 Llanfairpwllgwyng… ☀ 29°C')
})

/** ipwho.is and Open-Meteo, answered from memory; counts the requests. */
function fakeWeather(on: Parameters<typeof start>[1], calls: string[]) {
  on('http.fetch', (_$, e) => {
    const url = String((e as unknown as { url: string }).url)
    calls.push(url)
    const text = url.includes('ipwho.is')
      ? JSON.stringify({ success: true, latitude: 13.75, longitude: 100.5, city: 'Bangkok' })
      : JSON.stringify({ current: { temperature_2m: 30.6, weather_code: 2, is_day: 1 } })
    return { value: { status: 200, ok: true, headers: {}, text } } as never
  })
}

test('turned off, the weather makes no requests and shows nothing', { options: { weather: false } }, async ($, on) => {
  const calls: string[] = []
  fakeWeather(on, calls)
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /°C/ })).toBeUndefined()
  expect(calls).toEqual([])
  await ui.unmount()
})

test('by default the weather shows beside the gear and refreshes every 15 minutes', async ($, on) => {
  const calls: string[] = []
  fakeWeather(on, calls)
  const clock = await start($, on)
  await clock.advance(10)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '📍 Bangkok ⛅ 31°C  ' })).toBeDefined()
  expect(calls.filter(url => url.includes('ipwho.is')).length).toBe(1)
  // finish the job first, so 15 minutes of progress animation do not have to play out
  await $.turn.complete(FINISHED as never)
  await clock.advance(15 * 60_000)
  // the city is kept for a day; only the weather is asked again
  expect(calls.filter(url => url.includes('ipwho.is')).length).toBe(1)
  expect(calls.filter(url => url.includes('open-meteo')).length).toBe(2)
  await ui.unmount()
})

test('the weather switch lives in the Display tab', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'calm-settings' })
  expect((await ui.find({ key: 'set-weather' }))?.props.label).toBe('◉')
  expect(await ui.find({ type: 'Text', text: /Temperature now, by your city/ })).toBeDefined()
  await ui.unmount()
})

// ── Keep warm (v0.13.0) ─────────────────────────────────────────────────────

const FORKED = { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 0 } } }

test('keep-warm decisions: ping only in the last 5 minutes of a warm 1-hour cache', () => {
  const now = 1_000_000
  const at = (minutes: number) => (now + minutes * 60_000) / 1000
  expect(keepWarmDecision(null, 0, now)).toBe('no-meter')
  expect(keepWarmDecision({ ttl: '5m', expiresAt: at(3), warm: true }, 0, now)).toBe('short-cache')
  expect(keepWarmDecision({ ttl: '1h', expiresAt: at(30), warm: true }, 0, now)).toBe('wait')
  expect(keepWarmDecision({ ttl: '1h', expiresAt: at(4), warm: true }, 0, now)).toBe('ping')
  expect(keepWarmDecision({ ttl: '1h', expiresAt: at(-1), warm: false }, 0, now)).toBe('cold')
  // a ping of our own keeps it warm past what Claude Code last reported
  expect(keepWarmDecision({ ttl: '1h', expiresAt: at(-1), warm: false }, now + 50 * 60_000, now)).toBe('wait')
})

test('keep-warm durations: on, 3h, 90m, until 18:00', () => {
  const now = new Date(2026, 9, 8, 14, 0).getTime()
  expect(keepWarmUntil('on', now)).toBeNull()
  expect(keepWarmUntil(' 3h', now)).toBe(now + 3 * 3_600_000)
  expect(keepWarmUntil('90m', now)).toBe(now + 90 * 60_000)
  expect(keepWarmUntil('until 18:00', now)).toBe(new Date(2026, 9, 8, 18, 0).getTime())
  expect(keepWarmUntil('until 09:30', now)).toBe(new Date(2026, 9, 9, 9, 30).getTime())
  expect(keepWarmUntil('soon', now)).toBeUndefined()
})

test('keep warm pings 5 minutes before the cache expires, never sooner, and records how long it lasts', async ($, on) => {
  const files = new Map<string, string>([['sess1.json', JSON.stringify({ ttl: '1h', expiresAt: (1_000_000 + 10 * 60_000) / 1000, warm: true })]])
  fakeHome(on, files, 'sess1')
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return FORKED as never
  })
  const clock = await start($, on)
  await $.turn.complete(FINISHED as never)
  const said = await $.command.run({ command: 'calm', args: 'keepwarm on' } as never)
  expect(said.text).toBe('Keep warm is on (stops after 20 pings in a row).')
  await clock.advance(4 * 60_000)
  expect(forks).toBe(0)
  await clock.advance(2 * 60_000)
  expect(forks).toBe(1)
  const kept = JSON.parse(files.get('sess1.keepwarm.json') ?? '{}')
  expect(kept.isOn).toBe(true)
  expect(kept.warmUntil > 1_000_000 + 60 * 60_000).toBe(true)
  await clock.advance(10 * 60_000)
  expect(forks).toBe(1)
})

test('keep warm never wakes a cold cache and skips the 5-minute cache', async ($, on) => {
  const files = new Map<string, string>([['sess1.json', JSON.stringify({ ttl: '1h', expiresAt: 900, warm: false })]])
  fakeHome(on, files, 'sess1')
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return FORKED as never
  })
  const clock = await start($, on)
  await $.turn.complete(FINISHED as never)
  await $.command.run({ command: 'calm', args: 'keepwarm on' } as never)
  await clock.advance(3 * 60_000)
  files.set('sess1.json', JSON.stringify({ ttl: '5m', expiresAt: (1_000_000 + 4 * 60_000) / 1000, warm: true }))
  await clock.advance(3 * 60_000)
  expect(forks).toBe(0)
})

test('keep warm stops at the time given, and /calm keepwarm off stops it', async ($, on) => {
  const files = new Map<string, string>()
  fakeHome(on, files, 'sess1')
  const clock = await start($, on)
  await $.turn.complete(FINISHED as never)
  await $.command.run({ command: 'calm', args: 'keepwarm 30m' } as never)
  expect(JSON.parse(files.get('sess1.keepwarm.json') ?? '{}').isOn).toBe(true)
  await clock.advance(31 * 60_000)
  expect(JSON.parse(files.get('sess1.keepwarm.json') ?? '{}').isOn).toBe(false)
  await $.command.run({ command: 'calm', args: 'keepwarm on' } as never)
  const off = await $.command.run({ command: 'calm', args: 'keepwarm off' } as never)
  expect(off.text).toBe('Keep warm is off.')
  expect(JSON.parse(files.get('sess1.keepwarm.json') ?? '{}').isOn).toBe(false)
})

test('the Status line tab has a Keep warm switch that needs the cache meter', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'calm-settings' })
  await ui.press({ key: 'tab-status' })
  expect((await ui.find({ key: 'set-keepwarm' }))?.props.label).toBe('○')
  expect(await ui.find({ type: 'Text', text: /Needs Cache in status line/ })).toBeDefined()
  await ui.unmount()
})
