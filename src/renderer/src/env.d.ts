/// <reference types="vite/client" />

import type { CountingDownApi } from '../../preload'

declare global {
  interface Window {
    cd: CountingDownApi
  }
}

export {}
