import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { chatText, costLine, normalizeSettings, promptFor, shortCount, shortTime } from './calm-aside'

const PANE = {
  plugin: 'calm-aside',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'calm-aside',
  props: { title: 'Aside', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } },
} as const

const FORKED = {
  value: {
    isAnswered: true,
    text: 'It edited src/auth/session.ts; the tests are untouched.',
    usage: { input_tokens: 40, output_tokens: 12, cache_read_input_tokens: 72_848, cache_creation_input_tokens: 202 },
  },
}

type World = { forks: string[]; completes: string[]; opens: number; closes: number; settle: () => Promise<void> }

/** The world beneath the plugin: a session, a fork that answers (or has nothing to fork), a quick model. */
async function start($: Engine, on: On, fork: 'answers' | 'nothing' = 'answers'): Promise<World> {
  const clock = mock.clock(on, { now: 1_000_000 })
  // Answers run unawaited after the command returns; a tick of the mocked clock lets them land.
  const world: World = { forks: [], completes: [], opens: 0, closes: 0, settle: async () => { await clock.advance(1) } }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }) as never)
  on('command.run', () => ({ text: '' }))
  on('ui.open', () => {
    world.opens += 1
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', () => {
    world.closes += 1
    return { value: undefined } as never
  })
  on('model.fork', (_$, e) => {
    world.forks.push((e as unknown as { prompt: string }).prompt)
    return (fork === 'answers' ? FORKED : { value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never
  })
  on('model.complete', (_$, e) => {
    world.completes.push(String((e as unknown as { prompt: string }).prompt))
    return { value: { isAnswered: true, text: 'Nothing has been edited yet.', usage: {} } } as never
  })
  on('session.messages', () => ({ value: [{ role: 'user', text: 'refactor the auth middleware', toolUses: [] }] }) as never)
  await $.session.start({ cwd: '', surface: 'terminal', isInteractive: true })
  return world
}

test('helpers: short counts and times, the cost line, settings', () => {
  expect(shortCount(242)).toBe('242')
  expect(shortCount(72_848)).toBe('72.8k')
  expect(shortTime(840)).toBe('840 ms')
  expect(shortTime(1244)).toBe('1.2 s')
  const base = { id: 1, question: 'q', answer: 'a', askedAt: 0, tookMs: 1244 }
  expect(costLine({ ...base, kind: 'fork', usage: { read: 72_848, added: 242, out: 100 } }, ' · ')).toBe(
    'fork · 1.2 s · cache 72.8k · new 242 · out 100',
  )
  expect(costLine({ ...base, kind: 'quick', sentChars: 5120 }, ' // ')).toBe('quick // 1.2 s // 5,120 chars sent, not cached')
  expect(costLine({ ...base, kind: 'error' }, ' · ')).toBeNull()
  expect(costLine({ ...base, answer: null }, ' · ')).toBeNull()
  expect(normalizeSettings({ maxHistory: 500, liveModel: '  ', cyberpunk: 'yes' })).toEqual({
    cyberpunk: false,
    showCost: true,
    liveFallback: true,
    liveModel: 'haiku',
    maxHistory: 50,
  })
})

test('the prompt carries earlier answered side questions, newest last, at most maxHistory', () => {
  const earlier = [
    { id: 1, question: 'one?', answer: 'first', askedAt: 0, kind: 'fork' as const },
    { id: 2, question: 'two?', answer: '(no answer: boom)', askedAt: 0, kind: 'error' as const },
    { id: 3, question: 'three?', answer: 'third', askedAt: 0, kind: 'quick' as const },
  ]
  const prompt = promptFor('four?', earlier, 1)
  expect(prompt).toContain('Q: three?\nA: third')
  expect(prompt).not.toContain('one?')
  expect(prompt).not.toContain('boom')
  expect(prompt.endsWith('Side question: four?')).toBe(true)
  // The fork's transcript ends with the latest main-chat message unanswered; the prompt must say not to answer it.
  expect(prompt).toContain('Answer ONLY the side question')
  expect(prompt).toContain('Do not answer it')
  expect(chatText([{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }])).toBe('USER: hi\n\nASSISTANT: hello')
})

test('/aside with a question opens the pane and a fork answers it, with nothing sent to the chat', async ($, on) => {
  const world = await start($, on)
  const ran = await $.command.run({ command: 'aside', args: 'which files did it touch?' } as never)
  await world.settle()
  expect(ran).toEqual({})
  expect(world.opens).toBe(1)
  expect(world.forks.length).toBe(1)
  expect(world.forks[0]).toContain('Side question: which files did it touch?')
  const pane = await $.ui.mount(PANE as never)
  expect(await pane.find({ type: 'Text', text: /↪ Aside · 1 question$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /You: which files did it touch\?/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /src\/auth\/session\.ts/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^fork · .* · cache 72\.8k · new 242 · out 12$/ })).toBeDefined()
  await pane.unmount()
})

test('a question typed into the pane is asked; Clear empties it and Close closes it', async ($, on) => {
  const world = await start($, on)
  await $.command.run({ command: 'aside', args: '' } as never)
  expect(world.forks.length).toBe(0)
  const pane = await $.ui.mount(PANE as never)
  expect(await pane.find({ type: 'Text', text: /read-only side chat/ })).toBeDefined()
  // Mounted on the terminal, which has an input box (the PANE literal is cast, so the type cannot tell).
  await (pane as unknown as { input: (target: { key: string; text: string }) => Promise<unknown> }).input({ key: 'question', text: 'is it changing the tests?' })
  expect(world.forks.length).toBe(1)
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /You: is it changing the tests\?/ })).toBeDefined()
  await pane.press({ key: 'aside-clear' })
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /You:/ })).toBeUndefined()
  await pane.press({ key: 'aside-close' })
  expect(world.closes).toBe(1)
  await pane.unmount()
})

test('before the first reply a quick answer reads the chat text', async ($, on) => {
  const world = await start($, on, 'nothing')
  await $.command.run({ command: 'aside', args: 'what was asked?' } as never)
  await world.settle()
  expect(world.completes.length).toBe(1)
  expect(world.completes[0]).toContain('USER: refactor the auth middleware')
  const pane = await $.ui.mount(PANE as never)
  expect(await pane.find({ type: 'Text', text: /Nothing has been edited yet/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^quick · .* chars sent, not cached$/ })).toBeDefined()
  await pane.unmount()
})

test('with quick answers off the question waits for the reply to end', { options: { liveFallback: false } }, async ($, on) => {
  const world = await start($, on, 'nothing')
  await $.command.run({ command: 'aside', args: 'what was asked?' } as never)
  await world.settle()
  expect(world.completes.length).toBe(0)
  const pane = await $.ui.mount(PANE as never)
  expect(await pane.find({ type: 'Text', text: /waiting for Claude’s reply to end/ })).toBeDefined()
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await world.settle()
  expect(world.forks.length).toBe(2)
  await pane.unmount()
})

test('the Cyberpunk theme shouts the title and the cost line can be hidden', { options: { cyberpunk: true, showCost: false } }, async ($, on) => {
  const world = await start($, on)
  await $.command.run({ command: 'aside', args: 'which files?' } as never)
  await world.settle()
  const pane = await $.ui.mount(PANE as never)
  expect(await pane.find({ type: 'Text', text: /↪ ASIDE \/\/ 1 question$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /YOU: which files\?/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^fork/ })).toBeUndefined()
  await pane.unmount()
})

test('/aside clear empties the pane', async ($, on) => {
  const world = await start($, on)
  await $.command.run({ command: 'aside', args: 'which files?' } as never)
  await world.settle()
  await $.command.run({ command: 'aside', args: 'clear' } as never)
  const pane = await $.ui.mount(PANE as never)
  expect(await pane.find({ type: 'Text', text: /You:/ })).toBeUndefined()
  await pane.unmount()
})

test('a bare /aside hides an open pane and shows it again; /aside hide hides it', async ($, on) => {
  const world = await start($, on)
  await $.command.run({ command: 'aside', args: '' } as never)
  expect(world.opens).toBe(1)
  await $.command.run({ command: 'aside', args: '' } as never)
  expect(world.closes).toBe(1)
  await $.command.run({ command: 'aside', args: '' } as never)
  expect(world.opens).toBe(2)
  await $.command.run({ command: 'aside', args: 'hide' } as never)
  expect(world.closes).toBe(2)
  await $.command.run({ command: 'aside', args: '' } as never)
  await $.command.run({ command: 'aside', args: 'close' } as never)
  expect(world.closes).toBe(3)
  // A question always shows the pane, even when it is already up.
  await $.command.run({ command: 'aside', args: 'which files?' } as never)
  await $.command.run({ command: 'aside', args: 'and the tests?' } as never)
  await world.settle()
  expect(world.opens).toBe(5)
  expect(world.closes).toBe(3)
})
