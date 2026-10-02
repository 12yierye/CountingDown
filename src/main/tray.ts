import { join } from 'node:path'
import { Menu, Tray, app, nativeImage } from 'electron'
import { getConfig, updateConfig } from './config-store'
import {
  applyPosition,
  createSettingsWindow,
  isWidgetWindowAlive,
  setWidgetVisible,
  toggleWidgetVisible
} from './windows'

let tray: Tray | null = null
let builtMenu: Menu | null = null
let currentLanguage = 'zh-CN'

const copy = {
  'zh-CN': {
    tooltip: '倒数日',
    show: '显示倒数日',
    hide: '隐藏倒数日',
    settings: '设置…',
    resetPosition: '吸附到右上角',
    allowDrag: '允许拖动',
    alwaysOnTop: '总在最前',
    startup: '开机自动启动',
    quit: '退出',
    hotkeyHint: (key: string): string => (key ? `快捷键：${key}` : '快捷键：未设置')
  },
  'en-US': {
    tooltip: 'Countdown',
    show: 'Show countdown',
    hide: 'Hide countdown',
    settings: 'Settings…',
    resetPosition: 'Snap to top-right',
    allowDrag: 'Allow dragging',
    alwaysOnTop: 'Always on top',
    startup: 'Launch at login',
    quit: 'Quit',
    hotkeyHint: (key: string): string => (key ? `Hotkey: ${key}` : 'Hotkey: not set')
  }
} as const

type Dict = (typeof copy)['zh-CN']

function dict(): Dict {
  return currentLanguage === 'en-US' ? (copy['en-US'] as unknown as Dict) : copy['zh-CN']
}

function resolveTrayImage(): Electron.NativeImage {
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, 'resources', 'tray.png'),
        join(process.resourcesPath, 'app.asar', 'resources', 'tray.png')
      ]
    : [join(__dirname, '../../resources/tray.png'), join(process.cwd(), 'resources/tray.png')]
  for (const file of candidates) {
    const image = nativeImage.createFromPath(file)
    if (!image.isEmpty()) return image.resize({ width: 16, height: 16 })
  }
  console.warn('[tray] 未找到托盘图标资源，请先执行 pnpm run icon')
  return nativeImage.createEmpty()
}

function buildMenu(): Menu {
  const config = getConfig()
  const text = dict()
  const tray = config.runtime.trayMenu
  const template: Electron.MenuItemConstructorOptions[] = []

  const widgetAlive = isWidgetWindowAlive()

  // 「显示 / 隐藏倒数日」与「设置」是托盘最基本的两个入口，这里始终保留。
  // 文案看的是**窗口是不是还活着**，不是配置里的期望值：窗口被外部销毁时
  // widgetVisible 还是 true，照它渲染出来的菜单会写着「隐藏」，用户点不到「显示」。
  template.push({
    label: config.runtime.widgetVisible && widgetAlive ? text.hide : text.show,
    click: () => {
      toggleWidgetVisible()
      refreshTray()
    }
  })
  template.push({
    label: text.settings,
    click: () => createSettingsWindow()
  })

  const extras: Electron.MenuItemConstructorOptions[] = []
  if (tray.resetPosition !== false) {
    extras.push({
      label: text.resetPosition,
      click: () => {
        // 「吸附」= 回到右上角并清空偏移量（角落与参考基准一起改，否则位置不会真的回到右上角）
        updateConfig({
          runtime: { window: { corner: 'top-right', cornerPreset: 'top-right', offsetX: 0, offsetY: 0 } }
        })
        applyPosition()
        setWidgetVisible(true)
        refreshTray()
      }
    })
  }
  if (tray.allowDrag !== false) {
    extras.push({
      label: text.allowDrag,
      type: 'checkbox',
      checked: config.runtime.window.allowDrag !== false,
      click: (item) => {
        updateConfig({ runtime: { window: { allowDrag: item.checked } } })
        refreshTray()
      }
    })
  }
  if (tray.alwaysOnTop !== false) {
    extras.push({
      label: text.alwaysOnTop,
      type: 'checkbox',
      checked: config.behavior.alwaysOnTop,
      click: (item) => updateConfig({ behavior: { alwaysOnTop: item.checked } })
    })
  }
  if (tray.startAtLogin !== false) {
    extras.push({
      label: text.startup,
      type: 'checkbox',
      checked: config.runtime.startAtLogin,
      click: (item) => {
        updateConfig({ runtime: { startAtLogin: item.checked } })
        if (!app.isPackaged) return
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] })
      }
    })
  }
  if (extras.length) {
    template.push({ type: 'separator' }, ...extras)
  }

  if (tray.hotkey !== false) {
    template.push(
      { type: 'separator' },
      { label: text.hotkeyHint(config.runtime.toggleHotkey), enabled: false }
    )
  }

  // 「退出」不能关闭，也不放进设置里
  template.push({ type: 'separator' }, {
    label: text.quit,
    click: () => {
      ;(app as unknown as { isQuitting?: boolean }).isQuitting = true
      app.quit()
    }
  })

  return Menu.buildFromTemplate(template)
}

export function refreshTray(): void {
  if (!tray) return
  currentLanguage = getConfig().runtime.language
  tray.setToolTip(`${dict().tooltip} · v${app.getVersion()}`)
  builtMenu = buildMenu()
  tray.setContextMenu(builtMenu)
}

/** 供自动化验证与调试使用：当前托盘菜单的条目快照 */
export function trayMenuSnapshot(): Array<{ label: string; type: string; checked: boolean }> {
  return (builtMenu?.items ?? []).map((item) => ({
    label: item.label,
    type: item.type,
    checked: item.checked
  }))
}

export function createTray(): Tray {
  if (tray) return tray
  tray = new Tray(resolveTrayImage())
  refreshTray()

  // 左键单击：开关倒数日显示
  tray.on('click', () => {
    toggleWidgetVisible()
    refreshTray()
  })
  // 双击：打开设置界面
  tray.on('double-click', () => {
    createSettingsWindow()
  })
  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
