import { globalShortcut } from 'electron'
import { getConfig, updateConfig } from './config-store'
import { toggleWidgetVisible } from './windows'
import { refreshTray } from './tray'

let registered = false

function tryRegister(accelerator: string): boolean {
  globalShortcut.unregisterAll()
  registered = false
  if (!accelerator) return false
  try {
    registered = globalShortcut.register(accelerator, () => {
      toggleWidgetVisible()
      refreshTray()
    })
  } catch (error) {
    console.error('[hotkey] register failed', accelerator, error)
    registered = false
  }
  if (!registered) console.warn(`[hotkey] 无法注册快捷键：${accelerator}（可能被其他程序占用）`)
  return registered
}

export function registerHotkey(): boolean {
  return tryRegister(getConfig().runtime.toggleHotkey)
}

export function applyHotkey(accelerator: string): boolean {
  const normalized = accelerator.trim()
  const ok = tryRegister(normalized)
  updateConfig({ runtime: { toggleHotkey: normalized } })
  refreshTray()
  return ok
}

export function isHotkeyRegistered(): boolean {
  return registered
}

export function unregisterHotkey(): void {
  globalShortcut.unregisterAll()
  registered = false
}
