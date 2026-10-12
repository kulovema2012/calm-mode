export type EnhanceSettings = {
  /** Which model rewrites the draft. */
  model: 'sonnet' | 'haiku'
}

declare module 'claude-code' {
  interface PluginState {
    'calm-enhance': {
      /** The box holds a draft long enough to enhance. */
      hasDraft: boolean
      /** A rewrite is on its way. */
      isBusy: boolean
      /** The draft before the last rewrite, for Revert; null when there is nothing to revert. */
      previous: string | null
    }
  }
}
