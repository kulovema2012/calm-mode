import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { AsideSettings, Exchange } from '../types'

// Calm Aside: a read-only side chat about the session, in Calm Mode's look. `/aside [question]` opens a pane beside
// the chat; each question is one $.model.fork over the session's own transcript as of Claude's last finished reply:
// no tools, kept off the transcript, and read from the main chat's prompt cache. Nothing goes back into the main chat,
// so Claude never sees the side questions or their answers.
//
// Based on aside by JayDoubleu (MIT, https://github.com/JayDoubleu/aside); see the README for the notice.
//
// What this module may call on $: clock, command.register, model.complete, model.fork, session.messages, ui.open,
// ui.close, ui.resolve and its own state. No fs, process, http, store, tool or prompt calls, so it cannot reach your
// files, run commands, use the network itself, or type into the main chat. `claude plugin validate --strict` lists it.

type Engine = EngineInterface

export const ASIDE_PANE = 'calm-aside'
/** An answer longer than this is cut, so one reply cannot fill the pane. */
export const ANSWER_LIMIT = 1200
/** How much of the chat's text a quick answer sends, newest last. */
export const QUICK_CHAT_CHARS = 60_000
/** Side questions kept in memory at most, whatever Side questions kept says. */
const EXCHANGES_KEPT = 50

const QUICK_SYSTEM =
  'You answer read-only side questions about a Claude Code session from its transcript. No tools; do not continue the task; answer briefly in plain prose.'

export const DEFAULT_SETTINGS: AsideSettings = {
  cyberpunk: false,
  showCost: true,
  liveFallback: true,
  liveModel: 'haiku',
  maxHistory: 8,
}

export const settingsAtom = atom({ plugin: 'calm-aside', key: 'settings' } as const, DEFAULT_SETTINGS)
export const exchangesAtom = atom({ plugin: 'calm-aside', key: 'exchanges' } as const, [] as Exchange[])

// Ids for new questions and the ones waiting for Claude's reply to end; a reload resets them.
// isOpen: whether the pane is up, so a bare /aside can hide it again.
const runtime: { nextId: number; waiting: number[]; isOpen: boolean } = { nextId: 0, waiting: [], isOpen: false }

/** Reads the options, falling back to the defaults for anything missing or malformed. */
export function normalizeSettings(options: unknown): AsideSettings {
  const raw = (typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>
  return {
    cyberpunk: typeof raw.cyberpunk === 'boolean' ? raw.cyberpunk : DEFAULT_SETTINGS.cyberpunk,
    showCost: typeof raw.showCost === 'boolean' ? raw.showCost : DEFAULT_SETTINGS.showCost,
    liveFallback: typeof raw.liveFallback === 'boolean' ? raw.liveFallback : DEFAULT_SETTINGS.liveFallback,
    liveModel: typeof raw.liveModel === 'string' && raw.liveModel.trim() !== '' ? raw.liveModel.trim() : DEFAULT_SETTINGS.liveModel,
    maxHistory:
      typeof raw.maxHistory === 'number' && Number.isFinite(raw.maxHistory)
        ? Math.round(Math.min(50, Math.max(1, raw.maxHistory)))
        : DEFAULT_SETTINGS.maxHistory,
  }
}

// ── Look ────────────────────────────────────────────────────────────────────

type Theme = {
  sep: string
  rule: string
  title: string | undefined
  accent: string
  warn: string
  shout: (text: string) => string
}

const CLASSIC: Theme = { sep: ' · ', rule: '─', title: undefined, accent: 'claude', warn: 'warning', shout: text => text }

/** Neon pink titles, cyan accents, yellow alerts: Calm Mode's Cyberpunk theme. */
const CYBERPUNK: Theme = {
  sep: ' // ',
  rule: '┄',
  title: '#ff2bd6',
  accent: '#00f0ff',
  warn: '#fcee0a',
  shout: text => text.toUpperCase(),
}

const themeOf = (settings: AsideSettings): Theme => (settings.cyberpunk ? CYBERPUNK : CLASSIC)

/** 72848 → "72.8k". */
export function shortCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** 840 → "840 ms", 1244 → "1.2 s". */
export function shortTime(ms: number): string {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** The dim line under an answer: where it came from, how long it took and what it cost in tokens. */
export function costLine(exchange: Exchange, sep: string): string | null {
  if (exchange.answer === null || exchange.kind === undefined || exchange.kind === 'error') return null
  const took = exchange.tookMs === undefined ? '' : `${sep}${shortTime(exchange.tookMs)}`
  if (exchange.kind === 'quick') {
    return `quick${took}${exchange.sentChars === undefined ? '' : `${sep}${exchange.sentChars.toLocaleString('en-US')} chars sent, not cached`}`
  }
  const usage = exchange.usage
  return usage === undefined
    ? `fork${took}`
    : `fork${took}${sep}cache ${shortCount(usage.read)}${sep}new ${shortCount(usage.added)}${sep}out ${shortCount(usage.out)}`
}

// ── Asking ──────────────────────────────────────────────────────────────────

const clip = (text: string): string => {
  const trimmed = text.trim()
  return trimmed.length > ANSWER_LIMIT ? `${trimmed.slice(0, ANSWER_LIMIT)}…` : trimmed
}

/**
 * The one message a fork gets: the rules, the earlier side questions (a fork takes a single user message, so the side
 * chat's own history rides along in it), and the new question.
 */
export function promptFor(question: string, earlier: readonly Exchange[], maxHistory: number): string {
  const prior = earlier
    .filter(x => x.answer !== null && (x.kind === 'fork' || x.kind === 'quick'))
    .slice(-maxHistory)
    .map(x => `Q: ${x.question}\nA: ${x.answer}`)
    .join('\n\n')
  return [
    'This is a read-only side question about the conversation above. Answer from the transcript so far.',
    'Do not use tools, do not propose edits, do not continue the main task; answer briefly in plain prose.',
    prior === '' ? '' : `Earlier side questions and their answers:\n\n${prior}`,
    `Side question: ${question}`,
  ]
    .filter(part => part !== '')
    .join('\n\n')
}

/** The chat's text for a quick answer: the newest QUICK_CHAT_CHARS characters. */
export function chatText(messages: ReadonlyArray<{ role: string; text: string }>): string {
  const text = messages.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n\n')
  return text.length > QUICK_CHAT_CHARS ? `…${text.slice(-QUICK_CHAT_CHARS)}` : text
}

async function patch($: Engine, id: number, change: Partial<Exchange>) {
  await update($, exchangesAtom, list => list.map(x => (x.id === id ? { ...x, ...change } : x)))
}

/** Before the first reply there is nothing to fork: a small model reads the chat's text instead. */
async function answerQuick($: Engine, id: number, prompt: string, askedAt: number) {
  const settings = await read($, settingsAtom)
  const messages = await $.session.messages()
  if (messages.length === 0) {
    await patch($, id, { answer: '(nothing to ask about yet: the chat is empty)', kind: 'error' })
    return
  }
  const text = chatText(messages)
  const reply = await $.model.complete({
    model: settings.liveModel,
    maxTokens: 400,
    system: QUICK_SYSTEM,
    prompt: `Transcript so far:\n\n${text}\n\n${prompt}`,
  })
  const now = await $.clock.now()
  await patch(
    $,
    id,
    reply.isAnswered
      ? { answer: clip(reply.text), kind: 'quick', tookMs: now - askedAt, sentChars: text.length }
      : { answer: `(no answer: ${reply.reason})`, kind: 'error', tookMs: now - askedAt },
  )
}

/** Answers one side question with a fork of the session, or quickly, or later, as the settings say. */
async function answer($: Engine, id: number) {
  const settings = await read($, settingsAtom)
  const list = await read($, exchangesAtom)
  const entry = list.find(x => x.id === id)
  if (entry === undefined) return
  const prompt = promptFor(
    entry.question,
    list.filter(x => x.id < id),
    settings.maxHistory,
  )
  try {
    const reply = await $.model.fork({ prompt })
    const now = await $.clock.now()
    if (reply.isAnswered) {
      const usage = reply.usage
      await patch($, id, {
        answer: clip(reply.text),
        kind: 'fork',
        tookMs: now - entry.askedAt,
        usage: {
          read: usage?.cache_read_input_tokens ?? 0,
          added: (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0),
          out: usage?.output_tokens ?? 0,
        },
      })
      return
    }
    if (reply.reason !== 'nothing-to-fork') {
      await patch($, id, { answer: `(no answer: ${reply.reason})`, kind: 'error', tookMs: now - entry.askedAt })
      return
    }
    if (settings.liveFallback) {
      await answerQuick($, id, prompt, entry.askedAt)
      return
    }
    runtime.waiting.push(id)
    await patch($, id, { isWaiting: true })
  } catch (error) {
    await patch($, id, { answer: `(no answer: ${error instanceof Error ? error.message : String(error)})`, kind: 'error' })
  }
}

/** Adds a side question to the pane and starts answering it; the pane redraws as the answer lands. */
async function ask($: Engine, question: string) {
  const text = question.trim()
  if (text === '') return
  runtime.nextId += 1
  const id = runtime.nextId
  const askedAt = await $.clock.now()
  await update($, exchangesAtom, list => [...list, { id, question: text, answer: null, askedAt }].slice(-EXCHANGES_KEPT))
  void answer($, id).catch(() => undefined)
}

async function openPane($: Engine) {
  const theme = themeOf(await read($, settingsAtom))
  const opened = await $.ui.open({ id: ASIDE_PANE, title: theme.shout('Aside'), focus: true }).catch(() => undefined)
  if (opened !== undefined) runtime.isOpen = true
}

/** Hides the pane; the side questions stay, and the next /aside shows them again. */
async function hidePane($: Engine) {
  runtime.isOpen = false
  await $.ui.close({ id: ASIDE_PANE }).catch(() => undefined)
}

async function clearExchanges($: Engine) {
  runtime.waiting = []
  await update($, exchangesAtom, () => [])
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function registerCalmAside(on: On, options?: unknown): void {
  const configured = normalizeSettings(options)

  on('session.start', async ($, e, next) => {
    await update($, settingsAtom, () => configured)
    await $.command.register({
      name: 'aside',
      description: 'Read-only side chat about this session: shows or hides its pane; clear empties it',
      argumentHint: '[question] | hide | clear',
      immediate: true,
    })
    return next(e)
  })

  // Answers {} on purpose: a { text } answer would land in the chat, where Claude reads it.
  on('command.run', { command: 'aside' }, async ($, e) => {
    const args = e.args.trim()
    if (args.toLowerCase() === 'clear') {
      await clearExchanges($)
      return {}
    }
    // A bare /aside toggles the pane; a question always shows it.
    if (args.toLowerCase() === 'hide' || (args === '' && runtime.isOpen)) {
      await hidePane($)
      return {}
    }
    await openPane($)
    await ask($, args)
    return {}
  })

  // The person may close it with its mark or ctrl+x x; remember, so the next /aside shows it rather than hides it.
  on('ui.close', { id: ASIDE_PANE }, async ($, e, next) => {
    runtime.isOpen = false
    return next(e)
  })

  // Questions that found nothing to fork (quick answers off) are answered once Claude's reply ends.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && runtime.waiting.length > 0) {
      const waiting = runtime.waiting
      runtime.waiting = []
      for (const id of waiting) {
        await patch($, id, { isWaiting: false })
        void answer($, id).catch(() => undefined)
      }
    }
    return next(e)
  })

  // The pane's input and buttons are answered here, not in the elements' closures: a closure belongs to one drawing,
  // and a press or Enter that lands while an answer redraws the pane would find it gone.
  on('ui.input', { plugin: 'calm-aside', element: 'question' }, async ($, e, next) => {
    if (e.kind !== 'submit') return next(e)
    await ask($, e.value)
    return { element: e.element, value: e.value }
  })

  on('ui.press', { plugin: 'calm-aside' }, async ($, e, next) => {
    if (e.element === 'aside-clear') {
      await clearExchanges($)
      return { element: e.element }
    }
    if (e.element === 'aside-close') {
      await hidePane($)
      return { element: e.element }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: ASIDE_PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // Every surface but mobile has an input box; there, /aside <question> asks.
    const Input = 'Input' in elements ? elements.Input : undefined
    const settings = await read($, settingsAtom)
    const exchanges = await read($, exchangesAtom)
    const theme = themeOf(settings)
    const width = Math.max(20, e.props.bodyColumns - 1)
    const shown = exchanges.slice(-settings.maxHistory)
    const pending = exchanges.filter(x => x.answer === null).length
    const count = `${exchanges.length} question${exchanges.length === 1 ? '' : 's'}${pending > 0 ? `${theme.sep}${pending} pending` : ''}`
    return (
      <Box flexDirection="column" width={width}>
        <Text bold color={theme.title ?? theme.accent} wrap="truncate">
          {`↪ ${theme.shout('Aside')}${theme.sep}${exchanges.length === 0 ? 'read-only side chat' : count}`}
        </Text>
        {exchanges.length === 0 ? (
          <Text dimColor wrap="wrap">
            Ask about this session. Claude never sees these questions, and the answers cannot use tools or change files.
          </Text>
        ) : null}
        {shown.map(x => {
          const cost = settings.showCost ? costLine(x, theme.sep) : null
          return (
            <Box key={`x-${x.id}`} flexDirection="column" width={width}>
              <Text dimColor wrap="truncate">
                {theme.rule.repeat(width)}
              </Text>
              <Text bold color={theme.accent} wrap="wrap">
                {`${theme.shout('You')}: ${x.question}`}
              </Text>
              {x.answer === null ? (
                <Text dimColor>{x.isWaiting === true ? 'waiting for Claude’s reply to end…' : 'thinking…'}</Text>
              ) : (
                <Text wrap="wrap" color={x.kind === 'error' ? theme.warn : undefined}>
                  {x.answer}
                </Text>
              )}
              {cost === null ? null : (
                <Text dimColor wrap="truncate">
                  {cost}
                </Text>
              )}
            </Box>
          )
        })}
        <Box flexDirection="column" marginTop={1} width={width}>
          {Input === undefined ? (
            <Text dimColor>Type /aside and your question to ask.</Text>
          ) : (
            <Input
              key="question"
              label="> "
              placeholder={e.props.isFocused ? 'Ask about this session, Enter to send, Esc to leave' : 'click here to ask, or type /aside twice'}
              value=""
              submitLabel="ask"
              autoFocus
              onSubmit={() => undefined}
            />
          )}
          <Box flexDirection="row" gap={1}>
            <Button key="aside-clear" label="Clear" onPress={() => undefined} />
            <Button key="aside-close" label="Hide" onPress={() => undefined} />
          </Box>
        </Box>
      </Box>
    )
  })
}
