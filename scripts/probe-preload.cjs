// 仅用于 DOM 级验证脚本：给真实的设置页渲染进程塞一个内存版 window.cd。
//
// 为什么不用真主进程：主进程启动时要读系统注册表（判断是否开启透明效果），
// 本机的命令安全策略把 reg.exe 拉黑了，整套应用跑不起来。
// 这里只把渲染层需要的 IPC 面做成内存实现，界面本身仍然是 out/renderer 里的**真产物**。
const { contextBridge } = require('electron')

function deepMerge(base, patch) {
  if (Array.isArray(patch)) return patch.map((entry) => entry)
  if (patch && typeof patch === 'object') {
    const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {}
    for (const [key, value] of Object.entries(patch)) {
      out[key] = deepMerge(out[key], value)
    }
    return out
  }
  return patch
}

const prefix = '--cd-config='
const arg = process.argv.find((entry) => entry.startsWith(prefix))
let current = JSON.parse(arg.slice(prefix.length))
const listeners = new Set()

const resolved = () => Promise.resolve(true)
const noopUnsubscribe = () => () => {}

contextBridge.exposeInMainWorld('cd', {
  platform: process.platform,
  getConfig: () => Promise.resolve(current),
  updateConfig: (patch) => {
    current = deepMerge(current, patch)
    for (const handler of listeners) handler(current)
    return Promise.resolve(current)
  },
  replaceConfig: (next) => {
    current = next
    for (const handler of listeners) handler(current)
    return Promise.resolve(current)
  },
  resetConfig: () => Promise.resolve(current),
  getConfigPath: () => Promise.resolve('(probe)'),
  exportConfig: () => Promise.resolve({ ok: false, canceled: true, path: '' }),
  importConfig: () => Promise.resolve({ ok: false, canceled: true, path: '' }),
  onConfigChange: (handler) => {
    listeners.add(handler)
    return () => listeners.delete(handler)
  },
  getHostInfo: () =>
    Promise.resolve({
      appVersion: '0.0.0-probe',
      electron: process.versions.electron,
      platform: process.platform,
      screens: [],
      shortcutRegistered: false,
      hotkey: '',
      startAtLogin: false,
      isDev: true,
      systemTransparency: true
    }),
  openConfigFile: resolved,
  toggleWidget: resolved,
  setWidgetVisible: resolved,
  showSettings: resolved,
  setInteractive: resolved,
  beginDrag: resolved,
  endDrag: resolved,
  onCursor: noopUnsubscribe,
  onWidgetShown: noopUnsubscribe,
  snapCorner: (corner) => Promise.resolve(corner),
  setActiveCountdown: (id) => Promise.resolve(id),
  setCountdownEnabled: resolved,
  reorderCountdowns: () => Promise.resolve(current.countdowns || []),
  closeSettings: resolved,
  setPreviewItem: resolved,
  onWidgetConfig: noopUnsubscribe,
  onPreviewSync: noopUnsubscribe,
  setHotkey: (hotkey) => Promise.resolve({ ok: true, hotkey, registered: true }),
  setStartAtLogin: resolved,
  setTransparency: resolved,
  refreshTray: resolved,
  quitApp: resolved,
  hideAll: resolved
})
