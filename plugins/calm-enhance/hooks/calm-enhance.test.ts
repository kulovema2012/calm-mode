import { expect, test } from 'claude-code/testing'

import { SYSTEM, ember, isEnhanceable, lostPlaceholders, normalizeSettings, withEnhanceKey } from './calm-enhance'

const FOOTER = {
  plugin: 'calm-enhance',
  component: 'SessionMode',
  props: { modes: ['focus'] },
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

test('the ✨ Enhance button shows in the footer for a real draft, beside the mode labels', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'focus' })
  })
  on('prompt.edit', (_$, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
  const type = (before: string, text: string) =>
    // @ts-expect-error The kit raises prompt.edit as the composer does, but its $ type leaves it out
    $.prompt.edit({ origin: { kind: 'composer' }, text: before, cursor: before.length, start: 0, end: before.length, inputText: text })

  await type('', 'Yep')
  const short = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
  expect(await short.find({ key: 'enhance' })).toBeUndefined()
  await short.unmount()

  await type('Yep', 'do 1 and 2')
  const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
  expect(await ui.find({ key: 'enhance', text: '✨ Enhance' })).toBeDefined()
  // no hotkey, so the plain button reads just "✨ Enhance" (no "e:"); a bound chord presses it from the prompt
  expect((await ui.find({ key: 'enhance' }))?.props.hotkey).toBeUndefined()
  expect((await ui.find({ key: 'enhance' }))?.props.action).toBe('app:cycleDiffBase')
  expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
  await ui.unmount()
})

test('pressing ✨ Enhance in the footer rewrites the draft, then ↩ Revert brings it back', async ($, on) => {
  const filled: string[] = []
  let box = ''
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'focus' }))
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

  const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
  await ui.press({ key: 'enhance' })
  expect(filled.at(-1)).toBe('Do options 1 and 2 from your last answer.')
  await ui.unmount()

  const after = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
  expect(await after.find({ key: 'enhance', text: '↩ Revert' })).toBeDefined()
  await after.press({ key: 'enhance' })
  expect(filled.at(-1)).toBe('do 1 and 2')
  await after.unmount()
})

test('/enhance keys adds Ctrl+X then E and keeps every binding already there', () => {
  const fresh = withEnhanceKey(null)
  expect(fresh.outcome).toBe('added')
  expect(JSON.parse(fresh.text ?? '').bindings).toEqual([{ context: 'Global', bindings: { 'ctrl+x e': 'app:cycleDiffBase' } }])

  const mine = JSON.stringify({ bindings: [{ context: 'Chat', bindings: { 'ctrl+g': null } }, { context: 'Global', bindings: { 'ctrl+t': 'app:toggleTodos' } }] })
  const merged = JSON.parse(withEnhanceKey(mine).text ?? '')
  expect(merged.bindings[0]).toEqual({ context: 'Chat', bindings: { 'ctrl+g': null } })
  expect(merged.bindings[1]).toEqual({ context: 'Global', bindings: { 'ctrl+t': 'app:toggleTodos', 'ctrl+x e': 'app:cycleDiffBase' } })

  expect(withEnhanceKey(withEnhanceKey(null).text ?? '').outcome).toBe('already')
  expect(withEnhanceKey(JSON.stringify({ bindings: [{ context: 'Global', bindings: { 'ctrl+x e': 'app:toggleTodos' } }] }))).toEqual({ outcome: 'taken', takenBy: 'app:toggleTodos' })
  expect(withEnhanceKey('{ not json').outcome).toBe('unreadable')
})

test('/enhance keys writes the file through the command, and a second run changes nothing', async ($, on) => {
  const files = new Map<string, string>()
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? 'C:\\Users\\me' : undefined }) as never)
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }) as never)
  on('fs.read', (_$, e) => ({ value: files.get(e.path) }) as never)
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined } as never
  })
  const first = await $.command.run({ command: 'enhance', args: 'keys' } as never)
  expect(JSON.stringify(first)).toContain('Added: Ctrl+X then E')
  expect(files.get('C:\\Users\\me\\.claude\\keybindings.json')).toContain('"ctrl+x e": "app:cycleDiffBase"')
  const second = await $.command.run({ command: 'enhance', args: 'keys' } as never)
  expect(JSON.stringify(second)).toContain('already presses')
})
