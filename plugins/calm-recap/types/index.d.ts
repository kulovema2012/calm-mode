export type RecapSettings = {
  /** The words on the on/off button, up to 20 characters. */
  buttonLabel: string
  /** Neon pink and cyan look. */
  cyberpunk: boolean
  /** Minutes of quiet after Claude answers before the recap shows (1 to 120). */
  awayMinutes: number
  /** Where the recap reads: in the band above the prompt, or in a pane of its own. */
  recapStyle: 'band' | 'pane'
  /** The cache meter is installed at the right end of the status line. */
  cacheMeter: boolean
  /** Show the weather beside the gear; the city comes from the internet address. */
  weather: boolean
  /** Ask Haiku for a short name for each job, shown in the done line. */
  jobNaming: boolean
}

/** The last job (one message and Claude's answer to it), for the band's done line. */
export type LastJob = {
  turnId: string
  /** A short name: Haiku's, or the start of the message. */
  title: string
  phase: RecapPhase
  tookMs: number
}

/** How the last answer ended. */
export type RecapPhase = 'done' | 'stopped' | 'stuck'

/** What the Welcome back card shows about the last answer. */
export type Recap = {
  /** The turn it recaps, so a late summary never lands on a newer card. */
  turnId: string
  phase: RecapPhase
  tookMs: number
  /** Up to three short points on what Claude said or did; one starting "Needs you:" is highlighted. */
  points: string[]
  /** The person's last request, shortened. */
  lastAsked: string
  /** When Claude answered, which is when "away" started; null when a resumed session cannot tell. */
  awaySince: number | null
  isShowing: boolean
  /** Rebuilt from the saved conversation after `claude --resume`. */
  isResumed: boolean
  /** The prompt cache expired while the person was away. */
  isCacheCold: boolean
}

/** The settings panel's tabs. */
export type RecapTab = 'display' | 'recap' | 'status'

/** Keep-warm for this session: on or off, when it stops, pings in a row, and how long the last ping keeps the cache. */
export type KeepWarm = {
  isOn: boolean
  /** When to stop (milliseconds), or null to stop only after 20 pings in a row. */
  until: number | null
  pings: number
  /** The cache stays warm until this time (milliseconds) thanks to the last ping. */
  warmUntil: number
}

declare module 'claude-code' {
  interface PluginState {
    'calm-recap': {
      isEnabled: boolean
      settings: RecapSettings
      isSettingsOpen: boolean
      settingsTab: RecapTab
      /** One line on the setting changed last, shown under the panel. */
      settingsHint: string | null
      recap: Recap | null
      /** Bumped once a minute while the card shows, so "away 18m" stays current. */
      tick: number
      /** The latest weather reading, while the weather is turned on. */
      weather: { symbol: string; tempC: number; city: string } | null
      /** Keep-warm for this session. */
      keepWarm: KeepWarm | null
      /** How the last job ended, for the band's done line; null while Claude works. */
      lastJob: LastJob | null
      /** Set once this process has started, to tell a resumed session from a hot reload. */
      sessionSeen: boolean
    }
  }
}
