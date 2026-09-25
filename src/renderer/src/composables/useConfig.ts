import { computed, isRef, reactive, toRaw } from 'vue'
import type { AppConfig } from '@shared/types'
import { createDefaultConfig } from '@shared/defaults'
import { emitSaved } from '@/utils/misc'

interface ConfigState {
  config: AppConfig
  ready: boolean
}

const state = reactive<ConfigState>({
  config: createDefaultConfig(),
  ready: false
})

let started = false

function applyConfig(next: AppConfig): void {
  state.config = next
}

export async function loadConfig(): Promise<void> {
  if (started) return
  started = true
  try {
    const config = await window.cd.getConfig()
    if (config) applyConfig(config)
    window.cd.onConfigChange((next) => applyConfig(next))
  } catch (error) {
    console.error('[config] 初始化失败', error)
  } finally {
    state.ready = true
  }
}

/** 只读响应式配置；设置界面通过 patch / reset 写回主进程 */
export const config = computed(() => state.config)
export const configReady = computed(() => state.ready)

export async function resetConfig(): Promise<AppConfig> {
  const next = await window.cd.resetConfig()
  if (next) applyConfig(next)
  return next
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

/**
 * 去掉 Vue 的响应式 Proxy 后再跨 IPC 传递。
 * 直接把 reactive 对象发给 Electron 会抛出「An object could not be cloned」，
 * 而 structuredClone / toRaw 都只处理最外层，嵌套的 Proxy 仍会失败，所以这里手动递归。
 */
function toPlain<T>(value: T): T {
  if (isRef(value)) return toPlain(value.value) as T
  if (Array.isArray(value)) return value.map((entry) => toPlain(entry)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(toRaw(value as object))) {
      if (entry === undefined) continue
      out[key] = toPlain(entry)
    }
    return out as T
  }
  return value
}

export function patchConfig(patch: unknown): Promise<AppConfig> {
  return window.cd.updateConfig(toPlain(patch)).then((next) => {
    if (next) applyConfig(next)
    emitSaved()
    return next
  })
}

export function patchConfigPartial(patch: DeepPartial<AppConfig>): Promise<AppConfig> {
  return patchConfig(patch)
}
