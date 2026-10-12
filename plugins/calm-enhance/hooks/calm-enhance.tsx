// Calm Enhance: an Enhance button above the prompt. Adapted from cc-prompt-enhance-mod by Yigit Budak
// (MIT, github.com/yibudak/cc-prompt-enhance-mod), tuned for someone who writes short replies that lean on
// the conversation: "do 1 and 2", "fix that", "yes, ship it", often with pasted blocks and images.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, SessionMessage } from 'claude-code'

import type { EnhanceSettings } from '../types'

type Engine = EngineInterface

const RECENT_MESSAGES = 10
const MESSAGE_CHARS = 2000
/** The last reply gets more room: it is where the numbered options a short answer picks from usually are. */
const LAST_REPLY_CHARS = 6000
const CONTEXT_CHARS = 16000

const hasDraftAtom = atom({ plugin: 'calm-enhance', key: 'hasDraft' } as const, false)
const isBusyAtom = atom({ plugin: 'calm-enhance', key: 'isBusy' } as const, false)
const previousAtom = atom({ plugin: 'calm-enhance', key: 'previous' } as const, null)

export function normalizeSettings(options: unknown): EnhanceSettings {
  const raw = (typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>
  return { model: raw.model === 'haiku' ? 'haiku' : 'sonnet' }
}

export const SYSTEM = `You rewrite a developer's draft prompt for Claude Code into the prompt they would have written with more time and the whole session in view.
The result is sent to Claude Code as is, in place of the draft, so it has to stand on its own: a teammate who missed the conversation should be able to act on it without asking anything. Claude does its best work from a clear goal, the reason behind it, concrete references and a visible finish line, so those are what you add.

This author writes short drafts that lean on the conversation: replies to a list of options ("do 1 and 2", "option 3", "both"), confirmations ("yes, go ahead", "ship it"), pointers ("fix that", "same for the other plugin"), with typos, and sometimes in Thai.

You get the recent conversation, then the draft.

<how_to_enhance>
1. Keep the author's intent, scope and language. The draft says what they want; the conversation supplies the specifics. A Thai draft stays Thai.
2. When the draft picks from numbered or listed options in the assistant's last message ("do 1 and 2", "the second one", "all three", "yes" to a single offer), write out what each chosen option is, so the prompt names the actual work instead of a number.
3. Resolve vague references ("this", "that file", "the error", "the other plugin", "like before") to the exact path, symbol, command, error message, version or earlier decision the conversation points to. Put code, paths and commands in backticks.
4. State the goal plainly. When the conversation shows why it matters, add the reason in a clause.
5. When the conversation shows how to tell the work is done (a test, a command, a version to ship, an observable behavior), name it.
6. Carry over constraints the conversation already settled, such as files to leave alone, an approach that was rejected, or a style or version to match, so Claude doesn't reopen them.
7. Fix typos and grammar, and phrase instructions as what to do rather than what to avoid.
</how_to_enhance>

<format>
Use whatever shape makes the prompt most precise: one sentence, a numbered list of steps in the order the work should happen, or a few short labelled parts (goal, details, done when). Precision matters more than brevity; length follows from what needs saying. Add no padding: nothing that does not change what Claude will do.
</format>

<boundaries>
- Every sentence you add traces back to the draft or the conversation. Where the draft leaves a real choice open and the conversation doesn't settle it, leave it open or turn it into a question for Claude to raise; the choice is the author's.
- Copy every placeholder of the form [Pasted text #N ...] or [Image #N] into the result exactly as written, character for character, in a sensible place. They stand for content you cannot see, and the prompt breaks without them.
- Leave out filler Claude Code already acts on by default: role lines ("You are an expert..."), "think step by step", "double-check your work", "be thorough", and requests to explain its reasoning.
- Write in a calm, plain tone, without capital-letter emphasis or words like CRITICAL and MUST.
- A draft that is already specific comes back with only typo fixes.
</boundaries>

<output_format>
Output only the enhanced prompt, in the author's voice, as the message they will send: no preamble, no explanation, no quotes, and no code fence around it.
</output_format>

<examples>
<example>
<conversation>
[user] the band cuts off the subagent sign, how should we fix it?

[assistant] Two options:
1. Move the sign onto the current step's row, which has room.
2. Shorten it to "◐ 2" in the header.
3. Hide the weather while subagents run.
Want me to do one of these?
</conversation>
<draft>
do 1 and 2
</draft>
<enhanced>
Fix the subagent sign being cut off in the band:
1. Move the full sign onto the current step's row, which has room.
2. Keep a short "◐ 2" in the header for when no step row shows it.

Leave the weather as it is.
</enhanced>
</example>

<example>
<conversation>
[user] run the tests
(tools: Bash python -m pytest)

[assistant] 1 failed: tests/test_users.py::TestUsers::test_create_user raised KeyError: 'mail' at app/users.py:2, where create_user reads data['mail'] but the test posts 'email'.
</conversation>
<draft>
fix that error so the test pases
</draft>
<enhanced>
Fix the \`KeyError: 'mail'\` in \`create_user\` at \`app/users.py:2\`: it reads \`data['mail']\` but the test posts \`email\`. Done means \`tests/test_users.py::TestUsers::test_create_user\` passes under \`python -m pytest\`.
</enhanced>
</example>

<example>
<conversation>
[assistant] Calm Mode 0.20.1 is pushed. Calm Recap is still on 0.10.7 and has no Next steps yet. Want me to add it there as 0.11.0?
</conversation>
<draft>
yes and look at this [Image #2]
</draft>
<enhanced>
Yes: add Next steps to Calm Recap and ship it as 0.11.0. Also look at this screenshot: [Image #2]
</enhanced>
</example>

<example>
<conversation>
(none yet)
</conversation>
<draft>
Rename getUser to fetchUser in src/api/users.ts and update every caller.
</draft>
<enhanced>
Rename \`getUser\` to \`fetchUser\` in \`src/api/users.ts\` and update every caller.
</enhanced>
</example>
</examples>`

/** The one gate for the button and enhancing: two or more words and ten or more characters. */
export const isEnhanceable = (text: string) => text.trim().split(/\s+/).length >= 2 && text.trim().length >= 10

const PLACEHOLDER = /\[(?:Pasted text #\d+[^\]]*|Image #\d+)\]/g

/** Placeholders for pasted text and images in the draft that the rewrite left out; empty when all survived. */
export function lostPlaceholders(draft: string, enhanced: string): string[] {
  return [...new Set(draft.match(PLACEHOLDER) ?? [])].filter(token => !enhanced.includes(token))
}

// A slow ember wave while the model works, all xterm 256-color entries so a 256-color terminal shows the same
// colors as a truecolor one. Every step is dark enough for white text.
const EMBER = [
  '#d70000', '#af0000', '#870000', '#5f0000',
  '#121212', '#262626', '#3a3a3a', '#4e4e4e', '#626262', '#6c6c6c',
  '#626262', '#4e4e4e', '#3a3a3a', '#262626', '#121212',
  '#5f0000', '#870000', '#af0000',
]
const FRAME_MS = 100

/** One background per character, shifted one step right each frame. */
export const ember = (text: string, frame: number) =>
  Array.from({ length: text.length }, (_, i) => ({
    start: i,
    end: i + 1,
    backgroundColor: EMBER[(i - (frame % EMBER.length) + EMBER.length) % EMBER.length],
    color: '#ffffff',
  }))

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

const describe = (message: SessionMessage, max: number) => {
  const tools = message.toolUses.map(use => {
    const target = use.input.file_path ?? use.input.command ?? use.input.path
    return typeof target === 'string' ? `${use.tool} ${clip(target, 200)}` : use.tool
  })
  return `[${message.role}] ${clip(message.text, max)}${tools.length > 0 ? `\n(tools: ${tools.join('; ')})` : ''}`
}

/** The recent conversation as the model reads it; the last assistant reply is kept longer than the rest. */
async function conversation($: Engine): Promise<string> {
  const rows = (await $.session.messages()).filter(message => message.text.trim() !== '').slice(-RECENT_MESSAGES)
  const lastReply = rows.map(message => message.role).lastIndexOf('assistant')
  const text = rows.map((message, i) => describe(message, i === lastReply ? LAST_REPLY_CHARS : MESSAGE_CHARS)).join('\n\n')
  return text.length > CONTEXT_CHARS ? `…${text.slice(-CONTEXT_CHARS)}` : text
}

const unfence = (text: string) => text.trim().replace(/^```[^\n]*\n([\s\S]*?)\n```$/, '$1').trim()

async function enhance($: Engine, settings: EnhanceSettings) {
  if (await read($, isBusyAtom)) {
    return
  }
  const draft = (await $.prompt.read()).text
  if (!isEnhanceable(draft)) {
    // The next edit's answer carries no decorations, so the red clears itself.
    await $.prompt.fill({ text: draft, decorations: [{ start: 0, end: draft.length, backgroundColor: 'red' }] })
    $.ui.toast('This prompt is too short to enhance')
    return
  }
  await update($, isBusyAtom, () => true)
  try {
    let isDone = false
    // Repaints only while the box still holds the draft, so typing stops it.
    const painting = (async () => {
      for (let frame = 0; !isDone; frame++) {
        if ((await $.prompt.read()).text === draft) {
          await $.prompt.fill({ text: draft, decorations: ember(draft, frame) })
        }
        await $.clock.sleep(FRAME_MS)
      }
    })()

    const reply = await $.model
      .complete({
        model: settings.model,
        system: SYSTEM,
        prompt: `<conversation>\n${(await conversation($)) || '(none yet)'}\n</conversation>\n\n<draft>\n${draft}\n</draft>`,
        maxTokens: 4096,
        timeoutMs: 60000,
      })
      .finally(() => {
        // Stopped before the result lands, so no late frame paints over it.
        isDone = true
        return painting
      })
    if (!reply.isAnswered) {
      const detail = reply.reason === 'api-error' ? ` (${reply.status ?? 'no response'}, ${reply.error})` : ''
      $.ui.toast(`Enhance failed: ${reply.reason}${detail}`)
      return
    }

    const text = unfence(reply.text)
    const lost = lostPlaceholders(draft, text)
    if (lost.length > 0) {
      // The pasted block or image behind a placeholder would be lost with it, so the draft stays.
      $.ui.toast(`Kept your draft: the rewrite dropped ${lost.join(', ')}`)
      return
    }
    if ((await $.prompt.read()).text !== draft) {
      $.ui.toast('Draft changed while enhancing; kept your version')
      return
    }
    const filled = await $.prompt.fill({ text, mode: 'replace' })
    if (!filled.isFilled) {
      $.ui.toast('Could not replace the draft')
      return
    }
    await update($, previousAtom, () => draft)
    await update($, hasDraftAtom, () => isEnhanceable(filled.text))
  } finally {
    // Clears the animation on every path that left the draft in the box.
    if ((await $.prompt.read()).text === draft) {
      await $.prompt.fill({ text: draft })
    }
    await update($, isBusyAtom, () => false)
  }
}

async function revert($: Engine) {
  const text = await read($, previousAtom)
  if (text === null) {
    return
  }
  const filled = await $.prompt.fill({ text, mode: 'replace' })
  if (!filled.isFilled) {
    return
  }
  await update($, previousAtom, () => null)
  await update($, hasDraftAtom, () => isEnhanceable(text))
}

export function registerCalmEnhance(on: On, options?: unknown): void {
  const settings = normalizeSettings(options)

  on('session.start', async ($, e, next) => {
    const text = (await $.prompt.read()).text
    await update($, hasDraftAtom, () => isEnhanceable(text))
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const result = await next(e)
    if (result.text === e.text) {
      return result
    }
    const isDraft = isEnhanceable(result.text)
    if (isDraft !== (await read($, hasDraftAtom))) {
      await update($, hasDraftAtom, () => isDraft)
    }
    // Editing the enhanced text accepts it: the next press enhances again.
    if ((await read($, previousAtom)) !== null) {
      await update($, previousAtom, () => null)
    }
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer') {
      await update($, hasDraftAtom, () => false)
      await update($, previousAtom, () => null)
    }
    return next(e)
  })

  // The button sits at the right end of the hint line under the prompt (`? for shortcuts`), where a tall band
  // above the prompt can never push it out of view; the engine's own line, pills and all, stays on its left.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const isBusy = await read($, isBusyAtom)
    const hasDraft = await read($, hasDraftAtom)
    // Revert stays reachable even if the enhanced text is blank.
    const canRevert = (await read($, previousAtom)) !== null
    if (!isBusy && !hasDraft && !canRevert) {
      return next(e)
    }
    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const modelName = settings.model === 'haiku' ? 'Haiku' : 'Sonnet'
    if (isBusy) {
      return (
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexShrink={1}>{below}</Box>
          <Text dimColor>{` Enhancing with ${modelName}…`}</Text>
        </Box>
      )
    }
    // ctrl+e is bound to this action in ~/.claude/keybindings.json; without it, ctrl+x tab then e.
    return (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexShrink={1}>{below}</Box>
        <Box flexShrink={0}>
          <Button
            key="enhance"
            label={`${canRevert ? 'Revert' : 'Enhance'}${e.surface === 'terminal' ? ' ⌃E' : ''}`}
            hotkey="e"
            action="app:cycleDiffBase"
            variant={canRevert ? 'secondary' : 'primary'}
            onPress={() => (canRevert ? revert($) : enhance($, settings))}
          />
        </Box>
      </Box>
    )
  })
}
