# Calm Recap

The Welcome back card, the prompt-cache meter and the weather from [Calm Mode](../../README.md), on their own: no checklist, no plan-first rule, no hidden tool rows. Your Claude Code looks exactly as usual until you step away.

```
↩ Welcome back · away 18m           📍 Bangkok ⛅ 31°C  ⚙ [ 🍃 Calm Recap ● ]
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

To add the marketplace first and choose a plugin later, type `/plugin marketplace add kulovema2012/calm-mode` (or `claude plugin marketplace add kulovema2012/calm-mode` in a terminal). Nothing is installed until you pick one with `/plugin`, or with `/plugin install calm-recap@calm-mode`.

## What it does

- **Done line.** After each answer the band says how it went, e.g. `✓ All done · Make the pricing cards blue · took 1m 30s` (Cyberpunk: `◆ ALL DONE // MAKE THE PRICING CARDS BLUE // took 01:30`), or `■ Stopped` / `⚠ Ended early`. The name is a 2 to 6 word name from Haiku (Job naming, Display tab) or the start of your message.
- **Welcome back card.** When Claude has answered and you stay quiet for a while (5 minutes by default), the band above the prompt shows how the answer ended, what Claude did in up to three short points written by Haiku (anything waiting on you is highlighted with ➜), and what you last asked. Press **Got it** or type your next message to clear it.
- **After `claude --resume`** the card appears straight away, rebuilt from the saved conversation, with a warning when the prompt cache has expired.
- **`/recap`** shows the card any time.
- **Cache meter** in your status line, at its right end: `⚡ cache 87% ▰▰▰▰▰▰▰▰▱▱ 47m`, the share of the last request read from the prompt cache and a bar of the time left before it goes cold. Turn it on with `/recap statusline on` or the switch in the settings panel; it wraps your existing status line and `off` puts it back.

- **Weather** beside ⚙: your city, a symbol and the temperature, e.g. `📍 Bangkok ⛅ 31°C` (☀ ☾ ⛅ ☁ 🌫 🌦 🌧 ❄ ⛈). Your city is worked out from your internet address with [ipwho.is](https://ipwho.is) at most once an hour (so a new network shows within the hour), and the reading comes from [Open-Meteo](https://open-meteo.com) every 15 minutes. It is on by default. **Privacy:** the lookup sends your internet address to ipwho.is; turn Weather off (Display tab) to stop all weather requests, or type a Weather city to stop the address lookup. Internet-address locations are often off by a city or more (a home fibre line may show as the provider's Bangkok office), so you can type your own instead: **Weather city** on the Display tab, or `/recap weather city Khon Kaen`. A typed city is found once with Open-Meteo's place search and ipwho.is is not asked at all; `/recap weather city` with no name goes back to automatic.

### Keep warm

Turn on **Keep warm** (Status line tab, or `/recap keepwarm on`) before you step away. About 5 minutes before the 1-hour prompt cache would expire, it asks Claude one hidden question over this conversation, which reads it from the cache and restarts the hour, so your next message does not pay to rebuild everything. Nothing is added to the chat, and the status line shows ♨ while it is on and 🔥 once a ping is keeping the cache warm: `⚡ cache 87% ▰▰▰▰▰▰▰▰▱▱ 47m 🔥`.

| Command | Does |
|---|---|
| `/recap keepwarm on` | Keep this session warm (stops after 20 pings in a row) |
| `/recap keepwarm 3h` / `90m` | Keep it warm for that long |
| `/recap keepwarm until 18:00` | Keep it warm until then |
| `/recap keepwarm off` | Stop |

It needs the cache meter in your status line (that is how it knows when the cache expires), only pings a 1-hour cache (on the 5-minute cache pinging would cost more than it saves), never wakes a cache that has already gone cold, and pauses while Claude is working. Each ping re-reads your conversation from the cache: far cheaper than rebuilding it, but it does count toward your plan's usage. The idea comes from [claude-code-cache-keep-warm](https://github.com/andreichiritescu/claude-code-cache-keep-warm) (MIT) by Andrei Chiritescu.

## Commands

| Command | Does |
|---|---|
| `/recap` | Show the Welcome back card now |
| `/recap on` / `/recap off` | Turn Calm Recap on or off (also the button on the band) |
| `/recap statusline on` / `off` | Add or remove the cache meter in your status line |
| `/recap weather city Khon Kaen` | Show the weather for a city you choose (no name: back to automatic) |
| `/recap keepwarm on` / `3h` / `until 18:00` / `off` | Keep the prompt cache warm while you are away |

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
| Display | Job naming, Cyberpunk (neon look, 🌃 button; the normal look has 🍃), Weather, Button label, Weather city |
| Recap | Away after (1 to 120 minutes), Recap style (Band or Pane) |
| Status line | Cache in status line, Keep warm |

The same settings are in `/config` under Calm Recap. **Reset** puts every setting back except the status line.
