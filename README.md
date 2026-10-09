# Calm Mode

A Claude Code mod that makes Claude feel calm and friendly for people who aren't technical.

While Claude works, the tool calls, file diffs and command output are hidden. One simple checklist sits above the prompt, so you can always see the plan, what's happening now and how far along it is:

```
Build my landing page              ⏱ 1m 12s       ⚙ [ 🍃 Calm Mode ● ]
✓ Read your brand notes            ██████████  Done
▶ Build the pricing section        ██████░░░░  60%
○ Add the contact form             ░░░░░░░░░░  Next
○ Polish the footer                ░░░░░░░░░░  Up next
```

The header also tells you when Claude **needs you** (a permission prompt or a question), when it's **stuck** (an error, explained in one plain sentence), when you **stopped** it with Esc, and when it's **all done**.

## Install

In a Claude Code terminal session, type:

```
/plugin install calm-mode --marketplace kulovema2012/calm-mode
```

Answer `y` to add the marketplace, then press Enter to install for your user. Calm Mode starts on straight away.

### Add the marketplace first, choose a plugin later

To add this marketplace without installing anything yet, type in a Claude Code session:

```
/plugin marketplace add kulovema2012/calm-mode
```

or in a terminal:

```
claude plugin marketplace add kulovema2012/calm-mode
```

(`https://github.com/kulovema2012/calm-mode.git` works too.) Nothing is installed or turned on, and your band and status line stay as they are. When you are ready, type `/plugin` and pick **calm-mode** or **calm-recap** under Browse plugins, or install one directly:

```
/plugin install calm-mode@calm-mode
/plugin install calm-recap@calm-mode
```

The part after `@` is the marketplace's name. Install one of the two, not both: both draw the band above the prompt.

| Command | Does |
|---|---|
| `claude plugin marketplace list` | Shows the marketplaces you have added |
| `claude plugin marketplace update calm-mode` | Gets the latest plugin list from GitHub |
| `claude plugin marketplace remove calm-mode` | Removes the marketplace |

## Just the recap and cache meter?

**[Calm Recap](plugins/calm-recap/README.md)** is a second plugin in this repository with only the Welcome back card and the prompt-cache meter, and the same settings panel; Claude Code otherwise looks as usual. Install one or the other:

```
/plugin install calm-recap --marketplace kulovema2012/calm-mode
```

## Turn it on and off

- Click the **[ 🍃 Calm Mode ● ]** button at the right of the band above the prompt, or
- type `/calm off` or `/calm on`. Plain `/calm` flips it.

Your choice is remembered after a restart. When Calm Mode is off, every hidden row comes back and only the button stays.

## Settings

Click the **⚙** next to the on/off button. The panel shows one tab at a time; click a tab or press **1** to **4** while the band has focus:

```
⚙ Settings  [1 Display] [2 Music] [3 Recap] [4 Status line]   [ Reset ]
────────────────────────────────────────────────────────────────────────
  Hide tool rows      [ ◉ ]      Hide tool calls while Claude works
  Job naming          [ ◉ ]      Haiku gives each job a short name
  Cyberpunk           [ ○ ]      Neon pink and cyan look
  Button label        Calm Mode
  ↳ Cyberpunk: Off. Neon pink and cyan look.
```

Every switch is an icon, `◉` on and `○` off, each row says what it does, and the dim `↳` line explains the setting you changed last. Settings that do nothing right now are dimmed (music without Cyberpunk, the away time with the recap off). **Reset** puts every setting back to its default, except the status line, which you turn on and off yourself because it edits your settings file.

| Tab | Settings |
|---|---|
| Display | Hide tool rows, Job naming, Cyberpunk, Weather, Button label, Weather city |
| Music | Music, Volume, Track, Music file |
| Recap | Away recap, Away after, Recap style |
| Status line | Cache in status line, Keep warm |

| Setting | Default | What it does |
|---|---|---|
| Hide tool rows | ON | Hides tool calls and their output while Calm Mode is on. OFF keeps the checklist and shows every row. |
| Job naming | ON | Asks Haiku for a short job name. OFF saves that call and uses your first line instead. |
| Cyberpunk theme | OFF | Neon pink titles, cyan meters, yellow alerts. |
| Button label | Calm Mode | The words on the on/off button (up to 20 characters). Type and press Enter. |
| Music | ON | Background music while Claude works, **only in the Cyberpunk theme**. Pauses when Claude needs you, stops when the job ends. |
| Volume | 35% | `[ − ]` and `[ + ]` change it in 10% steps. 0% keeps the music off. |
| Track | Neon Drive | `[ ♪ Track: … ]` steps through the built-in tracks, then **Shuffle** (a random track each job). |
| Music file | (empty) | Full path to your own MP3 or WAV. When set, it plays instead of the built-in track. |
| Away recap | ON | After a job ends, if you stay quiet for a while, the band shows a **Welcome back** card. |
| Away after | 5m | How long that while is. `[ − ]` and `[ + ]` step through 1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90 and 120 minutes; `/config` takes any value from 1 to 120. |
| Recap | Band | Where the Welcome back recap reads. **Band**: above the prompt, full width, trimmed to fit. **Pane**: a larger panel of its own that also lists the job's steps; the band keeps one line with `[ Open recap ]`. |
| Cache in status line | OFF | Adds `⚡ cache 87% ▰▰▰▰▰▰▰▰▱▱ 47m` at the right end of your status line. The button (or `/calm statusline on\|off`) edits your status line for you. |

### Several Claude sessions at once

Only one track plays at a time, whichever sessions are busy. The first busy session takes the player by writing a small lock file, `~/.claude/calm-mode-music.json`, and renews it every 3 seconds; other busy sessions stay quiet. When that session's job ends it hands the player back, and another busy session picks it up within 3 seconds, playing its own track and volume. If a session closes without handing back, the others take over after 9 seconds.

### Fitting the screen

Claude Code gives the band at most half the terminal's height. Calm Mode never makes it scroll: a long plan folds its finished steps into one `✓ 5 steps done` row, and then the steps after the current one into `○ …3 more steps`; a long recap drops its rules, then the question you asked, then all but its first point. Plans hold up to 12 steps, with step names up to 60 characters.

### Weather

With **Weather** on (Display tab), the band shows your city, a symbol and the temperature beside ⚙, e.g. `📍 Bangkok ⛅ 31°C` (☀ ☾ ⛅ ☁ 🌫 🌦 🌧 ❄ ⛈). Your city is worked out from your internet address with [ipwho.is](https://ipwho.is), at most once an hour (so a new network shows within the hour), and the reading comes from [Open-Meteo](https://open-meteo.com) every 15 minutes; neither needs an account. It is on by default. **Privacy:** the lookup sends your internet address to ipwho.is; turn Weather off to stop all weather requests, or type a Weather city to stop the address lookup. Internet-address locations are often off by a city or more (a home fibre line may show as the provider's Bangkok office), so you can type your own instead: **Weather city** on the Display tab, or `/calm weather city Khon Kaen`. A typed city is found once with Open-Meteo's place search and ipwho.is is not asked at all; `/calm weather city` with no name goes back to automatic. **On a Mac** the real position can be used instead: install the free helper with `brew install corelocationcli`, allow your terminal app when macOS asks for location access, and the weather then uses macOS Location Services (checked at most once an hour), falling back to the internet address if the helper is missing, location is off, or access is refused. **On Windows** the Windows location service is used when location access is on (Settings → Privacy & security → Location), with nothing to install; a fix rougher than 50 km is not trusted. Its coordinates go to [BigDataCloud](https://www.bigdatacloud.com)'s free reverse lookup to name the city. Order: typed Weather city, then the Mac helper or Windows location, then the internet address. A city guessed from the internet address is marked with **?** (e.g. `📍 Bangkok? ⛅ 31°C`); a typed or Mac city has no mark. A Mac without the helper shows a one-time tip on how to install it, and a Mac whose helper is installed but fails (Wi-Fi off, access refused) asks it again after 15 minutes instead of keeping the guess for an hour.

### Built-in tracks

| Track | Feel |
|---|---|
| **Neon Drive** | 110 BPM synthwave: driving bass, neon arpeggio, four-on-the-floor drums |
| **Night Rain** | 78 BPM lo-fi: soft electric piano chords, dusty drums, rain and vinyl crackle |
| **Hacker Pulse** | 128 BPM dark techno: rolling bass, claps, glitchy hats |
| **Chrome Ambient** | No drums: slow evolving pads over a deep drone, for quiet focus |

All four are original loops generated by code in this project (`plugins/calm-mode/tools/make_tracks.py`), so they are free to use and share. On Windows the music plays through a hidden PowerShell media player, on macOS through Claude Code's own player (or `afplay` for your own file), and on Linux through `ffplay` if it is installed.

### Welcome back card

```
↩ Welcome back · away 18m                    ⚙ [ 🍃 Calm Mode ● ]
────────────────────────────────────────────────────────────────
✓ Build my landing page · took 6m 40s · 4/4 steps
────────────────────────────────────────────────────────────────
What Claude did
  • Added the pricing section and contact form
  • Made the pricing cards blue
  ➜ Needs you: send the logo file for the footer
────────────────────────────────────────────────────────────────
You last asked
    "make the pricing cards blue"
                                                      [ Got it ]
```

"What Claude did" is up to three short points written by Haiku (one small call, only when the card appears); anything waiting on you is highlighted with ➜. Thin rules (dashed neon in the Cyberpunk theme) split the card's sections, and its text uses the band's full width. The ⚙ and on/off buttons on the first row belong to the band, which shows them on every screen. Press **Got it** or just type your next message to clear it. Type `/calm recap` to show it any time. Each point ends in **↗**: click it (or focus it and press Enter) and the chat scrolls to the step it is about, such as the edit Claude made or the reply that asked you something; the ↗ after "You last asked" goes to your message. With the Pane style the pane closes first. It works in the session the card belongs to, for rows still in the chat.

**After `claude --resume`** the card appears straight away, rebuilt from the saved conversation: how long you were away, your last request, the points of Claude's last reply, and a warning when the prompt cache has expired (your next message then re-reads the whole conversation at full price).

### Cache meter in the status line

```
🤖 Opus 5.5 | 📁 ~/my-app | ⎇ main | 📊 ctx: 42% | ⚡ cache 87% ▰▰▰▰▰▰▰▰▱▱ 47m
```

The meter sits at the right end of Claude Code's status line and shows how much of the newest request's prompt was read from the prompt cache, which is cheaper and faster: green at 70% and up, yellow from 30%, red below. `⚡ cache warming up` means the cache was just written and the next request should hit it.

After the hit rate comes a bar of the cache's lifetime left, with the minutes beside it: full right after a request, draining until the cache goes cold (green over half, yellow over a fifth, red below). Every request that reads or writes the cache restarts that clock. Once it runs out the meter shows `❄ cache cold`: your next message re-reads the whole conversation at full price. The installer sets the status line's `refreshInterval` to 60 seconds (each bar block is 6 minutes, so a faster refresh would not show anything new) so the bar drains while you are idle (only if you had none; turning the meter off removes it again).

A plugin cannot set the status line itself, so turning it on runs the plugin's `statusline/install.mjs`, which:

- copies the meter to `~/.claude/hooks/calm-cache-statusline.mjs` (outside the plugin, so updates never break your status line),
- saves your current status-line command in `~/.claude/hooks/calm-cache-statusline.json` and runs it first, so everything you had stays,
- backs up `settings.json` to `settings.json.calm-backup` before every change.

Turning it off puts your previous status line back. It follows the same wrapper convention as other status-line wrappers: if another wrapper was later installed around it, removing the meter hands that wrapper your original command, so the chain never breaks.

### Keep warm

Turn on **Keep warm** (Status line tab, or `/calm keepwarm on`) before you step away. About 5 minutes before the 1-hour prompt cache would expire, it asks Claude one hidden question over this conversation, which reads it from the cache and restarts the hour, so your next message does not pay to rebuild everything. Nothing is added to the chat, and the status line shows ♨ while it is on and 🔥 once a ping is keeping the cache warm: `⚡ cache 87% ▰▰▰▰▰▰▰▰▱▱ 47m 🔥`.

| Command | Does |
|---|---|
| `/calm keepwarm on` | Keep this session warm (stops after 20 pings in a row) |
| `/calm keepwarm 3h` / `90m` | Keep it warm for that long |
| `/calm keepwarm until 18:00` | Keep it warm until then |
| `/calm keepwarm off` | Stop |

It needs the cache meter in your status line (that is how it knows when the cache expires), only pings a 1-hour cache (on the 5-minute cache pinging would cost more than it saves), never wakes a cache that has already gone cold, and pauses while Claude is working. Each ping re-reads your conversation from the cache: far cheaper than rebuilding it, but it does count toward your plan's usage. The idea comes from [claude-code-cache-keep-warm](https://github.com/andreichiritescu/claude-code-cache-keep-warm) (MIT) by Andrei Chiritescu.

The same settings appear in `/config` under Calm Mode, and the two always agree.

```
◢◤ BUILD MY LANDING PAGE // 01:12           ⚙ [ 🌃 CALM MODE ⏻ ]
◆ Read your brand notes      ▰▰▰▰▰▰▰▰▰▰  DONE
▸ Build the pricing section  ▰▰▰▰▰▰▱▱▱▱  60%
◇ Add the contact form       ▱▱▱▱▱▱▱▱▱▱  NEXT
◇ Polish the footer          ▱▱▱▱▱▱▱▱▱▱  QUEUED
```

## Good to know

- While Calm Mode is on, Claude has to lay out a plan (2 to 12 plain-English steps) before it uses any other tool. This adds a few extra tokens to each request.
- Each new request makes one small Haiku call to give the job a short name.
- Subagents are never blocked.

## For developers

- The repository is a marketplace of two plugins: `plugins/calm-mode` and `plugins/calm-recap`, listed in `.claude-plugin/marketplace.json`.
- In each, `hooks/register.tsx` is the entry point and `types/index.d.ts` types the shared state (under the `calm-mode` and `calm-recap` keys).
- Test and check each plugin from its own folder: `claude plugin test plugins/calm-mode`, `claude plugin validate plugins/calm-recap`, and `claude plugin validate .` for the marketplace.
- `statusline/` is the same in both plugins; change both together.

Made by Newk.
