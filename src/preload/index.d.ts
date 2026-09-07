import type { Api } from '../shared/types'

declare global {
  interface Window {
    /** preload 白名单入口（见 src/shared/types.ts 的 Api） */
    api: Api
  }
}

export {}
