import type { Register } from 'claude-code'

import { registerCalmAside } from './calm-aside'

export const register: Register = (on, options) => {
  registerCalmAside(on, options)
}
