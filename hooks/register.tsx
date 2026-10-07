import type { Register } from 'claude-code'

import { registerCalmMode } from './calm-mode'

// One entry point, so more mods can be added beside Calm Mode later.
export const register: Register = on => {
  registerCalmMode(on)
}
