export type TaskStatus = 'done' | 'active' | 'upcoming'

export type ChecklistTask = {
  id: string
  name: string
  status: TaskStatus
  percent: number
  hasReported: boolean
}

export type ChecklistPhase = 'working' | 'needsYou' | 'stuck' | 'stopped' | 'done'

export type Checklist = {
  /** Increases with every new job, so late answers for an old job are ignored. */
  jobId: number
  title: string
  phase: ChecklistPhase
  tasks: ChecklistTask[]
  /** True once Claude has laid out a real plan (plan_steps, TodoWrite or TaskCreate). */
  hasPlan: boolean
  needsYouReason: string | null
  stuckReason: string | null
  startedAt: number
  finishedAt: number | null
  isCollapsed: boolean
}

/** A built-in track's id, or shuffle for a random one each job. */
export type TrackChoice = 'neon-drive' | 'night-rain' | 'hacker-pulse' | 'chrome-ambient' | 'shuffle'

export type CalmSettings = {
  /** Hide tool calls, results and progress hints while Calm Mode is on. */
  hideToolRows: boolean
  /** Ask Haiku for a short job name on each new request. */
  jobNaming: boolean
  /** The word(s) on the on/off button, up to 20 characters. */
  buttonLabel: string
  /** Neon pink and cyan look. */
  cyberpunk: boolean
  /** Play background music while Claude works, in the Cyberpunk theme only. */
  music: boolean
  /** Your own audio file (absolute path); empty plays the built-in synth loop. */
  musicFile: string
  /** Music volume, 0 to 100 percent; 0 keeps the player off. */
  musicVolume: number
  /** Which built-in track plays when no music file is set. */
  track: TrackChoice
  /** Show a "Welcome back" recap after you have been away. */
  awayRecap: boolean
  /** Minutes of quiet after a job before the recap shows (1 to 120). */
  awayMinutes: number
  /** The cache meter is installed at the right end of the status line. */
  cacheMeter: boolean
  /** Where the Welcome back recap reads: in the band above the prompt, or in a pane of its own. */
  recapStyle: 'band' | 'pane'
  /** Show the weather beside the gear; the city comes from the internet address. */
  weather: boolean
  /** A city typed in for the weather; blank finds it from the internet address. */
  weatherCity: string
}

/** The settings panel's tabs. */
export type SettingsTab = 'display' | 'music' | 'recap' | 'status'

/** Keep-warm for this session: on or off, when it stops, pings in a row, and how long the last ping keeps the cache. */
export type KeepWarm = {
  isOn: boolean
  /** When to stop (milliseconds), or null to stop only after 20 pings in a row. */
  until: number | null
  pings: number
  /** The cache stays warm until this time (milliseconds) thanks to the last ping. */
  warmUntil: number
}

/** What the "Welcome back" card shows about the last job. */
export type AwayRecap = {
  jobId: number
  title: string
  phase: ChecklistPhase
  tookMs: number
  stepsDone: number
  stepsTotal: number
  /** Up to three short points on what Claude said or did; one starting "Needs you:" is highlighted. */
  points: string[]
  /** Rebuilt from the saved conversation after `claude --resume`. */
  isResumed: boolean
  /** The prompt cache expired while the person was away, so the next message re-reads everything. */
  isCacheCold: boolean
  /** The person's last prompt, shortened. */
  lastAsked: string
  /** When the job ended, which is when "away" started; null when a resumed session cannot tell. */
  awaySince: number | null
  isShowing: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'calm-mode': {
      calmModeEnabled: boolean
      checklist: Checklist | null
      tick: number
      settings: CalmSettings
      isSettingsOpen: boolean
      recap: AwayRecap | null
      /** The settings panel's open tab. */
      settingsTab: SettingsTab
      /** One line on the setting changed last, shown under the panel. */
      settingsHint: string | null
      /** The latest weather reading, while the weather is turned on. */
      weather: { symbol: string; tempC: number; city: string } | null
      /** Keep-warm for this session. */
      keepWarm: KeepWarm | null
      /** Set once this process has started, to tell a resumed session from a hot reload. */
      sessionSeen: boolean
    }
  }
}
