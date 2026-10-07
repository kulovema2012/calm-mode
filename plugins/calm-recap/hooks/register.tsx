import type { Register } from 'claude-code'

import { registerCalmRecap } from './calm-recap'

export const register: Register = (on, options) => {
  registerCalmRecap(on, options)
}
