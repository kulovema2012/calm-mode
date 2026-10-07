import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import type { AwayRecap, CalmSettings, Checklist, ChecklistTask, TrackChoice } from '../types'

type Engine = EngineInterface

const PLAN_TOOL = 'mcp__calm-mode__plan_steps'
const PROGRESS_TOOL = 'mcp__calm-mode__report_progress'
const STORE_KEY = 'calmModeEnabled'
const NAME_LIMIT = 40
const METER_CELLS = 10
const COLLAPSE_AFTER_MS = 5000
const FRAME_MS = 250

// Tools that may run before a plan exists: they either load our tools,
// lay out the plan themselves, or ask the person something.
const ALWAYS_ALLOWED = new Set([
  'ToolSearch',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'AskUserQuestion',
  PLAN_TOOL,
  PROGRESS_TOOL,
])

const PLACEHOLDER_STEPS = ['Understand your request', 'Plan the steps']

const CODE_EXTENSIONS =
  'tsx?|jsx?|mjs|cjs|mts|cts|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|ps1|bat|json|ya?ml|toml|ini|md|mdx|html?|css|scss|sass|less|sql|lock|env|vue|svelte|xml|csv|txt|log'
const FILE_NAME = new RegExp(`[\\w.-]*\\.(?:${CODE_EXTENSIONS})\\b`, 'gi')

export const enabledAtom = atom({ plugin: 'calm-mode', key: 'calmModeEnabled' } as const, true)
export const checklistAtom = atom({ plugin: 'calm-mode', key: 'checklist' } as const, null)
export const tickAtom = atom({ plugin: 'calm-mode', key: 'tick' } as const, 0)

/**
 * Turns any step or job name into plain words: no code, paths or file names,
 * one space between words, a capital first letter and at most 40 characters.
 */
export function cleanName(raw: unknown): string {
  let text = typeof raw === 'string' ? raw : ''
  text = text.replace(/`[^`]*`/g, ' ').replace(/`/g, ' ')
  text = text.replace(/\S*[\\/]\S*/g, ' ')
  text = text.replace(FILE_NAME, ' ')
  text = text.replace(/\s+/g, ' ').trim()

  if (text.length > NAME_LIMIT) {
    const room = text.slice(0, NAME_LIMIT - 1)
    const lastSpace = room.lastIndexOf(' ')
    const cut = lastSpace > 0 ? room.slice(0, lastSpace) : room
    text = `${cut.replace(/[\s,.;:–-]+$/, '')}…`
  }

  if (text === '') {
    return 'Working on it'
  }

  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "45s", "1m 12s", "1h 3m". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const clampPercent = (value: unknown): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return Math.round(Math.min(100, Math.max(0, n)))
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

const makeTask = (id: string, name: string, status: ChecklistTask['status']): ChecklistTask => ({
  id,
  name,
  status,
  percent: status === 'done' ? 100 : 0,
  hasReported: status === 'done',
})

function newChecklist(jobId: number, startedAt: number, title: string): Checklist {
  return {
    jobId,
    title,
    phase: 'working',
    tasks: PLACEHOLDER_STEPS.map((name, i) =>
      makeTask(`placeholder-${i}`, name, i === 0 ? 'active' : 'upcoming'),
    ),
    hasPlan: false,
    needsYouReason: null,
    stuckReason: null,
    startedAt,
    finishedAt: null,
    isCollapsed: false,
  }
}

/** Lays out a fresh plan: the first step starts right away. */
function withPlan(list: Checklist, names: string[]): Checklist {
  const tasks = names.map((name, i) => makeTask(`step-${i}`, name, i === 0 ? 'active' : 'upcoming'))
  return { ...list, tasks, hasPlan: true }
}

/**
 * Applies a progress report: earlier steps are checked off, the reported
 * step becomes current, and at 100 the next step starts automatically.
 */
export function withProgress(list: Checklist, rawName: unknown, rawPercent: unknown): Checklist {
  const name = cleanName(rawName)
  const percent = clampPercent(rawPercent)
  let tasks = [...list.tasks]
  let index = tasks.findIndex(task => sameName(task.name, name))

  if (index === -1) {
    tasks.push(makeTask(`extra-${tasks.length}`, name, 'upcoming'))
    index = tasks.length - 1
  }

  tasks = tasks.map((task, i) => {
    if (i < index) {
      return { ...task, status: 'done', percent: 100, hasReported: true }
    }
    if (i === index) {
      return percent >= 100
        ? { ...task, status: 'done', percent: 100, hasReported: true }
        : { ...task, status: 'active', percent, hasReported: true }
    }
    return task.status === 'active' ? { ...task, status: 'upcoming' } : task
  })

  if (percent >= 100 && !tasks.some(task => task.status === 'active')) {
    const nextIndex = tasks.findIndex((task, i) => i > index && task.status === 'upcoming')
    const nextTask = tasks[nextIndex]
    if (nextTask !== undefined) {
      tasks[nextIndex] = { ...nextTask, status: 'active', percent: 0, hasReported: false }
    }
  }

  return { ...list, tasks, hasPlan: true }
}

const TODO_STATUS = { completed: 'done', in_progress: 'active', pending: 'upcoming' } as const

/** A to-do list (TodoWrite) becomes the checklist rows, keeping reported percents. */
function withTodos(
  list: Checklist,
  todos: ReadonlyArray<{ content: string; status: keyof typeof TODO_STATUS }>,
): Checklist {
  const tasks = todos.map((todo, i) => {
    const name = cleanName(todo.content)
    const status = TODO_STATUS[todo.status] ?? 'upcoming'
    const before = list.tasks.find(task => sameName(task.name, name))
    const task = makeTask(`todo-${i}`, name, status)
    return status === 'active' && before?.status === 'active'
      ? { ...task, percent: before.percent, hasReported: before.hasReported }
      : task
  })
  return { ...list, tasks, hasPlan: true }
}

/** One calm sentence for an API error that ended the turn. */
export function apiErrorSentence(kind: string | undefined, details = ''): string {
  if (/too long|context window|context length|prompt is too long/i.test(details)) {
    return 'type /compact and try again'
  }
  switch (kind) {
    case 'rate_limit':
    case 'billing_error':
      return 'you hit your usage limit, try again a little later'
    case 'overloaded':
    case 'server_error':
      return "Claude's servers are busy, try again in a minute"
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
    case 'cloud_credential_error':
    case 'account_on_hold':
    case 'verification_required':
      return 'type /login'
    case 'max_output_tokens':
      return 'type /compact and try again'
  }
  if (/network|connect|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed|socket|offline/i.test(details)) {
    return 'the internet connection dropped'
  }
  if (/rate.?limit|usage limit|429/i.test(details)) {
    return 'you hit your usage limit, try again a little later'
  }
  if (/overloaded|529|503/i.test(details)) {
    return "Claude's servers are busy, try again in a minute"
  }
  if (/auth|401|403|log ?in/i.test(details)) {
    return 'type /login'
  }
  return 'the internet connection dropped'
}

const USER_SAID_NO = /user (doesn't|does not) want|rejected|user denied|declined/i

// Timers and counters only; a reload resets them. Everything drawn lives in $.state.
const runtime: {
  frameTimer: Timer | null
  collapseTimer: Timer | null
  failuresInARow: number
  isTurnRunning: boolean
  lastApiError: { kind: string; details: string } | null
  music: { key: string; stop: () => void } | null
  shuffle: { jobId: number; track: string } | null
  awayTimer: Timer | null
  recapTicker: Timer | null
  lastAsked: string
  lastAnswer: string
} = {
  frameTimer: null,
  collapseTimer: null,
  failuresInARow: 0,
  isTurnRunning: false,
  lastApiError: null,
  music: null,
  shuffle: null,
  awayTimer: null,
  recapTicker: null,
  lastAsked: '',
  lastAnswer: '',
}

/** Runs the 250ms animation clock only while a job is working or waiting on the person. */
async function syncFrameTimer($: Engine) {
  const list = await read($, checklistAtom)
  const isLive = list !== null && (list.phase === 'working' || list.phase === 'needsYou')
  if (isLive && runtime.frameTimer === null) {
    runtime.frameTimer = $.clock.every(FRAME_MS, () => {
      void update($, tickAtom, n => (n ?? 0) + 1)
    })
  } else if (!isLive && runtime.frameTimer !== null) {
    runtime.frameTimer.cancel()
    runtime.frameTimer = null
  }
  await syncMusic($)
}

async function change($: Engine, fn: (list: Checklist) => Checklist) {
  await update($, checklistAtom, list => (list === null ? list : fn(list)))
  await syncFrameTimer($)
}

async function finish($: Engine, fn: (list: Checklist) => Checklist) {
  const finishedAt = await $.clock.now()
  await change($, list => ({ ...fn(list), finishedAt }))
}

async function setEnabled($: Engine, isEnabled: boolean) {
  await update($, enabledAtom, () => isEnabled)
  await $.store.set(STORE_KEY, isEnabled)
  await syncMusic($)
  $.ui.toast(
    isEnabled ? 'Calm Mode on: technical details are hidden' : 'Calm Mode off: showing everything again',
  )
}

/** Asks Haiku for a 2 to 6 word job name; ignored if a newer job has started. */
async function nameJob($: Engine, jobId: number, prompt: string) {
  const ask = {
    model: 'haiku',
    maxTokens: 30,
    timeoutMs: 15000,
    system:
      'Name the job in the request in 2 to 6 plain English words that start with a verb. ' +
      'No code, no file names, no quotes, no punctuation at the end. Reply with the name only.',
    prompt: prompt.slice(0, 2000),
  }
  let reply = await $.model.complete({ ...ask, effort: 'low' })
  if (!reply.isAnswered && reply.reason === 'api-error') {
    // Some small models refuse an effort setting; ask again without it.
    reply = await $.model.complete(ask)
  }
  if (!reply.isAnswered) {
    return
  }
  const words = cleanName((reply.text.split('\n')[0] ?? '').replace(/["'.]+/g, ''))
    .split(' ')
    .slice(0, 6)
    .join(' ')
  await change($, list => (list.jobId === jobId ? { ...list, title: words } : list))
}

// ── Settings ────────────────────────────────────────────────────────────────
// The /config rows (userConfig) are the source of truth. session.start mirrors
// them into $.state so every drawing redraws when one changes.

const DEFAULT_LABEL = 'Calm Mode'
const LABEL_LIMIT = 20

/** The built-in tracks (sounds/<id>.wav, made by tools/make_tracks.py), then shuffle. */
export const TRACKS = [
  { id: 'neon-drive', name: 'Neon Drive' },
  { id: 'night-rain', name: 'Night Rain' },
  { id: 'hacker-pulse', name: 'Hacker Pulse' },
  { id: 'chrome-ambient', name: 'Chrome Ambient' },
] as const satisfies ReadonlyArray<{ id: TrackChoice; name: string }>
const TRACK_CHOICES: readonly TrackChoice[] = [...TRACKS.map(track => track.id), 'shuffle']

/** The next choice after `current`, wrapping around: what the track button steps to. */
export function nextTrack(current: TrackChoice): TrackChoice {
  return TRACK_CHOICES[(TRACK_CHOICES.indexOf(current) + 1) % TRACK_CHOICES.length] ?? 'neon-drive'
}

export function trackName(choice: TrackChoice): string {
  return TRACKS.find(track => track.id === choice)?.name ?? 'Shuffle'
}

export const DEFAULT_SETTINGS: CalmSettings = {
  hideToolRows: true,
  jobNaming: true,
  buttonLabel: DEFAULT_LABEL,
  cyberpunk: false,
  music: true,
  musicFile: '',
  musicVolume: 35,
  track: 'neon-drive',
  awayRecap: true,
  awayMinutes: 5,
  cacheMeter: false,
}

export const settingsAtom = atom({ plugin: 'calm-mode', key: 'settings' } as const, DEFAULT_SETTINGS)
export const settingsOpenAtom = atom({ plugin: 'calm-mode', key: 'isSettingsOpen' } as const, false)

/** Reads the plugin's options, falling back to the defaults for anything missing or malformed. */
export function normalizeSettings(options: unknown): CalmSettings {
  const raw = (typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>
  const flag = (key: keyof CalmSettings, fallback: boolean) =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : fallback
  const label = typeof raw.buttonLabel === 'string' ? raw.buttonLabel.replace(/\s+/g, ' ').trim() : ''
  return {
    hideToolRows: flag('hideToolRows', DEFAULT_SETTINGS.hideToolRows),
    jobNaming: flag('jobNaming', DEFAULT_SETTINGS.jobNaming),
    buttonLabel: label === '' ? DEFAULT_LABEL : label.slice(0, LABEL_LIMIT),
    cyberpunk: flag('cyberpunk', DEFAULT_SETTINGS.cyberpunk),
    music: flag('music', DEFAULT_SETTINGS.music),
    musicVolume: clampVolume(raw.musicVolume),
    awayRecap: flag('awayRecap', DEFAULT_SETTINGS.awayRecap),
    awayMinutes:
      typeof raw.awayMinutes === 'number' && Number.isFinite(raw.awayMinutes)
        ? Math.round(Math.min(120, Math.max(1, raw.awayMinutes)))
        : DEFAULT_SETTINGS.awayMinutes,
    cacheMeter: flag('cacheMeter', DEFAULT_SETTINGS.cacheMeter),
    track: TRACK_CHOICES.includes(raw.track as TrackChoice) ? (raw.track as TrackChoice) : 'neon-drive',
    musicFile: typeof raw.musicFile === 'string' ? raw.musicFile.trim().replace(/^["']+|["']+$/g, '') : '',
  }
}

/** Volume as a whole percent from 0 to 100; anything else falls back to the default. */
export function clampVolume(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(100, Math.max(0, value)))
    : DEFAULT_SETTINGS.musicVolume
}

/** The on/off button's text: "● Calm Mode: ON", or "⚡ CALM MODE//ON" in cyberpunk. */
export function toggleLabel(settings: CalmSettings, isEnabled: boolean): string {
  return settings.cyberpunk
    ? `⚡ ${settings.buttonLabel.toUpperCase()}//${isEnabled ? 'ON' : 'OFF'}`
    : `${isEnabled ? '●' : '○'} ${settings.buttonLabel}: ${isEnabled ? 'ON' : 'OFF'}`
}

async function isHidingToolRows($: Engine) {
  return (await read($, enabledAtom)) && (await read($, settingsAtom)).hideToolRows
}

/**
 * Changes one setting through /config, so the menu and the band stay in step.
 * The module reloads with the new options; the state mirror is written first
 * so the band redraws at once either way.
 */
async function setOption<K extends keyof CalmSettings>($: Engine, field: K, value: CalmSettings[K]) {
  const next = normalizeSettings({ ...(await read($, settingsAtom)), [field]: value })
  await update($, settingsAtom, () => next)
  await syncMusic($)
  const rows = await $.config.list().catch(() => [])
  const row = rows.find(r => r.key === `calm-mode.${field}`) ?? rows.find(r => r.key.startsWith('calm-mode') && r.key.endsWith(`.${field}`))
  if (row === undefined) {
    $.ui.toast('Calm Mode: setting changed for this session only')
    return
  }
  const result = await $.config.set({ key: row.key, value: next[field] } as never).catch(() => ({ deny: 'failed' }))
  if (result.deny !== undefined) {
    $.ui.toast('Calm Mode: setting changed for this session only')
  }
}

// ── Music ───────────────────────────────────────────────────────────────────
// Cyberpunk background music while Claude works. Claude Code's own player
// ($.audio.play) only sounds on macOS, so Windows uses a hidden PowerShell
// MediaPlayer and Linux uses ffplay. The child dies with the module, and the
// PowerShell script also exits on its own if its parent process goes away.

const VOLUME_STEP = 10

/** PowerShell's -EncodedCommand takes UTF-16LE text as base64. */
function utf16leBase64(text: string): string {
  let bytes = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes += String.fromCharCode(code & 0xff, code >> 8)
  }
  return btoa(bytes)
}

/** A looping, hidden player; the path is a single-quoted literal, so it cannot inject code. */
export function windowsMusicScript(path: string, volume: number): string {
  const quoted = `'${path.replace(/'/g, "''")}'`
  return [
    'Add-Type -AssemblyName PresentationCore',
    '$parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId',
    '$player = New-Object System.Windows.Media.MediaPlayer',
    `$player.Open([Uri]${quoted})`,
    `$player.Volume = ${(clampVolume(volume) / 100).toFixed(2)}`,
    '$player.Play()',
    'while ($true) {',
    '  Start-Sleep -Milliseconds 500',
    '  if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { break }',
    '  if ($player.NaturalDuration.HasTimeSpan -and $player.Position -ge $player.NaturalDuration.TimeSpan) {',
    '    $player.Position = [TimeSpan]::Zero',
    '    $player.Play()',
    '  }',
    '}',
    '$player.Stop()',
    '$player.Close()',
  ].join('\n')
}

/** The command that loops `file` (empty: the built-in track) here, or null where $.audio.play does it. */
export function musicCommand(root: string, file: string, volume: number, asset = 'sounds/neon-drive.wav'): string[] | null {
  const level = clampVolume(volume)
  const isWindows = /^[A-Za-z]:[\\/]/.test(root)
  const isMac = root.startsWith('/Users/')
  const sep = isWindows ? '\\' : '/'
  const path = file === '' ? `${root}${sep}${asset.split('/').join(sep)}` : file
  if (isWindows) {
    return [
      'powershell',
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-EncodedCommand',
      utf16leBase64(windowsMusicScript(path, level)),
    ]
  }
  if (isMac) {
    return file === ''
      ? null
      : ['/bin/sh', '-c', 'while :; do afplay -v "$2" "$1" || exit; done', 'calm-mode', path, (level / 100).toFixed(2)]
  }
  return ['ffplay', '-nodisp', '-loglevel', 'quiet', '-loop', '0', '-volume', String(level), path]
}

/** Starts the loop and hands back the way to stop it. */
function startMusic($: Engine, file: string, volume: number, asset: string): () => void {
  const argv = musicCommand($.plugin.root, file, volume, asset)
  if (argv === null) {
    const controller = new AbortController()
    void $.audio
      .play({ asset }, { shouldLoop: true, gain: clampVolume(volume) / 100, signal: controller.signal })
      .catch(() => undefined)
    return () => controller.abort()
  }
  try {
    const child = $.process.spawn({ argv })
    void (async () => {
      try {
        for await (const _piece of child) {
          // The player writes nothing worth showing; draining keeps it alive.
        }
      } catch {
        // No player on this machine: stay quiet.
      }
    })()
    return () => {
      void Promise.resolve(child.return(undefined as never)).catch(() => undefined)
    }
  } catch {
    return () => undefined
  }
}

/** The track to play: the chosen one, or under shuffle one random track per job. */
function pickTrack(choice: TrackChoice, jobId: number): string {
  if (choice !== 'shuffle') {
    return choice
  }
  if (runtime.shuffle?.jobId !== jobId) {
    const pick = TRACKS[Math.floor(Math.random() * TRACKS.length)] ?? TRACKS[0]
    runtime.shuffle = { jobId, track: pick.id }
  }
  return runtime.shuffle.track
}

/** Plays while Claude works with Calm Mode, Cyberpunk and Music all on; stops otherwise. */
async function syncMusic($: Engine) {
  const isEnabled = await read($, enabledAtom)
  const settings = await read($, settingsAtom)
  const list = await read($, checklistAtom)
  const isWanted = isEnabled && settings.cyberpunk && settings.music && list?.phase === 'working'
  const asset = `sounds/${pickTrack(settings.track, list?.jobId ?? 0)}.wav`
  // The key holds the track, the file and the volume, so changing any restarts the player.
  const wanted =
    isWanted && settings.musicVolume > 0 ? `${settings.musicVolume}|${asset}|${settings.musicFile}` : null
  if ((runtime.music?.key ?? null) === wanted) {
    return
  }
  runtime.music?.stop()
  runtime.music =
    wanted === null ? null : { key: wanted, stop: startMusic($, settings.musicFile, settings.musicVolume, asset) }
}

// ── Away recap ──────────────────────────────────────────────────────────────
// When a job ends and the person stays quiet for a while, the band swaps the
// checklist for a "Welcome back" card: the job, how it ended, a one or two
// sentence summary, and what they last asked. Typing or "Got it" clears it.

export const recapAtom = atom({ plugin: 'calm-mode', key: 'recap' } as const, null)

/** The person's prompt, first line only, at most 70 characters. */
export function shortQuote(text: string): string {
  const line = (text.split('\n')[0] ?? '').replace(/\s+/g, ' ').trim()
  return line.length > 70 ? `${line.slice(0, 69).trimEnd()}…` : line
}

/** A free stand-in summary: the start of Claude's answer without code or markdown. */
export function fallbackSummary(answer: string): string {
  const plain = answer
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[#>*_|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain === '') {
    return 'Claude finished without a written reply.'
  }
  return plain.length > 160 ? `${plain.slice(0, 159).trimEnd()}…` : plain
}

async function summarize($: Engine, answer: string): Promise<string | undefined> {
  if (answer.trim() === '') {
    return undefined
  }
  const reply = await $.model.complete({
    model: 'haiku',
    maxTokens: 120,
    timeoutMs: 20000,
    system:
      'Summarize what the assistant just did or said in one or two short, plain sentences for a non-technical person. ' +
      'Mention anything that needs their action. No code, no file paths, no markdown.',
    prompt: answer.slice(0, 4000),
  })
  return reply.isAnswered ? reply.text.replace(/\s+/g, ' ').trim() : undefined
}

/** Fires once the person has been quiet for the set minutes after a job. */
async function showRecap($: Engine) {
  const settings = await read($, settingsAtom)
  const list = await read($, checklistAtom)
  if (!settings.awayRecap || list === null || runtime.isTurnRunning) {
    return
  }
  const now = await $.clock.now()
  const recap: AwayRecap = {
    jobId: list.jobId,
    title: list.title,
    phase: list.phase,
    tookMs: (list.finishedAt ?? now) - list.startedAt,
    stepsDone: list.tasks.filter(task => task.status === 'done').length,
    stepsTotal: list.tasks.length,
    summary: fallbackSummary(runtime.lastAnswer),
    lastAsked: runtime.lastAsked,
    awaySince: list.finishedAt ?? now - settings.awayMinutes * 60_000,
    isShowing: true,
  }
  await update($, recapAtom, () => recap)
  // Keep "away 18m" current without animating: one redraw a minute.
  runtime.recapTicker?.cancel()
  runtime.recapTicker = $.clock.every(60_000, () => {
    void update($, tickAtom, n => (n ?? 0) + 1)
  })
  const summary = await summarize($, runtime.lastAnswer).catch(() => undefined)
  if (summary !== undefined && summary !== '') {
    await update($, recapAtom, current =>
      current !== null && current.jobId === recap.jobId ? { ...current, summary } : current,
    )
  }
}

async function dismissRecap($: Engine) {
  runtime.awayTimer?.cancel()
  runtime.awayTimer = null
  runtime.recapTicker?.cancel()
  runtime.recapTicker = null
  if ((await read($, recapAtom)) !== null) {
    await update($, recapAtom, () => null)
  }
}

// ── Cache meter (status line) ───────────────────────────────────────────────
// The meter lives in Claude Code's status line, at its right end, drawn by
// statusline/cache-statusline.mjs. statusline/install.mjs wraps whatever status
// line the person has; this button and /calm statusline only run it, because a
// plugin cannot set the status line itself.

function installerPath($: Engine): string {
  const sep = /^[A-Za-z]:[\\/]/.test($.plugin.root) ? '\\' : '/'
  return [$.plugin.root, 'statusline', 'install.mjs'].join(sep)
}

/** Whether the status line currently runs the cache meter; undefined when that cannot be told. */
async function isCacheMeterInstalled($: Engine): Promise<boolean | undefined> {
  const ran = await $.process
    .run(['node', installerPath($), 'status'], { timeoutMs: 10000 })
    .catch(() => undefined)
  return ran === undefined || ran.exitCode !== 0 ? undefined : ran.stdout.trim() === 'installed'
}

/** Runs the status-line installer and records the choice; says what happened. */
async function setCacheMeter($: Engine, isOn: boolean) {
  const ran = await $.process
    .run(['node', installerPath($), isOn ? 'install' : 'uninstall'], { timeoutMs: 20000 })
    .catch(() => undefined)
  if (ran === undefined || ran.exitCode !== 0) {
    $.ui.toast('Calm Mode: could not change the status line (is Node.js installed?)')
    return 'Could not change the status line.'
  }
  await setOption($, 'cacheMeter', isOn)
  const said = ran.stdout.trim()
  $.ui.toast(said === '' ? 'Calm Mode: status line updated' : said)
  return said
}

// ── Themes ──────────────────────────────────────────────────────────────────

type Theme = {
  icons: { done: string; active: string; paused: string; upcoming: string }
  fill: string
  empty: string
  gear: string
  sep: string
  headerMark: string
  labels: { done: string; next: string; later: string; working: string }
  title: string | undefined
  accent: string
  done: string
  warn: string
  alert: string
  shout: (text: string) => string
  duration: (ms: number) => string
}

const CLASSIC: Theme = {
  icons: { done: '✓ ', active: '▶ ', paused: '‖ ', upcoming: '○ ' },
  fill: '█',
  empty: '░',
  gear: '⚙',
  sep: ' · ',
  headerMark: '',
  labels: { done: 'Done', next: 'Next', later: 'Up next', working: 'Working' },
  title: undefined,
  accent: 'claude',
  done: 'success',
  warn: 'warning',
  alert: 'warning',
  shout: text => text,
  duration: formatDuration,
}

/** Neon pink titles, cyan meters, yellow alerts. */
const CYBERPUNK: Theme = {
  icons: { done: '◆ ', active: '▸ ', paused: '‖ ', upcoming: '◇ ' },
  fill: '▰',
  empty: '▱',
  gear: '⚙',
  sep: ' // ',
  headerMark: '◢◤ ',
  labels: { done: 'DONE', next: 'NEXT', later: 'QUEUED', working: 'WORKING' },
  title: '#ff2bd6',
  accent: '#00f0ff',
  done: '#00f0ff',
  warn: '#fcee0a',
  alert: '#ff2bd6',
  shout: text => text.toUpperCase(),
  duration: ms => {
    const seconds = Math.max(0, Math.floor(ms / 1000))
    const pad = (n: number) => String(n).padStart(2, '0')
    return seconds >= 3600
      ? `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
      : `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
  },
}

export function registerCalmMode(on: On, options?: unknown): void {
  const configured = normalizeSettings(options)


  on('session.start', async ($, e, next) => {
    const stored = await $.store.get(STORE_KEY)
    await update($, enabledAtom, () => (typeof stored === 'boolean' ? stored : true))
    await update($, settingsAtom, () => configured)
    // Versions before 0.5.1 pinned the meter in the plugin's own status row; take it down.
    $.ui.status(undefined)
    // The button shows what the status line really holds; reading it changes nothing.
    void isCacheMeterInstalled($).then(isInstalled => {
      if (isInstalled !== undefined && isInstalled !== configured.cacheMeter) {
        void update($, settingsAtom, current => ({ ...current, cacheMeter: isInstalled }))
      }
    })

    await $.tool.register({
      name: 'plan_steps',
      description:
        'Lay out every step of the job up front for the Calm Mode checklist: 2 to 8 short, plain-English names in order, each under 40 characters and starting with a verb. The first step starts right away. Call this first for every request.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
        },
        required: ['steps'],
      },
    })
    await $.tool.register({
      name: 'report_progress',
      description:
        'Report progress on the current step of the Calm Mode checklist. Use the step name exactly as planned; percent is 0 to 100. Report 100 the moment a step finishes and the next step starts automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string' },
          percent: { type: 'number', minimum: 0, maximum: 100 },
        },
        required: ['task', 'percent'],
      },
    })
    await $.command.register({
      name: 'calm',
      description: 'Turn Calm Mode on or off (no argument flips it); statusline on|off adds the cache meter',
      argumentHint: '[on|off] | statusline on|off',
      immediate: true,
    })

    return next(e)
  })

  on('command.run', { command: 'calm' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const statusLine = /^statusline\s+(on|off)$/.exec(arg)
    if (statusLine !== null) {
      return { text: await setCacheMeter($, statusLine[1] === 'on') }
    }
    const isEnabled = arg === 'on' ? true : arg === 'off' ? false : !(await read($, enabledAtom))
    await setEnabled($, isEnabled)
    return { text: isEnabled ? 'Calm Mode is on.' : 'Calm Mode is off.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, enabledAtom))) {
      return composed
    }
    const section = {
      id: 'calm-mode:plain-steps',
      scope: 'session',
      text: [
        '# Calm Mode',
        'The person sees a simple checklist instead of tool calls. Keep it accurate:',
        `- For every request, even a quick question, call \`${PLAN_TOOL}\` first with 2 to 8 steps. If it is deferred, load it with ToolSearch first.`,
        `- Then call \`${PROGRESS_TOOL}\` as real progress happens, and with percent 100 the moment a step finishes.`,
        '- Write every step name in plain English a non-technical person understands. Keep it under 40 characters and start it with a verb, like "Build the pricing section".',
        '- Never put file paths, file names, commands, code or tool names in a step name.',
        '- If TodoWrite or TaskCreate is available, you may use your to-do list as the plan instead.',
      ].join('\n'),
    } as const
    return { ...composed, sections: [...composed.sections, section] }
  })

  on('turn.start', async ($, e, next) => {
    const text = e.text.trim()
    const current = await read($, checklistAtom)
    const wasRunning = runtime.isTurnRunning
    runtime.isTurnRunning = true
    if (text !== '' && !text.startsWith('/')) {
      runtime.lastAsked = shortQuote(text)
      await dismissRecap($)
    }
    if (text !== '' && !text.startsWith('/') && !wasRunning) {
      const jobId = (current?.jobId ?? 0) + 1
      const startedAt = await $.clock.now()
      runtime.collapseTimer?.cancel()
      runtime.collapseTimer = null
      runtime.failuresInARow = 0
      runtime.lastApiError = null
      await update($, checklistAtom, () => newChecklist(jobId, startedAt, cleanName(text.split('\n')[0])))
      await syncFrameTimer($)
      // Name the job in the background; a newer job makes the answer moot.
      if ((await read($, settingsAtom)).jobNaming) {
        $.clock.after(0, () => {
          void nameJob($, jobId, text).catch(() => undefined)
        })
      }
    }
    return next(e)
  })

  on('tool.call', { tool: PLAN_TOOL }, async ($, e) => {
    const raw = (e as unknown as { steps?: unknown }).steps
    const names = (Array.isArray(raw) ? raw : []).slice(0, 8).map(cleanName)
    if (names.length === 0) {
      return { deny: 'Give plan_steps 2 to 8 short step names.' }
    }
    const list = await read($, checklistAtom)
    if (list === null) {
      const startedAt = await $.clock.now()
      await update($, checklistAtom, () => withPlan(newChecklist(1, startedAt, names[0] ?? 'Working on it'), names))
    } else {
      await change($, current => withPlan(current, names))
    }
    await syncFrameTimer($)
    return {
      result: `Planned ${names.length} ${names.length === 1 ? 'step' : 'steps'}. The first one has started.`,
    }
  })

  on('tool.call', { tool: PROGRESS_TOOL }, async ($, e) => {
    const args = e as unknown as { task?: unknown; percent?: unknown }
    const percent = clampPercent(args.percent)
    const list = await read($, checklistAtom)
    if (list === null) {
      const startedAt = await $.clock.now()
      await update($, checklistAtom, () =>
        withProgress({ ...newChecklist(1, startedAt, cleanName(args.task)), tasks: [] }, args.task, percent),
      )
    } else {
      await change($, current => withProgress(current, args.task, percent))
    }
    return { result: `Progress noted: ${percent}%.` }
  })

  // The gate, and everything Calm Mode learns from tool calls.
  on('tool.call', async ($, e, next) => {
    const isMainAgent = e.agentId === undefined
    const isEnabled = await read($, enabledAtom)

    if (isMainAgent && isEnabled && !ALWAYS_ALLOWED.has(String(e.tool))) {
      const list = await read($, checklistAtom)
      if (list === null || !list.hasPlan) {
        return {
          deny: `Calm Mode: call ${PLAN_TOOL} first to lay out the steps (load it with ToolSearch if it is deferred), then try again.`,
        }
      }
    }

    if (!isMainAgent) {
      return next(e)
    }

    if (e.tool === 'AskUserQuestion') {
      await change($, list => ({ ...list, phase: 'needsYou', needsYouReason: 'Claude has a question for you' }))
      const ran = await next(e)
      await change($, list =>
        list.phase === 'needsYou' ? { ...list, phase: 'working', needsYouReason: null } : list,
      )
      return ran
    }

    // A new tool running means the person already answered whatever was asked.
    await change($, list =>
      list.phase === 'needsYou' ? { ...list, phase: 'working', needsYouReason: null } : list,
    )

    const ran = await next(e)
    const hasFailed = ran.deny !== undefined || ran.isError === true

    if (hasFailed) {
      const said = `${ran.deny ?? ''} ${ran.text ?? ''}`
      if (USER_SAID_NO.test(said)) {
        runtime.failuresInARow = 0
        await change($, list => ({
          ...list,
          phase: 'stuck',
          needsYouReason: null,
          stuckReason: 'you said no to a step, so Claude paused',
        }))
      } else {
        runtime.failuresInARow += 1
        if (runtime.failuresInARow >= 3) {
          await change($, list => ({
            ...list,
            phase: 'stuck',
            stuckReason: 'a step keeps failing, Claude is trying another way',
          }))
        }
      }
      return ran
    }

    runtime.failuresInARow = 0
    await change($, list => {
      const cleared =
        list.phase === 'stuck' || list.phase === 'needsYou'
          ? { ...list, phase: 'working' as const, stuckReason: null, needsYouReason: null }
          : list
      if (e.tool === 'TodoWrite') {
        return withTodos(cleared, e.todos)
      }
      if (e.tool === 'TaskCreate') {
        const created = (ran.result as { task?: { id?: string } } | undefined)?.task
        const id = created?.id ?? `task-${cleared.tasks.length}`
        const base = cleared.hasPlan ? cleared.tasks : []
        const hasActive = base.some(task => task.status === 'active')
        return {
          ...cleared,
          hasPlan: true,
          tasks: [...base, makeTask(id, cleanName(e.subject), hasActive ? 'upcoming' : 'active')],
        }
      }
      if (e.tool === 'TaskUpdate') {
        if (e.status === 'deleted') {
          return { ...cleared, tasks: cleared.tasks.filter(task => task.id !== e.taskId) }
        }
        return {
          ...cleared,
          tasks: cleared.tasks.map(task => {
            if (task.id !== e.taskId) {
              return task
            }
            const name = e.subject === undefined ? task.name : cleanName(e.subject)
            if (e.status === 'completed') {
              return { ...task, name, status: 'done', percent: 100, hasReported: true }
            }
            if (e.status === 'in_progress') {
              return { ...task, name, status: 'active' }
            }
            if (e.status === 'pending') {
              return { ...task, name, status: 'upcoming' }
            }
            return { ...task, name }
          }),
        }
      }
      return cleared
    })

    return ran
  }).catch(($, e, next) => next(e))

  // Permission prompts and questions while Claude works.
  on('classic.Notification', async ($, e, next) => {
    const isPermission = /permission/i.test(`${e.notification_type} ${e.message}`)
    const isQuestion = /elicitation|question/i.test(e.notification_type)
    if (isPermission || isQuestion) {
      await change($, list =>
        list.phase === 'working' || list.phase === 'stuck'
          ? {
              ...list,
              phase: 'needsYou',
              needsYouReason: isPermission
                ? 'Claude needs your OK to continue'
                : 'Claude has a question for you',
            }
          : list,
      )
    }
    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    runtime.lastApiError = { kind: e.error, details: e.error_details ?? '' }
    await change($, list =>
      list.phase === 'stuck' && list.finishedAt !== null
        ? { ...list, stuckReason: apiErrorSentence(e.error, e.error_details ?? '') }
        : list,
    )
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }
    runtime.isTurnRunning = false
    runtime.lastAnswer = e.answer
    const settings = await read($, settingsAtom)
    runtime.awayTimer?.cancel()
    runtime.awayTimer = settings.awayRecap
      ? $.clock.after(settings.awayMinutes * 60_000, () => {
          void showRecap($).catch(() => undefined)
        })
      : null
    const list = await read($, checklistAtom)
    if (list === null || list.finishedAt !== null) {
      return next(e)
    }

    if (e.reason === 'error') {
      const sentence = apiErrorSentence(runtime.lastApiError?.kind, runtime.lastApiError?.details ?? '')
      await finish($, current => ({ ...current, phase: 'stuck', needsYouReason: null, stuckReason: sentence }))
    } else if (e.reason === 'refusal') {
      await finish($, current => ({
        ...current,
        phase: 'stuck',
        needsYouReason: null,
        stuckReason: "Claude couldn't help with that request",
      }))
    } else if (e.reason === 'aborted' || e.isAborted) {
      await finish($, current => ({ ...current, phase: 'stopped', needsYouReason: null }))
    } else if (list.hasPlan && list.tasks.some(task => task.status !== 'done')) {
      await change($, current => ({
        ...current,
        phase: 'needsYou',
        stuckReason: null,
        needsYouReason: 'Claude is waiting for your reply',
      }))
    } else {
      const jobId = list.jobId
      await finish($, current => ({
        ...current,
        phase: 'done',
        stuckReason: null,
        needsYouReason: null,
        tasks: current.tasks.map(task => ({ ...task, status: 'done', percent: 100, hasReported: true })),
      }))
      runtime.collapseTimer?.cancel()
      runtime.collapseTimer = $.clock.after(COLLAPSE_AFTER_MS, () => {
        void update($, checklistAtom, current =>
          current !== null && current.jobId === jobId && current.phase === 'done'
            ? { ...current, isCollapsed: true }
            : current,
        )
      })
    }

    // A job that ends while waiting on the person keeps its clock still.
    if (runtime.frameTimer !== null) {
      runtime.frameTimer.cancel()
      runtime.frameTimer = null
    }
    return next(e)
  })

  // Hide the technical rows while Calm Mode is on and the setting asks for it.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await isHidingToolRows($))) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await isHidingToolRows($))) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!(await isHidingToolRows($))) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (!(await isHidingToolRows($))) {
      return next(e)
    }
    return next({ ...e, props: { ...e.props, hint: '' } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const isEnabled = await read($, enabledAtom)
    const settings = await read($, settingsAtom)
    const isSettingsOpen = await read($, settingsOpenAtom)
    const recap = isEnabled ? await read($, recapAtom) : null
    const theme = settings.cyberpunk ? CYBERPUNK : CLASSIC
    const list = isEnabled ? await read($, checklistAtom) : null
    const tick = list !== null && (list.phase === 'working' || list.phase === 'needsYou') ? await read($, tickAtom) : 0
    const now = await $.clock.now()
    const columns = Math.max(20, e.props.bodyColumns)

    const label = toggleLabel(settings, isEnabled)
    const buttons = (
      <Box flexDirection="row">
        <Button
          key="calm-settings"
          label={theme.gear}
          plain
          dimColor={!isSettingsOpen}
          onPress={() => update($, settingsOpenAtom, isOpen => !isOpen)}
        />
        <Text> </Text>
        <Button
          key="calm-toggle"
          label={label}
          variant={settings.cyberpunk ? 'primary' : undefined}
          dimColor={!isEnabled}
          onPress={() => setEnabled($, !isEnabled)}
        />
      </Box>
    )
    const buttonsWidth = theme.gear.length + 1 + label.length + 4
    const headerRoom = Math.max(4, columns - buttonsWidth - 1)

    const settingsRow = isSettingsOpen ? (
      <Box key="settings" flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap">
          <Button
            key="set-hide"
            label={`Hide tool rows: ${settings.hideToolRows ? 'ON' : 'OFF'}`}
            dimColor={!settings.hideToolRows}
            onPress={() => setOption($, 'hideToolRows', !settings.hideToolRows)}
          />
          <Text> </Text>
          <Button
            key="set-naming"
            label={`Job naming: ${settings.jobNaming ? 'ON' : 'OFF'}`}
            dimColor={!settings.jobNaming}
            onPress={() => setOption($, 'jobNaming', !settings.jobNaming)}
          />
          <Text> </Text>
          <Button
            key="set-cyber"
            label={`Cyberpunk: ${settings.cyberpunk ? 'ON' : 'OFF'}`}
            dimColor={!settings.cyberpunk}
            onPress={() => setOption($, 'cyberpunk', !settings.cyberpunk)}
          />
          <Text> </Text>
          <Button
            key="set-music"
            label={`Music: ${settings.music ? 'ON' : 'OFF'}${settings.cyberpunk ? '' : ' (Cyberpunk only)'}`}
            dimColor={!settings.music || !settings.cyberpunk}
            onPress={() => setOption($, 'music', !settings.music)}
          />
          <Text> </Text>
          <Button
            key="vol-down"
            label="−"
            onPress={() => setOption($, 'musicVolume', clampVolume(settings.musicVolume - VOLUME_STEP))}
          />
          <Text>{` Volume ${settings.musicVolume}% `}</Text>
          <Button
            key="vol-up"
            label="+"
            onPress={() => setOption($, 'musicVolume', clampVolume(settings.musicVolume + VOLUME_STEP))}
          />
          <Text> </Text>
          <Button
            key="set-track"
            label={`♪ Track: ${trackName(settings.track)}`}
            dimColor={settings.musicFile !== ''}
            onPress={() => setOption($, 'track', nextTrack(settings.track))}
          />
          <Text> </Text>
          <Button
            key="set-away"
            label={`Away recap: ${settings.awayRecap ? 'ON' : 'OFF'}`}
            dimColor={!settings.awayRecap}
            onPress={() => setOption($, 'awayRecap', !settings.awayRecap)}
          />
          <Text> </Text>
          <Button
            key="set-cache"
            label={`Cache in status line: ${settings.cacheMeter ? 'ON' : 'OFF'}`}
            dimColor={!settings.cacheMeter}
            onPress={() => setCacheMeter($, !settings.cacheMeter)}
          />
        </Box>
        {Input === undefined ? null : (
          <Input
            key="set-label"
            label="Button label: "
            placeholder={DEFAULT_LABEL}
            value={settings.buttonLabel}
            submitLabel="save"
            onSubmit={value => setOption($, 'buttonLabel', value)}
          />
        )}
        {Input === undefined ? null : (
          <Input
            key="set-music-file"
            label="Music file: "
            placeholder="built-in synth loop"
            value={settings.musicFile}
            submitLabel="save"
            onSubmit={value => setOption($, 'musicFile', value)}
          />
        )}
      </Box>
    ) : null

    if (recap !== null && recap.isShowing) {
      const awayFor = theme.duration(now - recap.awaySince)
      const recapTick = await read($, tickAtom)
      const icon =
        recap.phase === 'done' ? theme.icons.done : recap.phase === 'needsYou' ? theme.icons.paused : '■ '
      const outcome =
        recap.phase === 'done'
          ? `took ${theme.duration(recap.tookMs)}`
          : recap.phase === 'needsYou'
            ? 'waiting for your reply'
            : recap.phase === 'stuck'
              ? 'stuck'
              : 'stopped'
      return (
        <Box flexDirection="column" width={columns} key={`recap-${recapTick}`}>
          <Box flexDirection="row" justifyContent="space-between" width={columns}>
            <Box width={headerRoom}>
              <Text wrap="truncate" bold color={theme.title ?? theme.accent}>
                {`↩ ${theme.shout('Welcome back')}${theme.sep}away ${awayFor}`}
              </Text>
            </Box>
            {buttons}
          </Box>
          <Text wrap="truncate" color={recap.phase === 'done' ? theme.done : theme.warn}>
            {`${icon}${recap.title}${theme.sep}${outcome}${theme.sep}${recap.stepsDone}/${recap.stepsTotal} steps`}
          </Text>
          <Text wrap="wrap">{`Claude said: ${recap.summary}`}</Text>
          {recap.lastAsked === '' ? null : <Text dimColor wrap="truncate">{`Last you asked: "${recap.lastAsked}"`}</Text>}
          <Box flexDirection="row" justifyContent="flex-end" width={columns}>
            <Button key="recap-ok" label="Got it" variant="primary" onPress={() => dismissRecap($)} />
          </Box>
          {settingsRow}
        </Box>
      )
    }

    if (list === null) {
      return (
        <Box flexDirection="column" width={columns}>
          <Box flexDirection="row" justifyContent="flex-end" width={columns}>
            {buttons}
          </Box>
          {settingsRow}
        </Box>
      )
    }

    const elapsed = theme.duration((list.finishedAt ?? now) - list.startedAt)
    const title = theme.shout(list.title)
    const sep = theme.sep
    const header = (() => {
      switch (list.phase) {
        case 'needsYou':
          return (
            <Text wrap="truncate">
              <Text inverse bold color={theme.warn}>
                {` ${theme.shout('Needs you')} `}
              </Text>
              <Text color={theme.warn}>{` ${list.needsYouReason ?? 'Claude needs your OK to continue'}`}</Text>
            </Text>
          )
        case 'stuck':
          return (
            <Text wrap="truncate" color={theme.alert}>
              {`⚠ ${theme.shout('Stuck')}: ${list.stuckReason ?? 'something went wrong'}`}
            </Text>
          )
        case 'stopped':
          return (
            <Text wrap="truncate" color={theme.title}>
              {`■ ${theme.shout('Stopped')}${sep}${title}${sep}you pressed Esc`}
            </Text>
          )
        case 'done':
          return (
            <Text wrap="truncate" color={theme.done}>
              {`${theme.icons.done}${theme.shout('All done')}${sep}${title}${sep}took ${elapsed}`}
            </Text>
          )
        default:
          return (
            <Text wrap="truncate">
              <Text bold color={theme.title}>{`${theme.headerMark}${title}`}</Text>
              <Text dimColor={!settings.cyberpunk} color={settings.cyberpunk ? theme.accent : undefined}>
                {`${sep}${elapsed}`}
              </Text>
            </Text>
          )
      }
    })()

    const headerRow = (
      <Box flexDirection="row" justifyContent="space-between" width={columns}>
        <Box width={headerRoom}>{header}</Box>
        {buttons}
      </Box>
    )

    if (list.isCollapsed) {
      return (
        <Box flexDirection="column" width={columns}>
          {headerRow}
          {settingsRow}
        </Box>
      )
    }

    // icon(2) + name + gap(1) + meter(10) + label(9)
    const nameWidth = Math.max(6, Math.min(NAME_LIMIT, columns - 2 - 1 - METER_CELLS - 9))
    const fit = (name: string) =>
      name.length > nameWidth ? `${name.slice(0, nameWidth - 1)}…` : name.padEnd(nameWidth)

    const firstUpcoming = list.tasks.findIndex(task => task.status === 'upcoming')

    const rows = list.tasks.map((task, i) => {
      if (task.status === 'done') {
        return (
          <Box key={`row-${task.id}`} flexDirection="row">
            <Text color={theme.done}>{theme.icons.done}</Text>
            <Text dimColor>{`${fit(task.name)} `}</Text>
            <Text color={theme.done}>{theme.fill.repeat(METER_CELLS)}</Text>
            <Text dimColor>{`  ${theme.labels.done}`}</Text>
          </Box>
        )
      }
      if (task.status === 'active') {
        const isPaused = list.phase === 'needsYou'
        const meter = task.hasReported
          ? theme.fill.repeat(Math.round(task.percent / 10)).padEnd(METER_CELLS, theme.empty)
          : Array.from({ length: METER_CELLS }, (_, cell) =>
              (cell - (tick % METER_CELLS) + METER_CELLS) % METER_CELLS < 3 ? theme.fill : theme.empty,
            ).join('')
        return (
          <Box key={`row-${task.id}`} flexDirection="row">
            <Text color={theme.accent}>{isPaused ? theme.icons.paused : theme.icons.active}</Text>
            <Text bold color={settings.cyberpunk ? theme.title : undefined}>{`${fit(task.name)} `}</Text>
            <Text color={theme.accent}>{meter}</Text>
            <Text color={settings.cyberpunk ? theme.accent : undefined}>
              {task.hasReported ? `  ${task.percent}%` : `  ${theme.labels.working}`}
            </Text>
          </Box>
        )
      }
      return (
        <Box key={`row-${task.id}`} flexDirection="row">
          <Text dimColor>{theme.icons.upcoming}</Text>
          <Text dimColor>{`${fit(task.name)} `}</Text>
          <Text dimColor>{theme.empty.repeat(METER_CELLS)}</Text>
          <Text dimColor>{`  ${i === firstUpcoming ? theme.labels.next : theme.labels.later}`}</Text>
        </Box>
      )
    })

    return (
      <Box flexDirection="column" width={columns}>
        {headerRow}
        {rows}
        {settingsRow}
      </Box>
    )
  })
}
