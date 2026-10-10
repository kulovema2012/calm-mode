# Calm Aside

A read-only side chat about your Claude Code session, in Calm Mode's look. Ask "which files has it changed?" or "is it going to touch the tests?" while Claude works, without interrupting it and without Claude ever seeing the question.

```
↪ Aside · 2 questions
────────────────────────────────────────────────────────────
You: which files has it touched so far?
src/auth/session.ts and src/auth/index.ts; the tests are untouched.
fork · 1.2 s · cache 72.8k · new 242 · out 100
────────────────────────────────────────────────────────────
You: is it planning to change the tests?
thinking…
> _
[ Clear ] [ Hide ]
```

It works on its own or beside [Calm Mode](../../README.md) or [Calm Recap](../calm-recap/README.md): it draws only its own pane, not the band.

## Install

```
/plugin install calm-aside@calm-mode
```

If you have not added the marketplace yet: `/plugin marketplace add kulovema2012/calm-mode` first. Start a new session afterwards, or type `/reload-plugins`.

## Use

| | |
|---|---|
| `/aside` | Show the pane, or hide it when it is up (your questions stay) |
| `/aside what has changed so far?` | Open it and ask at once |
| `/aside hide` | Hide the pane |
| `/aside clear` | Empty the pane |
| **Enter** in the pane | Ask what you typed |
| **Esc** | Give the keys back to the main prompt (the pane stays) |
| **Click the box**, or `/aside` twice | Go back to the pane's box |
| **Clear** / **Hide** | Empty the pane / hide it |

The pane opens with the cursor in its question box. Claude Code cannot bind a key to a slash command, so there is no hotkey to open it: `/as`, Tab, Enter is the quickest way. On a terminal narrower than about 110 columns it opens above the prompt instead of beside the chat.

## How it answers

Each question is a **fork** of your session: a hidden copy of the conversation as of Claude's last finished reply, with your question added. The fork cannot use tools and is never added to the chat, so:

- **Claude never sees it.** The main chat does not get your side questions or their answers, so they cannot steer the work.
- **You can ask while Claude is busy.** The answer covers everything up to Claude's last finished reply, not the half-done step it is on.
- **It is cheap.** The fork reads the conversation from the prompt cache the main chat already paid for, plus your question.

Before Claude has answered even once there is nothing to fork yet. Then a small model (Haiku by default) answers from the chat's text, marked `quick`; or, with **Answer before the first reply** off, the question waits until Claude's reply ends.

The dim line under each answer says where it came from and what it cost:

- `fork · 1.2 s · cache 72.8k · new 242 · out 100`: 72,800 tokens read from the cache, 242 new ones, 100 written out.
- `quick · 0.8 s · 5,120 chars sent, not cached`: a quick answer from the chat's text.

On a subscription a question uses about as much of your limit as one short message in that session; on the API a fork costs roughly the session's size at the cache-read price (about $0.05 for a 240k-token Opus 5.5 session).

## Settings

Under `/plugin` → Calm Aside → Configure, or `pluginConfigs["calm-aside@calm-mode"].options` in `settings.json`:

| Setting | Default | |
|---|---|---|
| Cyberpunk theme | off | Neon pink title, cyan accents, `//` separators, like Calm Mode's Cyberpunk theme |
| Show cost line | on | The dim line under each answer |
| Answer before the first reply | on | Quick answers from the chat's text before Claude has replied once |
| Model for quick answers | `haiku` | Any `--model` value; forks always use the session's own model |
| Side questions kept | 8 | Earlier questions shown, and sent along with each new one (1 to 50) |

## What "read-only" means

`claude plugin validate plugins/calm-aside --strict` lists every call the plugin can make:

```
calls: $.clock.now, $.command.register, $.model.complete, $.model.fork, $.session.messages,
       $.state.get, $.state.set, $.ui.close, $.ui.open, $.ui.resolve
```

No file, command, network, storage, tool or prompt calls: it cannot read or change your files, run anything, or type into the main chat. The `/aside` command answers with nothing, since a text answer would land in the chat where Claude reads it.

## Credits

Calm Aside is based on [aside](https://github.com/JayDoubleu/aside) by JayDoubleu, rebuilt on Calm Mode's look and code style: themes, a question box that has the cursor when the pane opens, `/aside clear`, and a shorter cost line. aside is released under the MIT License:

```
MIT License

Copyright (c) 2026 JayDoubleu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Made by Newk.
