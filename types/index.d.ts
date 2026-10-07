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
}

declare module 'claude-code' {
  interface PluginState {
    'calm-mode': {
      calmModeEnabled: boolean
      checklist: Checklist | null
      tick: number
      settings: CalmSettings
      isSettingsOpen: boolean
    }
  }
}
