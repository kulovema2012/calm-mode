# Calm Enhance

An **Enhance** button at the right end of the hint line under the prompt (where `? for shortcuts` is). Type a short draft, press it, and the draft is rewritten into a precise prompt using the recent conversation. Press again (**Revert**) to get your draft back.

```
do 1 and 3 but not 2, also hide key shoud be numbr [Image #3]
```
becomes
```
Make these changes in both Calm Mode and Calm Recap, shipping Calm Mode as 0.20.2 and Calm Recap as 0.11.1:

1. Keep the suggestion list visible until the user actually sends something. Picking another
   suggestion replaces the current draft instead of adding to it.
2. Add `/calm next` (Calm Recap: `/recap next`) to show the last suggestion list again at any time.

Do not make the Esc-brings-the-list-back change (the previous option 2).

Also change the key that hides the list so it is a number key, as shown in this screenshot: [Image #3].
```

## Install

Run these in Claude Code (the first line only if you have not added the calm-mode marketplace yet):

```
/plugin marketplace add kulovema2012/calm-mode
/plugin install calm-enhance@calm-mode
```

Then `/reload-plugins`. From a terminal: `claude plugin marketplace add kulovema2012/calm-mode` and `claude plugin install calm-enhance@calm-mode`. The installer may say "1 userConfig option not yet set": that is the model, and it uses Sonnet until you pick one (see Settings).

To update later: `claude plugin marketplace update calm-mode`, then `claude plugin update calm-enhance@calm-mode`, then `/reload-plugins`.

## While it works

A slow wave of red, dark red, black and gray runs across your draft in the prompt box while the model rewrites it, and the hint line under the prompt says **Enhancing with Sonnet…** (or Haiku). When the rewrite lands the wave stops and the new text replaces the draft. If you start typing, the wave stops at once and your typing wins: the rewrite is dropped and a toast says your version was kept. A draft too short to enhance flashes red instead.

## What it does to a draft

- **Numbered picks become the real work.** "do 1 and 2", "the second one", "all three" or "yes" to an offer are written out as the options from Claude's last answer. The last answer gets extra room (6,000 characters) so a long list of options is not cut off.
- **Vague words get specific.** "this", "that error", "the other plugin" become the exact file, error, version or step the conversation points to.
- **Pasted text and images are kept.** Every `[Pasted text #N …]` and `[Image #N]` placeholder must come back unchanged. If the rewrite loses one, your draft stays as it was and a toast says which one, because the pasted content would be lost with it.
- **Any format that makes it precise.** One sentence, numbered steps, or short labelled parts; precision over brevity, with no padding.
- **An unclear draft asks to be interviewed.** When a draft could mean different things and the conversation doesn't settle which ("make it better"), the rewrite keeps what is clear and ends with "Before you start, interview me with questions until you understand comprehensively what I want.", so Claude asks before guessing.
- Typos fixed, your language kept (a Thai draft stays Thai), and decisions already made carried over. A draft that is already clear comes back with only typo fixes.

The button shows once the draft has at least two words and ten characters, so "Yep" or "Go ahead" get none.

## Keys

- **Ctrl+E**, after a one-time setup: add this to `~/.claude/keybindings.json` (run `/keybindings` to open it):
  ```json
  {
    "bindings": [
      { "context": "Global", "bindings": { "ctrl+e": "app:cycleDiffBase" } }
    ]
  }
  ```
  `app:cycleDiffBase` is only used by the `/diff` panel, so it is free at the prompt. While the button shows, Ctrl+E no longer jumps to the end of the line (End still does).
- Without the binding: **Ctrl+X Tab**, then **E**. Or click the button.
- A number key cannot work here: the button is for a box that already holds your draft, and a digit typed there just goes into the draft.

## Settings

`/config` → Calm Enhance → **Model**: `sonnet` (default) or `haiku`. Sonnet is better at working out which option or file a short draft means; in a test on a real draft Haiku added a detail that was never said, so use it only if speed matters more.

## Good to know

- One model call per press, through your own Claude Code account. It sends the draft and the last 10 messages (each up to 2,000 characters, the last reply up to 6,000, 16,000 in all; tool calls by name and file or command).
- If you keep typing while it works, your version stays.
- It works in the terminal. The desktop app draws its own prompt box, which a plugin cannot read or fill, so expect it not to work there (no button press can reach the draft, and the wave cannot be drawn).
- Pressing it again right after a rewrite gives **Revert**, which brings your draft back. Editing the rewritten text, or sending it, accepts the rewrite and the next press enhances again.
- Its button sits at the right end of the bottom line, the hint line under the prompt (the status line section itself takes only plain text from a plugin, so a clickable button cannot go there), so a tall band above the prompt (Calm Mode's checklist, a recap) never pushes it out of view, and Claude Code's own hints stay on the left. It shows only while the box holds a draft.

## Credit

Adapted from [cc-prompt-enhance-mod](https://github.com/yibudak/cc-prompt-enhance-mod) by Yigit Budak, MIT licence (Copyright (c) 2026 Yigit Budak). Changes: numbered-option and placeholder handling, the placeholder check, free format, a model setting, more room for the last reply, and keeping the bands beneath it.
