import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import type { Checklist, ChecklistTask } from '../types'

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
} = {
  frameTimer: null,
  collapseTimer: null,
  failuresInARow: 0,
  isTurnRunning: false,
  lastApiError: null,
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

export function registerCalmMode(on: On): void {

  on('session.start', async ($, e, next) => {
    const stored = await $.store.get(STORE_KEY)
    await update($, enabledAtom, () => (typeof stored === 'boolean' ? stored : true))

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
      description: 'Turn Calm Mode on or off (no argument flips it)',
      argumentHint: '[on|off]',
      immediate: true,
    })

    return next(e)
  })

  on('command.run', { command: 'calm' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
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
      $.clock.after(0, () => {
        void nameJob($, jobId, text).catch(() => undefined)
      })
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
    return { result: `Planned ${names.length} steps. The first one has started.` }
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

  // Hide the technical rows while Calm Mode is on.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await read($, enabledAtom))) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await read($, enabledAtom))) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!(await read($, enabledAtom))) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (!(await read($, enabledAtom))) {
      return next(e)
    }
    return next({ ...e, props: { ...e.props, hint: '' } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    const isEnabled = await read($, enabledAtom)
    const list = isEnabled ? await read($, checklistAtom) : null
    const tick = list !== null && (list.phase === 'working' || list.phase === 'needsYou') ? await read($, tickAtom) : 0
    const now = await $.clock.now()
    const columns = Math.max(20, e.props.bodyColumns)

    const label = isEnabled ? '● Calm Mode: ON' : '○ Calm Mode: OFF'
    const toggle = (
      <Button
        key="calm-toggle"
        label={label}
        dimColor={!isEnabled}
        onPress={() => setEnabled($, !isEnabled)}
      />
    )
    const headerRoom = Math.max(4, columns - label.length - 5)

    if (list === null) {
      return (
        <Box flexDirection="row" justifyContent="flex-end" width={columns}>
          {toggle}
        </Box>
      )
    }

    const elapsed = formatDuration((list.finishedAt ?? now) - list.startedAt)
    const header = (() => {
      switch (list.phase) {
        case 'needsYou':
          return (
            <Text wrap="truncate">
              <Text inverse bold color="warning">
                {' Needs you '}
              </Text>
              <Text>{` ${list.needsYouReason ?? 'Claude needs your OK to continue'}`}</Text>
            </Text>
          )
        case 'stuck':
          return (
            <Text wrap="truncate" color="warning">
              {`⚠ Stuck: ${list.stuckReason ?? 'something went wrong'}`}
            </Text>
          )
        case 'stopped':
          return <Text wrap="truncate">{`■ Stopped · ${list.title} · you pressed Esc`}</Text>
        case 'done':
          return (
            <Text wrap="truncate" color="success">
              {`✓ All done · ${list.title} · took ${elapsed}`}
            </Text>
          )
        default:
          return (
            <Text wrap="truncate">
              <Text bold>{list.title}</Text>
              <Text dimColor>{` · ${elapsed}`}</Text>
            </Text>
          )
      }
    })()

    const headerRow = (
      <Box flexDirection="row" justifyContent="space-between" width={columns}>
        <Box width={headerRoom}>{header}</Box>
        {toggle}
      </Box>
    )

    if (list.isCollapsed) {
      return headerRow
    }

    // icon(2) + name + gap(1) + meter(10) + gap(2) + label(7)
    const nameWidth = Math.max(6, Math.min(NAME_LIMIT, columns - 2 - 1 - METER_CELLS - 2 - 7))
    const fit = (name: string) =>
      name.length > nameWidth ? `${name.slice(0, nameWidth - 1)}…` : name.padEnd(nameWidth)

    const firstUpcoming = list.tasks.findIndex(task => task.status === 'upcoming')

    const rows = list.tasks.map((task, i) => {
      if (task.status === 'done') {
        return (
          <Box key={`row-${task.id}`} flexDirection="row">
            <Text color="success">{'✓ '}</Text>
            <Text dimColor>{`${fit(task.name)} `}</Text>
            <Text color="success">{'█'.repeat(METER_CELLS)}</Text>
            <Text dimColor>{'  Done'}</Text>
          </Box>
        )
      }
      if (task.status === 'active') {
        const isPaused = list.phase === 'needsYou'
        const meter = task.hasReported
          ? '█'.repeat(Math.round(task.percent / 10)).padEnd(METER_CELLS, '░')
          : Array.from({ length: METER_CELLS }, (_, cell) =>
              (cell - (tick % METER_CELLS) + METER_CELLS) % METER_CELLS < 3 ? '█' : '░',
            ).join('')
        return (
          <Box key={`row-${task.id}`} flexDirection="row">
            <Text color="claude">{isPaused ? '‖ ' : '▶ '}</Text>
            <Text bold>{`${fit(task.name)} `}</Text>
            <Text color="claude">{meter}</Text>
            <Text>{task.hasReported ? `  ${task.percent}%` : '  Working'}</Text>
          </Box>
        )
      }
      return (
        <Box key={`row-${task.id}`} flexDirection="row">
          <Text dimColor>{'○ '}</Text>
          <Text dimColor>{`${fit(task.name)} `}</Text>
          <Text dimColor>{'░'.repeat(METER_CELLS)}</Text>
          <Text dimColor>{i === firstUpcoming ? '  Next' : '  Up next'}</Text>
        </Box>
      )
    })

    return (
      <Box flexDirection="column" width={columns}>
        {headerRow}
        {rows}
      </Box>
    )
  })
}
