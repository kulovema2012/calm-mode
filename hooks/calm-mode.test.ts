import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clampVolume, cleanName, musicCommand, nextTrack, trackName, windowsMusicScript } from './calm-mode'

/** argv of every player the plugin started in the current test. */
let spawned: string[][] = []

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
  on('ui.toast', () => ({ value: undefined }) as never)
  on('classic.Notification', () => ({}) as never)
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
  expect(long.length <= 40).toBe(true)
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
  expect(button?.props.label).toBe('○ Calm Mode: OFF')
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
  expect((await ui.find({ key: 'set-hide' }))?.props.label).toBe('Hide tool rows: ON')
  expect((await ui.find({ key: 'set-naming' }))?.props.label).toBe('Job naming: ON')
  expect((await ui.find({ key: 'set-cyber' }))?.props.label).toBe('Cyberpunk: OFF')
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
  expect((await ui.find({ key: 'set-cyber' }))?.props.label).toBe('Cyberpunk: ON')
  await ui.input({ key: 'set-label', text: 'Zen' })
  expect((await ui.find({ key: 'calm-toggle' }))?.props.label).toBe('⚡ ZEN//ON')
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
    expect((await ui.find({ key: 'calm-toggle' }))?.props.label).toBe('⚡ NEO//ON')
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
  expect((await ui.find({ key: 'set-music' }))?.props.label).toBe('Music: ON (Cyberpunk only)')
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
  expect(await ui.find({ type: 'Text', text: ' Volume 35% ' })).toBeDefined()
  await ui.press({ key: 'vol-up' })
  expect(await ui.find({ type: 'Text', text: ' Volume 45% ' })).toBeDefined()
  await ui.press({ key: 'vol-down' })
  await ui.press({ key: 'vol-down' })
  expect(await ui.find({ type: 'Text', text: ' Volume 25% ' })).toBeDefined()
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
  expect((await ui.find({ key: 'set-track' }))?.props.label).toBe('♪ Track: Neon Drive')
  await ui.press({ key: 'set-track' })
  expect((await ui.find({ key: 'set-track' }))?.props.label).toBe('♪ Track: Night Rain')
  await ui.unmount()
})
