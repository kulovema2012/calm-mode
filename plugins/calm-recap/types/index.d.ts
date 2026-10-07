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
  /** When Claude answered, which is when "away" started. */
  awaySince: number
  isShowing: boolean
  /** Rebuilt from the saved conversation after `claude --resume`. */
  isResumed: boolean
  /** The prompt cache expired while the person was away. */
  isCacheCold: boolean
}

/** The settings panel's tabs. */
export type RecapTab = 'display' | 'recap' | 'status'

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
    }
  }
}
