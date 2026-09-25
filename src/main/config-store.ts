import { app } from 'electron'
import Store from 'electron-store'
import { createDefaultConfig, mergeConfig, migrateLegacy } from '../shared/defaults'
import type { AppConfig } from '../shared/types'

type Listener = (config: AppConfig) => void

let store: Store<{ config: AppConfig }> | null = null
let cache: AppConfig = createDefaultConfig()
const listeners = new Set<Listener>()

export function initConfig(): void {
  store = new Store<{ config: AppConfig }>({
    name: 'config',
    defaults: { config: createDefaultConfig() }
  })
  // 旧版本（单个 target/text）先迁移成倒数日列表
  const raw = store.get('config')
  cache = mergeConfig(createDefaultConfig(), migrateLegacy(raw))
  // 版本升级或字段缺失时回写一次，保证磁盘结构完整
  store.set('config', cache)
}

export function getConfig(): AppConfig {
  return cache
}

/** 深度合并式更新，返回最新完整配置并广播给所有窗口 */
export function updateConfig(patch: unknown): AppConfig {
  const next = mergeConfig(cache, patch)
  cache = next
  store?.set('config', next)
  for (const listener of listeners) {
    try {
      listener(next)
    } catch (error) {
      console.error('[config] listener failed', error)
    }
  }
  return next
}

export function resetConfig(): AppConfig {
  return updateConfig(createDefaultConfig())
}

export function onConfigChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function configPath(): string {
  return store?.path ?? ''
}

export function isDev(): boolean {
  return !app.isPackaged
}
