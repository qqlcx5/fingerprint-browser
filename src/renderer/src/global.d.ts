import type { PiDesktopAPI } from '../../preload/index'

declare global {
  interface Window {
    piDesktop: PiDesktopAPI
  }
  const __APP_VERSION__: string
}
