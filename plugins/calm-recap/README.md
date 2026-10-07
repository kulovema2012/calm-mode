# Calm Recap

The Welcome back card and the prompt-cache meter from [Calm Mode](../../README.md), on their own: no checklist, no plan-first rule, no hidden tool rows. Your Claude Code looks exactly as usual until you step away.

```
↩ Welcome back · away 18m                    ⚙ [ ● Calm Recap: ON ]
────────────────────────────────────────────────────────────────
✓ Answered · took 1m 30s
────────────────────────────────────────────────────────────────
What Claude did
  • Made the pricing cards blue
  ➜ Needs you: send the logo file for the footer
────────────────────────────────────────────────────────────────
You last asked
    "make the pricing cards blue"
                                                      [ Got it ]
```

## Install

In a Claude Code terminal session:

```
/plugin install calm-recap --marketplace kulovema2012/calm-mode
```

Install **Calm Recap or Calm Mode, not both**: both draw the band above the prompt, and Calm Mode already includes everything Calm Recap does.

## What it does

- **Welcome back card.** When Claude has answered and you stay quiet for a while (5 minutes by default), the band above the prompt shows how the answer ended, what Claude did in up to three short points written by Haiku (anything waiting on you is highlighted with ➜), and what you last asked. Press **Got it** or type your next message to clear it.
- **After `claude --resume`** the card appears straight away, rebuilt from the saved conversation, with a warning when the prompt cache has expired.
- **`/recap`** shows the card any time.
- **Cache meter** in your status line, at its right end: `⚡ cache 87% ▰▰▰▰▰▰▰▰▱▱ 47m`, the share of the last request read from the prompt cache and a bar of the time left before it goes cold. Turn it on with `/recap statusline on` or the switch in the settings panel; it wraps your existing status line and `off` puts it back.

## Commands

| Command | Does |
|---|---|
| `/recap` | Show the Welcome back card now |
| `/recap on` / `/recap off` | Turn Calm Recap on or off (also the button on the band) |
| `/recap statusline on` / `off` | Add or remove the cache meter in your status line |

## Settings

Click **⚙** beside the on/off button. One tab at a time; click a tab or press **1** to **3** while the band has focus:

```
⚙ Settings  [1 Display] [2 Recap] [3 Status line]   [ Reset ]
──────────────────────────────────────────────────────────────
  Away after              [ − ] 5m [ + ]   How long you are quiet before it shows
  Recap style             [ Band ]         Band above the prompt, or a pane
  ↳ Away after: 10 minutes. How long you are quiet before it shows.
```

| Tab | Settings |
|---|---|
| Display | Cyberpunk (neon look, 🍃 button), Button label |
| Recap | Away after (1 to 120 minutes), Recap style (Band or Pane) |
| Status line | Cache in status line |

The same settings are in `/config` under Calm Recap. **Reset** puts every setting back except the status line.
