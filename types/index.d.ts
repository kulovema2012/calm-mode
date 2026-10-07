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
  /** Show the last turn's prompt-cache hit rate in the status line. */
  cacheMeter: boolean
}

/** What the "Welcome back" card shows about the last job. */
export type AwayRecap = {
  jobId: number
  title: string
  phase: ChecklistPhase
  tookMs: number
  stepsDone: number
  stepsTotal: number
  /** One or two plain sentences on what Claude said or did. */
  summary: string
  /** The person's last prompt, shortened. */
  lastAsked: string
  /** When the job ended, which is when "away" started. */
  awaySince: number
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
      /** The last turn's cache meter text, e.g. "⚡ cache 87%". */
      cacheLine: string | null
    }
  }
}
