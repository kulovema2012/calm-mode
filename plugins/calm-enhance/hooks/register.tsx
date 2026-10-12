import type { Register } from 'claude-code'

import { registerCalmEnhance } from './calm-enhance'

export const register: Register = (on, options) => {
  registerCalmEnhance(on, options)
}
