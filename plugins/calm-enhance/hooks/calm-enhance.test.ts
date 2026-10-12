import { expect, test } from 'claude-code/testing'

import { SYSTEM, ember, isEnhanceable, lostPlaceholders, normalizeSettings } from './calm-enhance'

const HINT = {
  plugin: 'calm-enhance',
  component: 'PromptHint',
  props: { isDraft: true, isWorking: false, hint: '? for shortcuts' },
} as const

test('the gate: two words and ten characters, so "Yep" gets no button but "do 1 and 2" does', () => {
  for (const text of ['', 'Yep', 'Go ahead', 'Go.', 'fix it']) {
    expect(isEnhanceable(text)).toBe(false)
  }
  for (const text of ['do 1 and 2', 'fix that error', 'yes and look at this [Image #2]']) {
    expect(isEnhanceable(text)).toBe(true)
  }
})

test('a rewrite that drops a pasted block or image is caught', () => {
  const draft = 'look at [Pasted text #2 +4 lines] and [Image #5] then fix it'
  expect(lostPlaceholders(draft, 'Fix the bug shown in [Pasted text #2 +4 lines] and [Image #5].')).toEqual([])
  expect(lostPlaceholders(draft, 'Fix the bug in the pasted log.')).toEqual(['[Pasted text #2 +4 lines]', '[Image #5]'])
  expect(lostPlaceholders('no placeholders here', 'anything')).toEqual([])
})

test('settings: Sonnet unless Haiku is chosen', () => {
  expect(normalizeSettings(undefined).model).toBe('sonnet')
  expect(normalizeSettings({ model: 'haiku' }).model).toBe('haiku')
  expect(normalizeSettings({ model: 'gpt' }).model).toBe('sonnet')
})

test('the instructions cover numbered picks, placeholders, Thai and free format', () => {
  expect(SYSTEM).toContain('do 1 and 2')
  expect(SYSTEM).toContain('[Pasted text #N ...] or [Image #N]')
  expect(SYSTEM).toContain('A Thai draft stays Thai')
  expect(SYSTEM).toContain('Precision matters more than brevity')
  expect(SYSTEM).toContain('interview me with questions until you understand comprehensively what I want')
})

test('the wave paints every character and moves one step per frame', () => {
  const first = ember('x'.repeat(40), 0)
  const next = ember('x'.repeat(40), 1)
  expect(first.length).toBe(40)
  for (let i = 1; i < first.length; i++) {
    expect(next[i]?.backgroundColor).toBe(first[i - 1]?.backgroundColor)
  }
})

test('the button shows at the right of the hint line for a real draft, and keeps the line itself', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: '? for shortcuts' })
  })
  on('prompt.edit', (_$, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
  const type = (before: string, text: string) =>
    // @ts-expect-error The kit raises prompt.edit as the composer does, but its $ type leaves it out
    $.prompt.edit({ origin: { kind: 'composer' }, text: before, cursor: before.length, start: 0, end: before.length, inputText: text })

  await type('', 'Yep')
  const short = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await short.find({ key: 'enhance' })).toBeUndefined()
  await short.unmount()

  await type('Yep', 'do 1 and 2')
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await ui.find({ key: 'enhance', text: /^Enhance/ })).toBeDefined()
  expect(JSON.stringify(await ui.find({ key: 'enhance' }))).toContain('"hotkey":"e"')
  expect(await ui.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()
  await ui.unmount()
})

test('pressing the button on the hint line enhances the draft, then Revert brings it back', async ($, on) => {
  const filled: string[] = []
  let box = ''
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: '? for shortcuts' }))
  on('prompt.edit', (_$, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Do options 1 and 2 from your last answer.' } }) as never)
  on('prompt.fill', (_$, e) => {
    box = e.text
    filled.push(e.text)
    return { isFilled: true, text: e.text } as never
  })
  on('prompt.read', () => ({ value: { text: box } }) as never)
  on('session.messages', () => ({ value: [] }) as never)
  on('clock.sleep', () => ({ value: undefined }) as never)
  // @ts-expect-error The kit raises prompt.edit as the composer does, but its $ type leaves it out
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'do 1 and 2' })
  box = 'do 1 and 2'

  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  await ui.press({ key: 'enhance' })
  expect(filled.at(-1)).toBe('Do options 1 and 2 from your last answer.')
  await ui.unmount()

  const after = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await after.find({ key: 'enhance', text: /^Revert/ })).toBeDefined()
  await after.press({ key: 'enhance' })
  expect(filled.at(-1)).toBe('do 1 and 2')
  await after.unmount()
})
