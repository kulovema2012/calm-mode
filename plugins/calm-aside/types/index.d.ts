export type AsideSettings = {
  /** Neon pink and cyan look. */
  cyberpunk: boolean
  /** A dim line under each answer with its time and tokens. */
  showCost: boolean
  /** Before the first reply, answer at once from the chat's text with a small model. */
  liveFallback: boolean
  /** The model for those quick answers. */
  liveModel: string
  /** Earlier side questions shown and sent along with each new one (1 to 50). */
  maxHistory: number
}

/** One side question and its answer. */
export type Exchange = {
  id: number
  question: string
  /** Null while it is being answered. */
  answer: string | null
  askedAt: number
  /** How long the answer took, in milliseconds. */
  tookMs?: number
  /** Where the answer came from: a fork of the session, a quick answer from the chat's text, or an error. */
  kind?: 'fork' | 'quick' | 'error'
  /** Tokens read from the cache, added, and written out, for the cost line. */
  usage?: { read: number; added: number; out: number }
  /** For a quick answer: how many characters of chat were sent. */
  sentChars?: number
  /** Waiting for Claude's current reply to end, because there was nothing to fork yet. */
  isWaiting?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'calm-aside': {
      settings: AsideSettings
      exchanges: Exchange[]
    }
  }
}
