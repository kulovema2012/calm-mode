import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import type { KeepWarm, LastJob, Recap, RecapPhase, RecapSettings, RecapTab } from '../types'

// Calm Recap: Calm Mode's Welcome back card and cache meter on their own, without the checklist. When Claude has
// answered and you stay quiet for a while (or you resume the session later), the band above the prompt shows what
// Claude did and what you last asked; the status line shows the prompt cache's hit rate and time left.

type Engine = EngineInterface

const STORE_KEY = 'calmRecapEnabled'
const DEFAULT_LABEL = 'Calm Recap'
const LABEL_LIMIT = 20
export const RECAP_PANE = 'calm-recap'

export const DEFAULT_SETTINGS: RecapSettings = {
  buttonLabel: DEFAULT_LABEL,
  cyberpunk: false,
  awayMinutes: 5,
  recapStyle: 'band',
  cacheMeter: false,
  weather: true,
  weatherCity: '',
  jobNaming: true,
}

export const enabledAtom = atom({ plugin: 'calm-recap', key: 'isEnabled' } as const, true)
export const settingsAtom = atom({ plugin: 'calm-recap', key: 'settings' } as const, DEFAULT_SETTINGS)
export const settingsOpenAtom = atom({ plugin: 'calm-recap', key: 'isSettingsOpen' } as const, false)
export const settingsTabAtom = atom({ plugin: 'calm-recap', key: 'settingsTab' } as const, 'display')
export const settingsHintAtom = atom({ plugin: 'calm-recap', key: 'settingsHint' } as const, null)
export const recapAtom = atom({ plugin: 'calm-recap', key: 'recap' } as const, null)
export const tickAtom = atom({ plugin: 'calm-recap', key: 'tick' } as const, 0)

// Timers and what the last turn said; a reload resets them. Everything drawn lives in $.state.
const runtime: {
  awayTimer: Timer | null
  recapTicker: Timer | null
  weatherTimer: Timer | null
  keepWarmTimer: Timer | null
  isTurnRunning: boolean
  turnStartedAt: number
  lastAsked: string
  lastAnswer: string
  job: { turnId: string; title: string } | null
  isResumeHandled: boolean
  hasTurnStarted: boolean
} = {
  awayTimer: null,
  recapTicker: null,
  weatherTimer: null,
  keepWarmTimer: null,
  isTurnRunning: false,
  turnStartedAt: 0,
  lastAsked: '',
  lastAnswer: '',
  job: null,
  isResumeHandled: false,
  hasTurnStarted: false,
}

// ── Settings ────────────────────────────────────────────────────────────────

/** Reads the options, falling back to the defaults for anything missing or malformed. */
export function normalizeSettings(options: unknown): RecapSettings {
  const raw = (typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>
  const label = typeof raw.buttonLabel === 'string' ? raw.buttonLabel.replace(/\s+/g, ' ').trim() : ''
  return {
    buttonLabel: label === '' ? DEFAULT_LABEL : label.slice(0, LABEL_LIMIT),
    cyberpunk: typeof raw.cyberpunk === 'boolean' ? raw.cyberpunk : DEFAULT_SETTINGS.cyberpunk,
    awayMinutes:
      typeof raw.awayMinutes === 'number' && Number.isFinite(raw.awayMinutes)
        ? Math.round(Math.min(120, Math.max(1, raw.awayMinutes)))
        : DEFAULT_SETTINGS.awayMinutes,
    recapStyle: raw.recapStyle === 'pane' ? 'pane' : 'band',
    cacheMeter: typeof raw.cacheMeter === 'boolean' ? raw.cacheMeter : DEFAULT_SETTINGS.cacheMeter,
    weather: typeof raw.weather === 'boolean' ? raw.weather : DEFAULT_SETTINGS.weather,
    weatherCity:
      typeof raw.weatherCity === 'string' ? raw.weatherCity.replace(/\s+/g, ' ').trim().slice(0, 60) : '',
    jobNaming: typeof raw.jobNaming === 'boolean' ? raw.jobNaming : DEFAULT_SETTINGS.jobNaming,
  }
}

/**
 * The on/off button's text, each theme with its own icon: the calm leaf, "🍃 Calm Recap ●" (○ when off), or in
 * cyberpunk the neon night city, "🌃 CALM RECAP ⏻" (⭘ when off).
 */
export function toggleLabel(settings: RecapSettings, isEnabled: boolean): string {
  return settings.cyberpunk
    ? `🌃 ${settings.buttonLabel.toUpperCase()} ${isEnabled ? '⏻' : '⭘'}`
    : `🍃 ${settings.buttonLabel} ${isEnabled ? '●' : '○'}`
}

/** The away times the − and + buttons step through, in minutes; /config takes any value from 1 to 120. */
const AWAY_STEPS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120]

export function stepAwayMinutes(minutes: number, direction: 1 | -1): number {
  const next =
    direction > 0 ? AWAY_STEPS.find(step => step > minutes) : [...AWAY_STEPS].reverse().find(step => step < minutes)
  return next ?? minutes
}

export const SETTINGS_TABS: ReadonlyArray<{ id: RecapTab; name: string }> = [
  { id: 'display', name: 'Display' },
  { id: 'recap', name: 'Recap' },
  { id: 'status', name: 'Status line' },
]

export const SETTING_HELP: Record<keyof RecapSettings, string> = {
  buttonLabel: 'The words on the on/off button',
  cyberpunk: 'Neon pink and cyan look',
  awayMinutes: 'How long you are quiet before it shows',
  recapStyle: 'Band above the prompt, or a pane',
  cacheMeter: 'Cache hit and time left, at its right end',
  weather: 'Temperature now, by your city',
  weatherCity: 'Blank finds it from your internet address',
  jobNaming: 'Haiku gives each job a short name',
}

const SETTING_NAMES: Record<keyof RecapSettings, string> = {
  buttonLabel: 'Button label',
  cyberpunk: 'Cyberpunk',
  awayMinutes: 'Away after',
  recapStyle: 'Recap style',
  cacheMeter: 'Cache in status line',
  weather: 'Weather',
  weatherCity: 'Weather city',
  jobNaming: 'Job naming',
}

/** Every switch is an icon: ◉ on, ○ off. */
export const onOff = (isOn: boolean) => (isOn ? '◉' : '○')

export function settingHint<K extends keyof RecapSettings>(field: K, value: RecapSettings[K]): string {
  const shown =
    typeof value === 'boolean'
      ? value
        ? 'On'
        : 'Off'
      : field === 'awayMinutes'
        ? `${String(value)} minutes`
        : field === 'recapStyle'
          ? value === 'pane'
            ? 'Pane'
            : 'Band'
          : field === 'weatherCity' && value === ''
            ? 'automatic'
            : `"${String(value)}"`
  return `${SETTING_NAMES[field]}: ${shown}. ${SETTING_HELP[field]}.`
}

/** Changes one setting through /config, so the menu and the panel agree; the state mirror redraws at once. */
async function setOption<K extends keyof RecapSettings>($: Engine, field: K, value: RecapSettings[K]) {
  const next = normalizeSettings({ ...(await read($, settingsAtom)), [field]: value })
  await update($, settingsAtom, () => next)
  await update($, settingsHintAtom, () => settingHint(field, next[field]))
  await syncWeather($)
  if (field === 'weatherCity' && next.weather) {
    // The timer is already running; show the new city now rather than within 15 minutes.
    await refreshWeather($).catch(() => undefined)
  }
  const rows = await $.config.list().catch(() => [])
  const row = rows.find(r => r.key === `calm-recap.${field}`) ?? rows.find(r => r.key.startsWith('calm-recap') && r.key.endsWith(`.${field}`))
  if (row === undefined) {
    $.ui.toast('Calm Recap: setting changed for this session only')
    return
  }
  const result = await $.config.set({ key: row.key, value: next[field] } as never).catch(() => ({ deny: 'failed' }))
  if (result.deny !== undefined) {
    $.ui.toast('Calm Recap: setting changed for this session only')
  }
}

/** Every setting back to its default, except the status line, which edits your settings file. */
async function resetSettings($: Engine) {
  const current = await read($, settingsAtom)
  for (const field of Object.keys(DEFAULT_SETTINGS) as Array<keyof RecapSettings>) {
    if (field !== 'cacheMeter' && current[field] !== DEFAULT_SETTINGS[field]) {
      await setOption($, field, DEFAULT_SETTINGS[field])
    }
  }
  await update($, settingsHintAtom, () => 'Every setting is back to its default. The status line is left as it is.')
}

async function setEnabled($: Engine, isEnabled: boolean) {
  await update($, enabledAtom, () => isEnabled)
  await $.store.set(STORE_KEY, isEnabled)
  await syncWeather($)
  if (!isEnabled) {
    await dismissRecap($)
  }
  $.ui.toast(isEnabled ? 'Calm Recap on' : 'Calm Recap off: no recaps until you turn it back on')
}

// ── Keep warm ───────────────────────────────────────────────────────────────
// Keeps a 1-hour prompt cache from expiring while you are away: about 5 minutes before it would, one hidden
// question over this conversation ($.model.fork) reads it from the cache, which restarts the hour. Nothing is
// added to the chat. It never wakes a cache that has already gone cold, skips 5-minute caches (pinging would cost
// more than it saves), and stops after 20 pings in a row or at the time you gave. The status-line meter tells it
// when the cache expires (<session>.json) and shows ♨ / 🔥 from what it writes back (<session>.keepwarm.json).

/** How long after start a resumed conversation waits for its own SessionStart event before showing the card anyway. */
const RESUME_FALLBACK_MS = 1500
const KEEP_WARM_LEAD_MS = 5 * 60_000
const KEEP_WARM_CHECK_MS = 60_000
const KEEP_WARM_MAX_PINGS = 20
const KEEP_WARM_TTL_MS = 60 * 60_000
const KEEP_WARM_PROMPT = 'Keep-alive check from a plugin, not from the person. Reply with just: ok'

export const keepWarmAtom = atom({ plugin: 'calm-recap', key: 'keepWarm' } as const, null)
/** Set once this process has started; plugin state lives with the process, so a resumed session starts without it. */
export const sessionSeenAtom = atom({ plugin: 'calm-recap', key: 'sessionSeen' } as const, false)

type CacheState = { ttl: string | null; expiresAt: number | null; warm: boolean | null }

/** What keep-warm should do now, from the cache's state and its own last ping. */
export function keepWarmDecision(
  state: CacheState | null,
  warmUntil: number,
  now: number,
): 'no-meter' | 'short-cache' | 'cold' | 'wait' | 'ping' {
  if (state === null) return 'no-meter'
  if (state.ttl !== '1h') return 'short-cache'
  const expiresAt = Math.max((state.expiresAt ?? 0) * 1000, warmUntil)
  if (expiresAt <= now) return 'cold'
  return expiresAt - now > KEEP_WARM_LEAD_MS ? 'wait' : 'ping'
}

/**
 * When `/… keepwarm <arg>` should stop: null for "on" (only the 20-ping limit), a time for "3h", "90m" or
 * "until 18:00" (today, or tomorrow once that has passed), undefined for anything else.
 */
export function keepWarmUntil(arg: string, now: number): number | null | undefined {
  const text = arg.trim().toLowerCase()
  if (text === '' || text === 'on') return null
  const span = /^(\d+(?:\.\d+)?)\s*(h|m)$/.exec(text)
  if (span !== null) return now + Number(span[1]) * (span[2] === 'h' ? 3_600_000 : 60_000)
  const clock = /^until\s+(\d{1,2}):(\d{2})$/.exec(text)
  if (clock !== null) {
    const at = new Date(now)
    at.setHours(Number(clock[1]), Number(clock[2]), 0, 0)
    return at.getTime() > now ? at.getTime() : at.getTime() + 24 * 3_600_000
  }
  return undefined
}

async function cacheStateFile($: Engine, suffix: string): Promise<string | undefined> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (home === undefined) return undefined
  const sep = home.includes('\\') ? '\\' : '/'
  const id = (await $.session.id()).replace(/[^A-Za-z0-9_-]/g, '')
  return [home, '.claude', 'calm-cache-state', `${id}${suffix}`].join(sep)
}

async function readCacheState($: Engine): Promise<CacheState | null> {
  const file = await cacheStateFile($, '.json')
  if (file === undefined || !(await $.fs.exists(file))) return null
  return JSON.parse(String(await $.fs.read(file))) as CacheState
}

/**
 * How long ago the last request went out and whether its prompt cache has expired, from the status line's record
 * of the cache: it expires one TTL after the last request.
 */
export function resumeFromCacheState(
  state: CacheState | null,
  now: number,
): { secondsAway: number | undefined; isCacheCold: boolean } {
  const ttlMs = state?.ttl === '1h' ? 3_600_000 : state?.ttl === '5m' ? 300_000 : null
  if (state === null || state.expiresAt === null || ttlMs === null) {
    return { secondsAway: undefined, isCacheCold: false }
  }
  const expiresAt = state.expiresAt * 1000
  return { secondsAway: Math.max(0, Math.round((now - (expiresAt - ttlMs)) / 1000)), isCacheCold: expiresAt <= now }
}

/** The Welcome back card for a resumed session, `secondsAway` after Claude last answered (undefined: not known). */
async function showResumeRecap($: Engine, secondsAway: number | undefined, isCacheCold: boolean) {
  const now = await $.clock.now()
  await showRecap($, {
    turnId: `resume-${now}`,
    awaySince: secondsAway === undefined ? null : now - secondsAway * 1000,
    isResumed: true,
    isCacheCold,
  })
}

/**
 * A resumed session's own SessionStart event can fire before this plugin has loaded (a plugin loaded from a folder
 * comes up a moment after Claude Code). So on the first start in this process, a conversation that already has a
 * reply in it is treated as resumed, unless the event did arrive or the person is already typing to Claude.
 */
async function resumeFallback($: Engine) {
  // Typing first means the person is back already.
  if (runtime.isResumeHandled || runtime.hasTurnStarted) return
  runtime.isResumeHandled = true
  const now = await $.clock.now()
  const { secondsAway, isCacheCold } = resumeFromCacheState(await readCacheState($).catch(() => null), now)
  await showResumeRecap($, secondsAway, isCacheCold)
}

async function writeKeepWarm($: Engine, keepWarm: KeepWarm) {
  await update($, keepWarmAtom, () => keepWarm)
  const file = await cacheStateFile($, '.keepwarm.json')
  if (file !== undefined) {
    await $.fs.write(file, JSON.stringify({ isOn: keepWarm.isOn, warmUntil: keepWarm.warmUntil })).catch(() => undefined)
  }
}

async function keepWarmTick($: Engine) {
  const keepWarm = await read($, keepWarmAtom)
  if (keepWarm === null || !keepWarm.isOn) return
  const now = await $.clock.now()
  if (keepWarm.until !== null && now >= keepWarm.until) {
    await stopKeepWarm($, 'Keep warm stopped: the time you gave is up')
    return
  }
  if (runtime.isTurnRunning) return
  if (keepWarmDecision(await readCacheState($).catch(() => null), keepWarm.warmUntil, now) !== 'ping') return
  const reply = await $.model.fork({ prompt: KEEP_WARM_PROMPT })
  // Only a reply served from the cache kept it warm; a miss or "nothing to fork" changes nothing.
  if (!reply.isAnswered || (reply.usage?.cache_read_input_tokens ?? 0) === 0) return
  const pings = keepWarm.pings + 1
  await writeKeepWarm($, { ...keepWarm, pings, warmUntil: now + KEEP_WARM_TTL_MS })
  if (pings >= KEEP_WARM_MAX_PINGS) {
    await stopKeepWarm($, `Keep warm stopped after ${KEEP_WARM_MAX_PINGS} pings in a row`)
  }
}

function ensureKeepWarmTimer($: Engine) {
  runtime.keepWarmTimer ??= $.clock.every(KEEP_WARM_CHECK_MS, () => {
    void keepWarmTick($).catch(() => undefined)
  })
}

async function startKeepWarm($: Engine, until: number | null) {
  const current = await read($, keepWarmAtom)
  await writeKeepWarm($, { isOn: true, until, pings: 0, warmUntil: current?.warmUntil ?? 0 })
  ensureKeepWarmTimer($)
  const state = await readCacheState($).catch(() => null)
  $.ui.toast(
    state === null
      ? 'Keep warm is on. It needs the cache meter in your status line to know when the cache expires.'
      : state.ttl === '5m'
        ? 'Keep warm is on, but this session uses the 5-minute cache, so it will not ping.'
        : 'Keep warm is on: ♨ in the status line, 🔥 once a ping keeps the cache warm',
  )
}

async function stopKeepWarm($: Engine, message: string) {
  const current = await read($, keepWarmAtom)
  await writeKeepWarm($, { isOn: false, until: null, pings: 0, warmUntil: current?.warmUntil ?? 0 })
  runtime.keepWarmTimer?.cancel()
  runtime.keepWarmTimer = null
  $.ui.toast(message)
}

/** `/… keepwarm on|off|3h|90m|until 18:00`, answered as the command's output. */
async function keepWarmCommand($: Engine, arg: string): Promise<string> {
  if (arg.trim().toLowerCase() === 'off') {
    await stopKeepWarm($, 'Keep warm is off')
    return 'Keep warm is off.'
  }
  const until = keepWarmUntil(arg, await $.clock.now())
  if (until === undefined) {
    return 'Try: keepwarm on, keepwarm 3h, keepwarm 90m, keepwarm until 18:00, or keepwarm off.'
  }
  await startKeepWarm($, until)
  return until === null
    ? `Keep warm is on (stops after ${KEEP_WARM_MAX_PINGS} pings in a row).`
    : `Keep warm is on until ${new Date(until).toTimeString().slice(0, 5)}.`
}

// ── Themes ──────────────────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

type Theme = {
  done: string
  success: string
  stopped: string
  gear: string
  sep: string
  rule: string
  title: string | undefined
  accent: string
  warn: string
  shout: (text: string) => string
  duration: (ms: number) => string
}

const CLASSIC: Theme = {
  done: '✓ ',
  success: 'success',
  stopped: '■ ',
  gear: '⚙',
  sep: ' · ',
  rule: '─',
  title: undefined,
  accent: 'claude',
  warn: 'warning',
  shout: text => text,
  duration: formatDuration,
}

/** Neon pink titles, cyan accents, yellow alerts. */
const CYBERPUNK: Theme = {
  done: '◆ ',
  success: '#00f0ff',
  stopped: '■ ',
  gear: '⚙',
  sep: ' // ',
  rule: '┄',
  title: '#ff2bd6',
  accent: '#00f0ff',
  warn: '#fcee0a',
  shout: text => text.toUpperCase(),
  duration: ms => {
    const seconds = Math.max(0, Math.floor(ms / 1000))
    const pad = (n: number) => String(n).padStart(2, '0')
    return seconds >= 3600
      ? `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
      : `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
  },
}

// ── Summary ─────────────────────────────────────────────────────────────────

const POINT_LIMIT = 3
const POINT_CHARS = 110
const NEEDS_YOU = /^needs you\s*[:\-–]\s*/i

/** The person's prompt, first line only, at most 70 characters. */
export function shortQuote(text: string): string {
  const line = (text.split('\n')[0] ?? '').replace(/\s+/g, ' ').trim()
  return line.length > 70 ? `${line.slice(0, 69).trimEnd()}…` : line
}

const clip = (text: string) => (text.length > POINT_CHARS ? `${text.slice(0, POINT_CHARS - 1).trimEnd()}…` : text)

/** A free stand-in summary: the answer's first sentences, without code or markdown, as up to three points. */
export function fallbackPoints(answer: string): string[] {
  const plain = answer
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[#>*_|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain === '') {
    return ['Claude finished without a written reply.']
  }
  return plain.split(/(?<=[.!?])\s+/).filter(sentence => sentence.length > 0).slice(0, POINT_LIMIT).map(clip)
}

/** Haiku's "- point" lines as clean points; a "Needs you:" prefix is kept for the card to highlight. */
export function parsePoints(reply: string): string[] {
  return parseCitedPoints(reply).points
}

async function summarize(
  $: Engine,
  answer: string,
  steps: readonly RecapStep[] = [],
): Promise<{ points: string[]; targets: Array<string | null> } | undefined> {
  if (answer.trim() === '') {
    return undefined
  }
  const cites = steps.length > 0
  const reply = await $.model.complete({
    model: 'haiku',
    maxTokens: 200,
    timeoutMs: 20000,
    system:
      'Summarize what the assistant did or said for a non-technical person as 1 to 3 lines, each starting with "- ". ' +
      'Each line at most 12 plain words. If the person must do or decide something, make that the last line and ' +
      'start it with "Needs you: ". No code, no file paths, no markdown other than the dashes.' +
      (cites ? ' End each line with the number of the step below it is mostly about, in square brackets, like [3].' : ''),
    prompt: cites
      ? `Steps:\n${steps.map((step, i) => `[${i + 1}] ${step.label}`).join('\n')}\n\nThe assistant's reply:\n${answer.slice(0, 4000)}`
      : answer.slice(0, 4000),
  })
  const { points, refs } = reply.isAnswered ? parseCitedPoints(reply.text) : { points: [], refs: [] }
  if (points.length === 0) {
    return undefined
  }
  return { points, targets: refs.map(ref => (ref === null ? null : (steps[ref - 1]?.target ?? null))) }
}

/** Breaks `text` into lines of at most `width` characters at spaces. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line === '') {
      line = word
    } else if (line.length + 1 + word.length <= width) {
      line = `${line} ${word}`
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line !== '') {
    lines.push(line)
  }
  return lines.flatMap(long => (long.length > width ? (long.match(new RegExp(`.{1,${width}}`, 'g')) ?? []) : [long]))
}

// ── Recap ───────────────────────────────────────────────────────────────────

/** A user row that is the person's own words, not a tool result or an injected reminder. */
const isPersonText = (text: string) => text.trim() !== '' && !text.trimStart().startsWith('<')

// ── Recap links ─────────────────────────────────────────────────────────────
// Each recap point can scroll the chat back to the step it is about: Haiku cites a numbered list of the last
// turn's steps (what Claude said, each tool it used), and a step is found again by its row in the transcript: a
// tool row by its tool_use_id, a message row by the id its drawing carried, remembered here as rows are drawn.

type ChatRow = { kind: 'user' | 'assistant'; requestId: string; text: string }

/** Message rows as the transcript drew them, newest last. */
const chatRows: ChatRow[] = []
const CHAT_ROWS_KEPT = 400

/** One step of the last turn, as Haiku sees it, and the chat row it scrolls to. */
export type RecapStep = { label: string; target: string | null }

/** Where the card's links point: a step per point once Haiku cites them, else the reply itself. */
export type RecapLinks = { steps: RecapStep[]; fallbackTarget: string | null; askedTarget: string | null }

function rememberRow(kind: ChatRow['kind'], requestId: string, text: string) {
  const known = chatRows.findIndex(row => row.requestId === requestId)
  if (known >= 0) {
    chatRows.splice(known, 1)
  }
  chatRows.push({ kind, requestId, text })
  if (chatRows.length > CHAT_ROWS_KEPT) {
    chatRows.splice(0, chatRows.length - CHAT_ROWS_KEPT)
  }
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The newest drawn row of `kind` that starts the way `text` does (a reply's first block, a prompt as typed). */
export function findRow(rows: readonly ChatRow[], kind: ChatRow['kind'], text: string): string | null {
  const head = flat(text).slice(0, 40)
  if (head === '') return null
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (row === undefined || row.kind !== kind) continue
    const start = flat(row.text).slice(0, 40)
    if (start !== '' && (start.startsWith(head) || head.startsWith(start))) return row.requestId
  }
  return null
}

function toolDetail(input: Record<string, unknown>): string {
  const detail = [input.description, input.file_path, input.command, input.pattern, input.url, input.query].find(
    value => typeof value === 'string' && value.trim() !== '',
  )
  return detail === undefined ? '' : flat(String(detail)).slice(0, 60)
}

/** The last turn's steps, newest last and at most 30, plus where "You last asked" and an uncited point lead. */
async function recapLinks($: Engine): Promise<RecapLinks> {
  const messages = await $.session.messages()
  let start = -1
  messages.forEach((message, i) => {
    if (message.role === 'user' && isPersonText(message.text)) start = i
  })
  const steps: RecapStep[] = []
  for (const message of messages.slice(start + 1)) {
    if (message.role !== 'assistant') continue
    if (message.text.trim() !== '') {
      steps.push({ label: `Said: ${flat(message.text).slice(0, 100)}`, target: findRow(chatRows, 'assistant', message.text) })
    }
    for (const use of message.toolUses) {
      const detail = toolDetail(use.input)
      steps.push({ label: detail === '' ? use.tool : `${use.tool}: ${detail}`, target: use.tool_use_id })
    }
  }
  const said = [...steps].reverse().find(step => step.label.startsWith('Said: ') && step.target !== null)
  const asked = start >= 0 ? messages[start] : undefined
  return {
    steps: steps.slice(-30),
    fallbackTarget: said?.target ?? null,
    askedTarget: asked === undefined ? null : findRow(chatRows, 'user', asked.text),
  }
}

/** Haiku's "- point [3]" lines: the points, cleaned, and the step each cites (1-based), or null. */
export function parseCitedPoints(reply: string): { points: string[]; refs: Array<number | null> } {
  const points: string[] = []
  const refs: Array<number | null> = []
  for (const raw of reply.split('\n')) {
    let line = raw.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()
    const cited = /\s*\[(\d+)\]\s*\.?$/.exec(line)
    if (cited !== null) {
      line = line.slice(0, cited.index).trim()
    }
    if (line.length === 0 || points.length >= POINT_LIMIT) continue
    points.push(clip(line))
    refs.push(cited === null ? null : Number(cited[1]))
  }
  return { points, refs }
}

/** What the recap command answers: where the card shows, as the Recap style setting puts it. */
async function shownWhere($: Engine): Promise<string> {
  return (await read($, settingsAtom)).recapStyle === 'pane'
    ? 'Showing the recap in a pane.'
    : 'Showing the recap above the prompt.'
}

/**
 * Scrolls the chat to the first of `targets` it can reach; the pane closes after, so the chat shows.
 *
 * The engine moves a transcript row only while the call answers the person's own press, so the first scroll
 * starts before anything is awaited, and the press handler returns this promise rather than dropping it.
 */
function jumpTo($: Engine, targets: ReadonlyArray<string | null | undefined>): Promise<void> {
  const ids = [...new Set(targets)].filter((id): id is string => typeof id === 'string')
  const scroll = (requestId: string) =>
    $.ui
      .scroll({ to: { requestId }, block: 'start' })
      .catch((error: unknown) => ({ deny: String(error instanceof Error ? error.message : error) }))
  const first = ids[0] === undefined ? undefined : scroll(ids[0])
  return (async () => {
    let why = 'that part of the chat is no longer on screen'
    let moved = false
    if (first !== undefined) {
      const result = await first
      moved = result.deny === undefined
      why = result.deny ?? why
    }
    for (const requestId of ids.slice(1)) {
      if (moved) break
      const result = await scroll(requestId)
      moved = result.deny === undefined
      why = result.deny ?? why
    }
    if ((await read($, settingsAtom)).recapStyle === 'pane' && moved) {
      await $.ui.close({ id: RECAP_PANE }).catch(() => undefined)
    }
    if (!moved) {
      $.ui.toast(`Calm Recap: could not scroll there (${why})`)
    }
  })()
}

/** The card's heading: "Welcome back" after time away, plain "Recap" when the person asked for it. */
function recapHeading(recap: { isAsked?: boolean } | null): string {
  return recap?.isAsked === true ? 'Recap' : 'Welcome back'
}

/** Shows the card, keeps "away 18m" current, then swaps in Haiku's points when they arrive. */
async function presentRecap($: Engine, recap: Recap, answer: string) {
  await update($, recapAtom, () => recap)
  if ((await read($, settingsAtom)).recapStyle === 'pane') {
    // Unasked, Claude Code seats a pane only on a wide terminal; the band's "Open recap" seats it anywhere.
    void $.ui.open({ id: RECAP_PANE, title: recapHeading(recap) }).catch(() => undefined)
  }
  runtime.recapTicker?.cancel()
  runtime.recapTicker = $.clock.every(60_000, () => {
    void update($, tickAtom, n => (n ?? 0) + 1)
  })
  void (async () => {
    const links = await recapLinks($).catch((): RecapLinks => ({ steps: [], fallbackTarget: null, askedTarget: null }))
    await update($, recapAtom, current =>
      current !== null && current.turnId === recap.turnId
        ? { ...current, fallbackTarget: links.fallbackTarget, askedTarget: links.askedTarget }
        : current,
    )
    const summary = await summarize($, answer, links.steps)
    if (summary !== undefined) {
      await update($, recapAtom, current =>
        current !== null && current.turnId === recap.turnId ? { ...current, points: summary.points, targets: summary.targets } : current,
      )
    }
  })().catch(() => undefined)
}

/** The last reply and request from the saved conversation, for when this process never saw them. */
async function fromConversation($: Engine) {
  const messages = await $.session.messages()
  const reply = [...messages].reverse().find(message => message.role === 'assistant' && message.text.trim() !== '')
  const request = [...messages].reverse().find(message => message.role === 'user' && isPersonText(message.text))
  return { answer: reply?.text ?? '', asked: request === undefined ? '' : shortQuote(request.text) }
}

/** Builds a card for the last answer and shows it. */
async function showRecap($: Engine, details: Partial<Recap> & { turnId: string }) {
  if (!(await read($, enabledAtom))) {
    return
  }
  let answer = runtime.lastAnswer
  let asked = runtime.lastAsked
  if (answer === '' || asked === '') {
    const saved = await fromConversation($)
    answer = answer === '' ? saved.answer : answer
    asked = asked === '' ? saved.asked : asked
  }
  if (answer === '' && asked === '') {
    return
  }
  const now = await $.clock.now()
  await presentRecap(
    $,
    {
      phase: 'done',
      tookMs: 0,
      points: fallbackPoints(answer),
      lastAsked: asked,
      awaySince: now,
      isShowing: true,
      isResumed: false,
      isCacheCold: false,
      ...details,
    },
    answer,
  )
}

async function dismissRecap($: Engine) {
  void $.ui.close({ id: RECAP_PANE }).catch(() => undefined)
  runtime.awayTimer?.cancel()
  runtime.awayTimer = null
  runtime.recapTicker?.cancel()
  runtime.recapTicker = null
  if ((await read($, recapAtom)) !== null) {
    await update($, recapAtom, () => null)
  }
}

export type LineKind = 'divider' | 'status' | 'heading' | 'point' | 'askedHeading' | 'asked'

/** `target`: the chat row a linked line scrolls to; it ends in a ↗ (the last line of a point or of "You last asked"). */
export type RecapLine = { kind: LineKind; text: string; color?: string; isBold?: boolean; isDim?: boolean; target?: string }

/** Every line of the card at `width` columns, so the band and the pane draw the same thing. */
export function recapLines(recap: Recap, theme: Theme, isCyberpunk: boolean, width: number): RecapLine[] {
  const textWidth = Math.max(16, width - 4)
  const rule: RecapLine = { kind: 'divider', text: theme.rule.repeat(width), color: isCyberpunk ? theme.title : undefined, isDim: true }
  const heading = (kind: LineKind, text: string): RecapLine => ({
    kind,
    text: theme.shout(text),
    isBold: true,
    isDim: !isCyberpunk,
    color: isCyberpunk ? theme.accent : undefined,
  })
  const outcome: Record<RecapPhase, string> = {
    done: `${theme.done}Answered${theme.sep}took ${theme.duration(recap.tookMs)}`,
    stopped: `${theme.stopped}Stopped${theme.sep}you pressed Esc`,
    stuck: `⚠ Ended early${theme.sep}something went wrong`,
  }
  const status: RecapLine = recap.isResumed
    ? {
        kind: 'status',
        text: `↻ Resumed session${recap.isCacheCold ? `${theme.sep}cache expired, your next message re-reads everything` : ''}`,
        color: recap.isCacheCold ? theme.warn : theme.accent,
      }
    : { kind: 'status', text: outcome[recap.phase], color: recap.phase === 'done' ? theme.accent : theme.warn }
  const points = recap.points.flatMap((point, index) => {
    const needsYou = NEEDS_YOU.test(point)
    const text = needsYou ? `Needs you: ${point.replace(NEEDS_YOU, '')}` : point
    // A linked point leaves room for its ↗ on the last line.
    const target = recap.targets?.[index] ?? recap.fallbackTarget ?? undefined
    const wrapped = wrapText(text, target === undefined ? textWidth : textWidth - 2)
    return wrapped.map(
      (line, i): RecapLine => ({
        kind: 'point',
        text: `${i === 0 ? (needsYou ? '  ➜ ' : '  • ') : '    '}${line}`,
        color: needsYou ? theme.warn : undefined,
        isBold: needsYou && i === 0,
        ...(target !== undefined && i === wrapped.length - 1 ? { target } : {}),
      }),
    )
  })
  const lines: RecapLine[] = [rule, status, rule, heading('heading', recap.isResumed ? 'Where you left off' : 'What Claude did'), ...points]
  if (recap.lastAsked !== '') {
    lines.push(rule, heading('askedHeading', 'You last asked'))
    const askedTarget = recap.askedTarget ?? undefined
    const asked = wrapText(`“${recap.lastAsked}”`, askedTarget === undefined ? textWidth : textWidth - 2)
    asked.forEach((line, i) => {
      lines.push({
        kind: 'asked',
        text: `    ${line}`,
        isDim: true,
        ...(askedTarget !== undefined && i === asked.length - 1 ? { target: askedTarget } : {}),
      })
    })
  }
  return lines
}

/** Fits the card into `budget` rows: rules go first, then what was asked, then all but the first point. */
export function fitRecap(lines: readonly RecapLine[], budget: number): RecapLine[] {
  let kept = [...lines]
  const without = (kinds: readonly LineKind[]) => kept.filter(line => !kinds.includes(line.kind))
  if (kept.length > budget) kept = without(['divider'])
  if (kept.length > budget) kept = without(['askedHeading', 'asked'])
  while (kept.length > budget) {
    const first = kept.findIndex(line => line.kind === 'point')
    const last = kept.map(line => line.kind).lastIndexOf('point')
    if (last <= first) break
    kept.splice(last, 1)
  }
  if (kept.length > budget) kept = without(['heading'])
  return kept
}

// ── Cache meter (status line) ───────────────────────────────────────────────
// The meter lives in Claude Code's status line, at its right end, drawn by statusline/cache-statusline.mjs.
// statusline/install.mjs wraps whatever status line the person has; a plugin cannot set it itself.

function installerPath($: Engine): string {
  const sep = /^[A-Za-z]:[\\/]/.test($.plugin.root) ? '\\' : '/'
  return [$.plugin.root, 'statusline', 'install.mjs'].join(sep)
}

async function isCacheMeterInstalled($: Engine): Promise<boolean | undefined> {
  const ran = await $.process.run(['node', installerPath($), 'status'], { timeoutMs: 10000 }).catch(() => undefined)
  return ran === undefined || ran.exitCode !== 0 ? undefined : ran.stdout.trim() === 'installed'
}

async function setCacheMeter($: Engine, isOn: boolean) {
  const ran = await $.process
    .run(['node', installerPath($), isOn ? 'install' : 'uninstall'], { timeoutMs: 20000 })
    .catch(() => undefined)
  if (ran === undefined || ran.exitCode !== 0) {
    $.ui.toast('Calm Recap: could not change the status line (is Node.js installed?)')
    return 'Could not change the status line.'
  }
  await setOption($, 'cacheMeter', isOn)
  const said = ran.stdout.trim()
  $.ui.toast(said === '' ? 'Calm Recap: status line updated' : said)
  return said
}

// ── Weather ─────────────────────────────────────────────────────────────────
// "⛅ 31°C" beside the gear, as in Calm Mode. The city comes from the computer's internet address (ipwho.is,
// looked up at most once an hour), the reading from Open-Meteo every 15 minutes; neither needs an account. On by default;
// the lookup sends the internet address to ipwho.is, which the README says, and the switch turns it off.
// Before that guess: a typed Weather city, then on a Mac the real position from Location Services through the
// optional CoreLocationCLI helper.

const WEATHER_EVERY_MS = 15 * 60_000
// Your location follows you: an hour old at most, so a new network (a trip, a café) shows within the hour.
const LOCATION_FOR_MS = 60 * 60_000
const CITY_LIMIT = 18
// Versions before 0.19.0 / 0.10.0 saved under 'weatherLocation' without a source. A process still running one of
// those (a session not yet reloaded) shares this store, so the place now lives under its own key, out of their reach.
const LOCATION_KEY = 'weatherPlace'
// A city typed into Weather city is found once with Open-Meteo's place search and kept until the name changes.
const CITY_KEY = 'weatherCityLocation'

export const weatherAtom = atom({ plugin: 'calm-recap', key: 'weather' } as const, null)

/** The WMO weather code as one symbol; clear and partly cloudy skies change at night. */
export function weatherSymbol(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? '☀' : '☾'
  if (code === 1 || code === 2) return isDay ? '⛅' : '☁'
  if (code === 3) return '☁'
  if (code === 45 || code === 48) return '🌫'
  if (code >= 51 && code <= 57) return '🌦'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return '🌧'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '❄'
  if (code >= 95) return '⛈'
  return '☁'
}

/** "📍 Bangkok ⛅ 31°C", or "⛅ 31°C" when the city is unknown; a long city name is shortened. */
export function weatherText(weather: { symbol: string; tempC: number; city?: string; source?: PlaceSource }): string {
  const city = (weather.city ?? '').trim()
  // "?" marks a city guessed from the internet address, which can be off by a province.
  const guess = weather.source === 'ip' ? '?' : ''
  const place = city === '' ? '' : `📍 ${city.length > CITY_LIMIT ? `${city.slice(0, CITY_LIMIT - 1)}…` : city}${guess} `
  return `${place}${weather.symbol} ${Math.round(weather.tempC)}°C`
}

type Place = { latitude: number; longitude: number; city: string }

/** Where the weather's city came from: typed in, the Mac's or Windows' location service, or a guess from the internet address. */
export type PlaceSource = 'typed' | 'mac' | 'windows' | 'ip'

/** A Mac whose location helper is installed but failed tries again this soon, instead of keeping a guess an hour. */
const MAC_RETRY_MS = 15 * 60_000
const MAC_TIP_KEY = 'macLocationTipShown'

/**
 * Whether a saved location can be used without checking again: under an hour old, and saved with its source. One
 * saved by an older version has no source and could be a guess or the Mac position, so it is checked again at once;
 * it still stands in if that check finds nothing.
 */
export function isLocationFresh(stored: { at: number; source?: PlaceSource } | undefined, now: number): boolean {
  return stored !== undefined && stored.source !== undefined && now - stored.at < LOCATION_FOR_MS
}

async function weatherLocation($: Engine): Promise<(Place & { source: PlaceSource }) | undefined> {
  const typed = (await read($, settingsAtom)).weatherCity
  if (typed !== '') {
    const place = await typedCityLocation($, typed)
    return place === undefined ? undefined : { ...place, source: 'typed' }
  }
  const now = await $.clock.now()
  const stored = (await $.store.get(LOCATION_KEY)) as (Place & { at: number; source?: PlaceSource }) | undefined
  const saved = stored === undefined ? undefined : { ...stored, source: stored.source ?? 'ip' }
  if (saved !== undefined && isLocationFresh(stored, now)) {
    return saved
  }
  // An unexpected error is treated like another system: no Mac retry and no tip.
  const mac = await macLocation($).catch(() => 'not-mac' as const)
  if (typeof mac === 'object') {
    const location = { ...mac, source: 'mac' as const, at: now }
    await $.store.set(LOCATION_KEY, location)
    return location
  }
  if (mac === 'missing') {
    await showMacLocationTip($)
  }
  if (mac === 'not-mac') {
    const pc = await windowsLocation($).catch(() => undefined)
    if (pc !== undefined) {
      const location = { ...pc, source: 'windows' as const, at: now }
      await $.store.set(LOCATION_KEY, location)
      return location
    }
  }
  const found = await $.http.fetch('https://ipwho.is/')
  if (!found.ok) {
    return saved
  }
  const geo = JSON.parse(found.text) as { success?: boolean; latitude?: number; longitude?: number; city?: string }
  if (geo.success !== true || typeof geo.latitude !== 'number' || typeof geo.longitude !== 'number') {
    return saved
  }
  // Saved as if older, so a Mac whose helper failed this time asks it again in 15 minutes rather than an hour.
  const at = mac === 'failed' ? now - LOCATION_FOR_MS + MAC_RETRY_MS : now
  const location = { latitude: geo.latitude, longitude: geo.longitude, city: geo.city ?? '', source: 'ip' as const, at }
  await $.store.set(LOCATION_KEY, location)
  return location
}

/** Once ever on a Mac without the helper: the city is a guess, and how to get the real one. */
async function showMacLocationTip($: Engine) {
  if ((await $.store.get(MAC_TIP_KEY)) === true) return
  await $.store.set(MAC_TIP_KEY, true)
  $.ui.toast(
    'Calm Recap: the weather city is a guess from your internet address (marked "?"). For this Mac\'s real location run ' +
      '`brew install corelocationcli` and allow CoreLocationCLI in Location Services, or type /recap weather city <name>.',
    { timeoutMs: 15000 },
  )
}

/** Where Homebrew puts the macOS location helper, tried in order (the first relies on PATH). */
const MAC_CHECK_KEY = 'macLocationCheck'
const MAC_LOCATION_HELPERS = ['CoreLocationCLI', '/opt/homebrew/bin/CoreLocationCLI', '/usr/local/bin/CoreLocationCLI']

/** Turns the helper's "latitude|longitude|city|province" line into a place; blank or "(null)" parts are skipped. */
export function parseMacLocation(line: string): Place | undefined {
  const [lat, lon, ...names] = line.trim().split('|')
  const latitude = Number(lat)
  const longitude = Number(lon)
  if (lat === undefined || lon === undefined || lat.trim() === '' || lon.trim() === '') return undefined
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined
  const city = names.map(name => name.trim()).find(name => name !== '' && name !== '(null)') ?? ''
  return { latitude, longitude, city }
}

/**
 * The Mac's real position from macOS Location Services, through the optional CoreLocationCLI helper
 * (`brew install corelocationcli`, then allow it in Location Services). Otherwise why not: 'not-mac' on other
 * systems, 'missing' when the helper is not installed, 'failed' when location is off, refused or timed out.
 */
async function macLocation($: Engine): Promise<Place | 'not-mac' | 'missing' | 'failed'> {
  const home = await $.env.get('HOME')
  if ((await $.env.get('USERPROFILE')) !== undefined || home === undefined || !home.startsWith('/Users/')) {
    return 'not-mac'
  }
  // What each try did, kept in the plugin store as 'macLocationCheck' so a failure can be explained.
  const tries: string[] = []
  let isInstalled = false
  for (const helper of MAC_LOCATION_HELPERS) {
    const ran = await $.process
      .run([helper, '--format', '%latitude|%longitude|%locality|%subAdministrativeArea|%administrativeArea'], {
        timeoutMs: 20000,
      })
      .catch((error: unknown) => String(error instanceof Error ? error.message : error).slice(0, 200))
    if (typeof ran === 'string') {
      tries.push(`${helper}: failed to run: ${ran}`)
      continue
    }
    // 127 is the shell's "command not found".
    isInstalled = isInstalled || ran.exitCode !== 127
    const place = ran.exitCode === 0 ? parseMacLocation(ran.stdout) : undefined
    tries.push(
      `${helper}: exit ${String(ran.exitCode)}${place === undefined ? `, ${(ran.stderr + ran.stdout).trim().slice(0, 200)}` : `, found ${place.city}`}`,
    )
    if (place !== undefined) {
      await $.store.set(MAC_CHECK_KEY, { at: await $.clock.now(), tries }).catch(() => undefined)
      return place
    }
  }
  await $.store.set(MAC_CHECK_KEY, { at: await $.clock.now(), tries }).catch(() => undefined)
  return isInstalled ? 'failed' : 'missing'
}

/** Fixes rougher than this (in meters) are not trusted, and the internet-address guess is used instead. */
const WINDOWS_ACCURACY_LIMIT_M = 50_000
const WINDOWS_CHECK_KEY = 'windowsLocationCheck'

/**
 * Windows PowerShell asking the Windows location service once: "latitude|longitude|accuracy in meters", exit 2 with
 * no fix in 15 seconds, exit 3 when location access is turned off for apps.
 */
const WINDOWS_LOCATION_SCRIPT = [
  'Add-Type -AssemblyName System.Device',
  "$w = New-Object System.Device.Location.GeoCoordinateWatcher('High')",
  '$w.Start()',
  '$i = 0',
  "while ($w.Position.Location.IsUnknown -and $w.Permission -ne 'Denied' -and $i -lt 30) { Start-Sleep -Milliseconds 500; $i++ }",
  '$l = $w.Position.Location',
  "$denied = $w.Permission -eq 'Denied'",
  '$w.Stop()',
  'if ($denied) { exit 3 }',
  'if ($l.IsUnknown) { exit 2 }',
  "$c = [Globalization.CultureInfo]::InvariantCulture",
  "'{0}|{1}|{2}' -f $l.Latitude.ToString($c), $l.Longitude.ToString($c), [math]::Round($l.HorizontalAccuracy)",
].join('; ')

/** Turns the script's "latitude|longitude|accuracy" line into a fix. */
export function parseWindowsLocation(line: string): { latitude: number; longitude: number; accuracyM: number } | undefined {
  const [lat, lon, acc] = line.trim().split('|').map(part => part.trim())
  if (lat === undefined || lon === undefined || acc === undefined || lat === '' || lon === '' || acc === '') return undefined
  const latitude = Number(lat)
  const longitude = Number(lon)
  const accuracyM = Number(acc)
  if (![latitude, longitude, accuracyM].every(Number.isFinite)) return undefined
  return { latitude, longitude, accuracyM }
}

/**
 * This PC's position from the Windows location service, which needs nothing installed, named with BigDataCloud's
 * free reverse lookup (it receives the coordinates). Undefined on other systems, with location access off, without
 * a fix, or with a fix rougher than 50 km, so the internet-address guess is used. What happened is kept in the plugin
 * store as 'windowsLocationCheck'.
 */
async function windowsLocation($: Engine): Promise<Place | undefined> {
  if ((await $.env.get('USERPROFILE')) === undefined) {
    return undefined
  }
  const now = await $.clock.now()
  const note = (result: string) => $.store.set(WINDOWS_CHECK_KEY, { at: now, result }).catch(() => undefined)
  const ran = await $.process
    .run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_LOCATION_SCRIPT], { timeoutMs: 25000 })
    .catch((error: unknown) => String(error instanceof Error ? error.message : error).slice(0, 200))
  if (typeof ran === 'string') {
    await note(`failed to run: ${ran}`)
    return undefined
  }
  const fix = ran.exitCode === 0 ? parseWindowsLocation(ran.stdout) : undefined
  if (fix === undefined) {
    await note(ran.exitCode === 3 ? 'location access is off' : `no fix (exit ${String(ran.exitCode)})`)
    return undefined
  }
  if (fix.accuracyM > WINDOWS_ACCURACY_LIMIT_M) {
    await note(`too rough: ${Math.round(fix.accuracyM / 1000)} km`)
    return undefined
  }
  const named = await $.http
    .fetch(
      'https://api.bigdatacloud.net/data/reverse-geocode-client' +
        `?latitude=${fix.latitude}&longitude=${fix.longitude}&localityLanguage=en`,
    )
    .catch(() => undefined)
  const place =
    named !== undefined && named.ok
      ? (JSON.parse(named.text) as { city?: string; locality?: string; principalSubdivision?: string })
      : {}
  const city = [place.city, place.locality, place.principalSubdivision].find(name => (name ?? '').trim() !== '') ?? ''
  await note(`found ${city === '' ? 'a position' : city} within ${Math.round(fix.accuracyM / 1000)} km`)
  return { latitude: fix.latitude, longitude: fix.longitude, city }
}

/**
 * Where the typed city is, from Open-Meteo's place search, which needs no account; the internet address is not
 * looked up at all. A name with no match says so once and shows no weather until it is changed.
 */
async function typedCityLocation(
  $: Engine,
  name: string,
): Promise<{ latitude: number; longitude: number; city: string } | undefined> {
  const saved = (await $.store.get(CITY_KEY)) as
    | { query: string; latitude: number; longitude: number; city: string }
    | { query: string; isMissing: true }
    | undefined
  if (saved !== undefined && saved.query === name) {
    return 'isMissing' in saved ? undefined : saved
  }
  const found = await $.http.fetch(
    `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(name)}`,
  )
  if (!found.ok) {
    return undefined
  }
  const place = (JSON.parse(found.text) as { results?: Array<{ name?: string; latitude?: number; longitude?: number }> })
    .results?.[0]
  if (place === undefined || typeof place.latitude !== 'number' || typeof place.longitude !== 'number') {
    await $.store.set(CITY_KEY, { query: name, isMissing: true })
    await update($, weatherAtom, () => null)
    $.ui.toast(`Calm Recap: no place called "${name}" found. Check the spelling in Weather city.`)
    return undefined
  }
  const location = { query: name, latitude: place.latitude, longitude: place.longitude, city: place.name ?? name }
  await $.store.set(CITY_KEY, location)
  return location
}

async function refreshWeather($: Engine) {
  const location = await weatherLocation($)
  if (location === undefined) {
    return
  }
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,weather_code,is_day`
  const reply = await $.http.fetch(url)
  if (!reply.ok) {
    return
  }
  const current = (JSON.parse(reply.text) as { current?: { temperature_2m?: number; weather_code?: number; is_day?: number } }).current
  if (typeof current?.temperature_2m !== 'number' || typeof current.weather_code !== 'number') {
    return
  }
  const weather = {
    symbol: weatherSymbol(current.weather_code, current.is_day !== 0),
    tempC: current.temperature_2m,
    city: location.city,
    source: location.source,
  }
  await update($, weatherAtom, () => weather)
}

/** Checks the weather every 15 minutes while it is turned on; no timer runs while it is off. */
async function syncWeather($: Engine) {
  const isOn = (await read($, enabledAtom)) && (await read($, settingsAtom)).weather
  if (isOn && runtime.weatherTimer === null) {
    runtime.weatherTimer = $.clock.every(WEATHER_EVERY_MS, () => {
      void refreshWeather($).catch(() => undefined)
    })
    await refreshWeather($).catch(() => undefined)
  } else if (!isOn && runtime.weatherTimer !== null) {
    runtime.weatherTimer.cancel()
    runtime.weatherTimer = null
  }
}

// ── The last job ────────────────────────────────────────────────────────────
// Calm Recap has no plan, so the "job" is your last message: once Claude answers, the band says how it went,
// "✓ All done · Make the pricing cards blue · took 1m 30s" (cyberpunk: "◆ ALL DONE // … // took 01:30"). The
// name is Haiku's 2 to 6 words when Job naming is on, else the start of your message, cleaned of code and paths.

export const lastJobAtom = atom({ plugin: 'calm-recap', key: 'lastJob' } as const, null)

const TITLE_LIMIT = 50

/** Plain words for a job name: no code, paths or file names, a capital first letter, at most 50 characters. */
export function cleanTitle(raw: string): string {
  let text = (raw.split('\n')[0] ?? '')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\S*[\\/]\S*/g, ' ')
    .replace(/[\w.-]*\.(?:tsx?|jsx?|mjs|py|json|md|css|html?|ya?ml|sh)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length > TITLE_LIMIT) {
    const room = text.slice(0, TITLE_LIMIT - 1)
    const cut = room.lastIndexOf(' ') > 0 ? room.slice(0, room.lastIndexOf(' ')) : room
    text = `${cut.replace(/[\s,.;:–-]+$/, '')}…`
  }
  return text === '' ? 'Your request' : text.charAt(0).toUpperCase() + text.slice(1)
}

/** "✓ All done · <name> · took 1m 30s", or how the job ended otherwise. */
export function lastJobLine(job: LastJob, theme: Theme): string {
  const title = theme.shout(job.title)
  if (job.phase === 'done') {
    return `${theme.done}${theme.shout('All done')}${theme.sep}${title}${theme.sep}took ${theme.duration(job.tookMs)}`
  }
  if (job.phase === 'stopped') {
    return `${theme.stopped}${theme.shout('Stopped')}${theme.sep}${title}${theme.sep}you pressed Esc`
  }
  return `⚠ ${theme.shout('Ended early')}${theme.sep}${title}`
}

/** Asks Haiku for a 2 to 6 word name for the job; a newer job makes the answer moot. */
async function nameJob($: Engine, turnId: string, prompt: string) {
  const reply = await $.model.complete({
    model: 'haiku',
    maxTokens: 30,
    timeoutMs: 15000,
    system:
      'Name the job in the request in 2 to 6 plain English words that start with a verb. ' +
      'No code, no file names, no quotes, no punctuation at the end. Reply with the name only.',
    prompt: prompt.slice(0, 2000),
  })
  if (!reply.isAnswered) {
    return
  }
  const first = (reply.text.split('\n')[0] ?? '').replace(/^\s*[-•*]\s*/, '').replace(/["'.]+/g, '')
  const title = cleanTitle(first).split(' ').slice(0, 6).join(' ')
  if (runtime.job?.turnId !== turnId) {
    return
  }
  runtime.job = { turnId, title }
  await update($, lastJobAtom, current => (current !== null && current.turnId === turnId ? { ...current, title } : current))
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function registerCalmRecap(on: On, options?: unknown): void {
  const configured = normalizeSettings(options)

  on('session.start', async ($, e, next) => {
    if (!(await read($, sessionSeenAtom))) {
      await update($, sessionSeenAtom, () => true)
      $.clock.after(RESUME_FALLBACK_MS, () => {
        void resumeFallback($).catch(() => undefined)
      })
    } else {
      // A hot reload: this process already showed whatever it had to.
      runtime.isResumeHandled = true
    }
    const stored = await $.store.get(STORE_KEY)
    await update($, enabledAtom, () => (typeof stored === 'boolean' ? stored : true))
    await update($, settingsAtom, () => configured)
    void syncWeather($).catch(() => undefined)
    if ((await read($, keepWarmAtom))?.isOn === true) {
      ensureKeepWarmTimer($)
    }
    // The button shows what the status line really holds; reading it changes nothing.
    void isCacheMeterInstalled($).then(isInstalled => {
      if (isInstalled !== undefined && isInstalled !== configured.cacheMeter) {
        void update($, settingsAtom, current => ({ ...current, cacheMeter: isInstalled }))
      }
    })
    await $.command.register({
      name: 'recap',
      description: 'Show the recap card now; on|off turns Calm Recap on or off; statusline on|off adds the cache meter; keepwarm keeps the cache warm',
      argumentHint: '[on|off] | statusline on|off | keepwarm on|off|3h|until 18:00 | weather city <name>',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'recap' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const city = /^weather\s+city(?:\s+(.*))?$/i.exec(e.args.trim())
    if (city !== null) {
      const typed = (city[1] ?? '').trim()
      await setOption($, 'weatherCity', typed)
      return {
        text:
          typed === ''
            ? 'Weather city cleared: the city comes from your internet address again.'
            : `Weather city set to "${typed}".`,
      }
    }
    if (arg === 'keepwarm' || arg.startsWith('keepwarm ')) {
      return { text: await keepWarmCommand($, arg.slice('keepwarm'.length)) }
    }
    const statusLine = /^statusline\s+(on|off)$/.exec(arg)
    if (statusLine !== null) {
      return { text: await setCacheMeter($, statusLine[1] === 'on') }
    }
    if (arg === 'on' || arg === 'off') {
      await setEnabled($, arg === 'on')
      return { text: arg === 'on' ? 'Calm Recap is on.' : 'Calm Recap is off.' }
    }
    if (!(await read($, enabledAtom))) {
      return { text: 'Calm Recap is off. Type /recap on first.' }
    }
    await showRecap($, { turnId: `now-${await $.clock.now()}`, isAsked: true })
    return { text: await shownWhere($) }
  })

  on('turn.start', async ($, e, next) => {
    runtime.isTurnRunning = true
    runtime.hasTurnStarted = true
    const text = e.text.trim()
    if (text !== '' && !text.startsWith('/')) {
      // A message of your own resets keep-warm's "20 pings in a row".
      await update($, keepWarmAtom, current => (current !== null && current.isOn ? { ...current, pings: 0 } : current))
      runtime.lastAsked = shortQuote(text)
      runtime.turnStartedAt = await $.clock.now()
      await dismissRecap($)
      const turnId = e.turnId
      runtime.job = { turnId, title: cleanTitle(text) }
      await update($, lastJobAtom, () => null)
      if ((await read($, settingsAtom)).jobNaming) {
        $.clock.after(0, () => {
          void nameJob($, turnId, text).catch(() => undefined)
        })
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }
    runtime.isTurnRunning = false
    runtime.lastAnswer = e.answer
    const phase: RecapPhase = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'stuck'
    const settings = await read($, settingsAtom)
    const answeredAt = await $.clock.now()
    const job = runtime.job
    if (job !== null) {
      await update($, lastJobAtom, () => ({ turnId: job.turnId, title: job.title, phase, tookMs: e.durationMs }))
    }
    runtime.awayTimer?.cancel()
    runtime.awayTimer = $.clock.after(settings.awayMinutes * 60_000, () => {
      void showRecap($, { turnId: e.turnId, phase, tookMs: e.durationMs, awaySince: answeredAt }).catch(() => undefined)
    })
    return next(e)
  })

  // `claude --resume`: the card straight away, rebuilt from the saved conversation.
  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    if (e.source === 'resume' && !runtime.isResumeHandled) {
      runtime.isResumeHandled = true
      $.clock.after(500, () => {
        void showResumeRecap($, e.seconds_since_last_response, e.prompt_cache_likely_expired === true).catch(
          () => undefined,
        )
      })
    }
    return started
  })

  // The chat's message rows, remembered as they are drawn so a recap point can scroll back to one.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    rememberRow('assistant', e.requestId, e.props.text)
    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    rememberRow('user', e.requestId, e.props.text)
    return next(e)
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
    const weather = isEnabled && settings.weather ? await read($, weatherAtom) : null
    const weatherCell = weather === null ? '' : `${weatherText(weather)}  `
    const theme = settings.cyberpunk ? CYBERPUNK : CLASSIC
    const columns = Math.max(20, e.props.bodyColumns)
    const now = await $.clock.now()

    const label = toggleLabel(settings, isEnabled)
    const buttons = (
      <Box flexDirection="row">
        {weatherCell === '' ? null : (
          <Text dimColor={!settings.cyberpunk} color={settings.cyberpunk ? theme.accent : undefined}>
            {weatherCell}
          </Text>
        )}
        <Button key="recap-settings" label={theme.gear} plain dimColor={!isSettingsOpen} onPress={() => update($, settingsOpenAtom, isOpen => !isOpen)} />
        <Text> </Text>
        <Button
          key="recap-toggle"
          label={label}
          variant={settings.cyberpunk ? 'primary' : undefined}
          dimColor={!isEnabled}
          onPress={() => setEnabled($, !isEnabled)}
        />
      </Box>
    )
    const headerRoom = Math.max(4, columns - (weatherCell.length + theme.gear.length + 1 + label.length + 4) - 1)

    // ── Settings: one tab at a time, each row "name · switch · what it does" ──
    const tab = await read($, settingsTabAtom)
    const hint = await read($, settingsHintAtom)
    const keepWarm = await read($, keepWarmAtom)
    const labelWidth = 22
    const name = (text: string, isOff = false) => <Text dimColor={isOff}>{`  ${text.padEnd(labelWidth)}`}</Text>
    const about = (text: string) => <Text dimColor wrap="truncate">{`  ${text}`}</Text>
    const toggle = (key: string, isOn: boolean, onPress: () => unknown) => (
      <Button key={key} label={onOff(isOn)} variant={isOn ? 'primary' : undefined} dimColor={!isOn} onPress={onPress} />
    )
    const row = (key: string, ...children: JSX.Element[]) => (
      <Box key={key} flexDirection="row">
        {children}
      </Box>
    )
    const tabRows: Record<RecapTab, JSX.Element[]> = {
      display: [
        row('r-cyber', name('Cyberpunk'), toggle('set-cyber', settings.cyberpunk, () => setOption($, 'cyberpunk', !settings.cyberpunk)), about(SETTING_HELP.cyberpunk)),
        row('r-naming', name('Job naming'), toggle('set-naming', settings.jobNaming, () => setOption($, 'jobNaming', !settings.jobNaming)), about(SETTING_HELP.jobNaming)),
        row('r-weather', name('Weather'), toggle('set-weather', settings.weather, () => setOption($, 'weather', !settings.weather)), about(settings.weather ? (weather?.source === 'ip' ? 'City is a guess (?): set Weather city' : SETTING_HELP.weather) : 'City found from your internet address')),
      ],
      recap: [
        row(
          'r-after',
          name('Away after'),
          <Box flexDirection="row">
            <Button key="away-down" label="−" onPress={() => setOption($, 'awayMinutes', stepAwayMinutes(settings.awayMinutes, -1))} />
            <Text>{` ${settings.awayMinutes}m `}</Text>
            <Button key="away-up" label="+" onPress={() => setOption($, 'awayMinutes', stepAwayMinutes(settings.awayMinutes, 1))} />
          </Box>,
          about(SETTING_HELP.awayMinutes),
        ),
        row(
          'r-style',
          name('Recap style'),
          <Button key="set-recap-style" label={settings.recapStyle === 'pane' ? 'Pane' : 'Band'} onPress={() => setOption($, 'recapStyle', settings.recapStyle === 'pane' ? 'band' : 'pane')} />,
          about(SETTING_HELP.recapStyle),
        ),
      ],
      status: [
        row('r-cache', name('Cache in status line'), toggle('set-cache', settings.cacheMeter, () => setCacheMeter($, !settings.cacheMeter)), about(SETTING_HELP.cacheMeter)),
        row(
          'r-keepwarm',
          name('Keep warm', !settings.cacheMeter),
          toggle('set-keepwarm', keepWarm?.isOn === true, () =>
            keepWarm?.isOn === true ? stopKeepWarm($, 'Keep warm is off') : startKeepWarm($, null),
          ),
          about(
            settings.cacheMeter
              ? `Pings before the 1h cache expires (${keepWarm?.isOn === true ? `${keepWarm.pings}/${KEEP_WARM_MAX_PINGS} pings` : 'this session'}), ♨ then 🔥`
              : 'Needs Cache in status line',
          ),
        ),
      ],
    }
    const tabInputs: Record<RecapTab, JSX.Element[]> = {
      display:
        Input === undefined
          ? []
          : [<Input key="set-label" label={`  ${'Button label'.padEnd(labelWidth)}`} placeholder={DEFAULT_LABEL} value={settings.buttonLabel} submitLabel="save" onSubmit={value => setOption($, 'buttonLabel', value)} />, <Input key="set-weather-city" label={`  ${'Weather city'.padEnd(labelWidth)}`} placeholder="automatic (internet address)" value={settings.weatherCity} submitLabel="save" onSubmit={value => setOption($, 'weatherCity', value)} />],
      recap: [],
      status: [],
    }
    const settingsRow = isSettingsOpen ? (
      <Box key="settings" flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap">
          <Text bold color={theme.title ?? theme.accent}>{`${theme.gear} ${theme.shout('Settings')}  `}</Text>
          {SETTINGS_TABS.map((t, i) => (
            <Box key={`tab-box-${t.id}`} flexDirection="row">
              <Button
                key={`tab-${t.id}`}
                label={`${i + 1} ${t.name}`}
                hotkey={String(i + 1)}
                variant={tab === t.id ? 'primary' : undefined}
                dimColor={tab !== t.id}
                onPress={() => update($, settingsTabAtom, () => t.id)}
              />
              <Text> </Text>
            </Box>
          ))}
          <Text>{'  '}</Text>
          <Button key="set-reset" label="Reset" dimColor onPress={() => resetSettings($)} />
        </Box>
        <Text dimColor color={settings.cyberpunk ? theme.title : undefined}>{theme.rule.repeat(Math.min(columns, 80))}</Text>
        {tabRows[tab]}
        {tabInputs[tab]}
        {hint === null ? null : <Text key="settings-hint" dimColor italic wrap="truncate">{`  ↳ ${hint}`}</Text>}
      </Box>
    ) : null
    const settingsRows = isSettingsOpen ? 2 + tabRows[tab].length + tabInputs[tab].length + (hint === null ? 0 : 1) : 0

    if (recap !== null && recap.isShowing) {
      const recapTick = await read($, tickAtom)
      const header = (
        <Box flexDirection="row" justifyContent="space-between" width={columns}>
          <Box width={headerRoom}>
            <Text wrap="truncate" bold color={theme.title ?? theme.accent}>
              {`↩ ${theme.shout(recapHeading(recap))}${recap.awaySince === null || recap.isAsked === true ? '' : `${theme.sep}away ${theme.duration(now - recap.awaySince)}`}`}
            </Text>
          </Box>
          {buttons}
        </Box>
      )
      const gotIt = <Button key="recap-ok" label="Got it" variant="primary" onPress={() => dismissRecap($)} />
      if (settings.recapStyle === 'pane') {
        return (
          <Box flexDirection="column" width={columns} key={`recap-${recapTick}`}>
            {header}
            <Box flexDirection="row">
              <Button key="recap-open" label="Open recap" onPress={() => $.ui.open({ id: RECAP_PANE, title: recapHeading(recap) })} />
              <Text> </Text>
              {gotIt}
            </Box>
            {settingsRow}
          </Box>
        )
      }
      const budget = Math.max(2, e.props.maxRows - 2 - settingsRows)
      const lines = fitRecap(recapLines(recap, theme, settings.cyberpunk, columns), budget)
      return (
        <Box flexDirection="column" width={columns} key={`recap-${recapTick}`}>
          {header}
          {lines.map((line, i) => (
            line.target === undefined ? (
              <Text key={`recap-line-${i}`} wrap="truncate" color={line.color} bold={line.isBold} dimColor={line.isDim}>
                {line.text}
              </Text>
            ) : (
              <Box key={`recap-line-${i}`} flexDirection="row">
                <Text wrap="truncate" color={line.color} bold={line.isBold} dimColor={line.isDim}>
                  {line.text}
                </Text>
                <Text> </Text>
                <Button key={`recap-go-${i}`} label="↗" plain onPress={() => jumpTo($, [line.target, recap.fallbackTarget])} />
              </Box>
            )
          ))}
          <Box flexDirection="row" justifyContent="flex-end" width={columns}>
            {gotIt}
          </Box>
          {settingsRow}
        </Box>
      )
    }

    const lastJob = isEnabled ? await read($, lastJobAtom) : null
    return (
      <Box flexDirection="column" width={columns}>
        <Box flexDirection="row" justifyContent={lastJob === null ? 'flex-end' : 'space-between'} width={columns}>
          {lastJob === null ? null : (
            <Box width={headerRoom}>
              <Text wrap="truncate" color={lastJob.phase === 'done' ? theme.success : theme.warn}>
                {lastJobLine(lastJob, theme)}
              </Text>
            </Box>
          )}
          {buttons}
        </Box>
        {settingsRow}
      </Box>
    )
  })

  // The recap in a pane: the pane's full width, scrolling if it must.
  on('ui.render', { component: 'Pane', requestId: RECAP_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const settings = await read($, settingsAtom)
    const recap = await read($, recapAtom)
    const theme = settings.cyberpunk ? CYBERPUNK : CLASSIC
    if (recap === null) {
      return <Text dimColor>Nothing to recap right now. Type /recap after Claude answers.</Text>
    }
    const width = Math.max(20, e.props.bodyColumns)
    const now = await $.clock.now()
    await read($, tickAtom)
    return (
      <Box flexDirection="column" width={width}>
        <Text bold color={theme.title ?? theme.accent} wrap="truncate">
          {`↩ ${theme.shout(recapHeading(recap))}${recap.awaySince === null || recap.isAsked === true ? '' : `${theme.sep}away ${theme.duration(now - recap.awaySince)}`}`}
        </Text>
        {recapLines(recap, theme, settings.cyberpunk, width).map((line, i) => (
          line.target === undefined ? (
              <Text key={`pane-line-${i}`} wrap="truncate" color={line.color} bold={line.isBold} dimColor={line.isDim}>
                {line.text}
              </Text>
            ) : (
              <Box key={`pane-line-${i}`} flexDirection="row">
                <Text wrap="truncate" color={line.color} bold={line.isBold} dimColor={line.isDim}>
                  {line.text}
                </Text>
                <Text> </Text>
                <Button key={`pane-go-${i}`} label="↗" plain onPress={() => jumpTo($, [line.target, recap.fallbackTarget])} />
              </Box>
            )
        ))}
        <Box flexDirection="row" justifyContent="flex-end" width={width}>
          <Button key="recap-pane-ok" label="Got it" variant="primary" onPress={() => dismissRecap($)} />
        </Box>
      </Box>
    )
  })
}
