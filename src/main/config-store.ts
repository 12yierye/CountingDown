import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import Store from 'electron-store'
import { createDefaultConfig, mergeConfig, migrateLegacy } from '../shared/defaults'
import type { AppConfig } from '../shared/types'

type Listener = (config: AppConfig) => void

let store: Store<{ config: AppConfig }> | null = null
let cache: AppConfig = createDefaultConfig()
const listeners = new Set<Listener>()

export function initConfig(): void {
  /*
   * 引导判定的依据必须取在创建 store **之前**：electron-store 一落地就会把
   * config.json 写出来，之后再问「文件在不在」永远是「在」，首次启动就判不出来了。
   */
  const configFile = join(app.getPath('userData'), 'config.json')
  const existed = existsSync(configFile)

  store = new Store<{ config: AppConfig }>({
    name: 'config',
    defaults: { config: createDefaultConfig() }
  })
  // 旧版本（单个 target/text）先迁移成倒数日列表
  const raw = store.get('config')
  cache = mergeConfig(createDefaultConfig(), migrateLegacy(raw))
  /*
   * 存量配置（升级上来的用户）一律视为「早就走过引导」：
   * 他们的列表、外观、位置都是自己调出来的，没有理由再被引导一遍。
   * 只有真正全新的安装才会停在 onboardedAt = 0。
   */
  if (existed && !cache.runtime.onboardedAt) {
    cache.runtime.onboardedAt = 1
  }
  // 版本升级或字段缺失时回写一次，保证磁盘结构完整
  store.set('config', cache)
}

export function getConfig(): AppConfig {
  return cache
}

/** 深度合并式更新，返回最新完整配置并广播给所有窗口 */
export function updateConfig(patch: unknown): AppConfig {
  const next = mergeConfig(cache, patch)
  return commit(next)
}

/**
 * 整份替换：撤销、重做、导入配置都走这里。
 *
 * 不能复用 updateConfig —— 它是深合并，删掉的字段（例如取消某个外观覆盖）
 * 会原样留在旧值里，撤销就变成「看起来没变」。这里以**默认配置**为底重新合并，
 * 旧结构里多出来的字段自然被丢掉。
 */
export function replaceConfig(next: unknown): AppConfig {
  return commit(mergeConfig(createDefaultConfig(), next))
}

function commit(next: AppConfig): AppConfig {
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

/**
 * 恢复默认设置。
 *
 * 刻意保留 onboardedAt：那是「这台机器上的人已经走过引导」的记录，
 * 不属于可重置的偏好。跟着一起清掉的话，用户只是想恢复外观，
 * 下次启动却会被新手引导拦一道，纯属惊吓。
 */
export function resetConfig(): AppConfig {
  const onboardedAt = cache.runtime.onboardedAt
  const defaults = createDefaultConfig()
  // runtime 必须整份给齐：updateConfig 是深合并，只给 onboardedAt 的话
  // 其余运行时字段会留在原值上，「恢复默认」就变成了半成品。
  return updateConfig({ ...defaults, runtime: { ...defaults.runtime, onboardedAt } })
}

/** 是否还需要展示首次启动引导 */
export function needsOnboarding(): boolean {
  if (process.env.CD_SKIP_ONBOARDING === '1') return false
  if (process.env.CD_FORCE_ONBOARDING === '1') return true
  return !cache.runtime.onboardedAt
}

/** 记录「引导已走完」；重复调用不会反复写盘 */
export function markOnboarded(): void {
  if (cache.runtime.onboardedAt) return
  updateConfig({ runtime: { onboardedAt: Date.now() } })
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
