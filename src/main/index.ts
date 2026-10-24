import { BrowserWindow, Menu, app, dialog, ipcMain, screen, session, shell } from 'electron'
import {
  configPath,
  getConfig,
  initConfig,
  isDev,
  onConfigChange,
  replaceConfig,
  resetConfig,
  updateConfig
} from './config-store'
import {
  applyPosition,
  beginWidgetDrag,
  broadcast,
  createSettingsWindow,
  createWidgetWindow,
  endWidgetDrag,
  getSettingsWindow,
  getWidgetWindow,
  pushWidgetConfig,
  recreateWidgetWindow,
  setOnWidgetWindowClosed,
  setWidgetInteractive,
  setWidgetVisible,
  setSystemTransparency,
  setupWindowSync,
  showWidgetWindow,
  toggleWidgetVisible,
  useTransparentWindow,
  detectTransparency,
  getSystemTransparency
} from './windows'
import { applyHotkey, isHotkeyRegistered, registerHotkey, unregisterHotkey } from './hotkey'
import { createTray, destroyTray, refreshTray } from './tray'
import { setPreviewItem } from './preview'
import { exportConfigTo, importConfigFrom } from './backup'
import { startReminders, stopReminders } from './reminders'
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  onUpdateChange,
  openDownloadPage,
  scheduleAutoCheck,
  watchUpdateConfig
} from './updater'
import type { AppConfig, CountdownItem, HostInfo } from '../shared/types'

export { trayMenuSnapshot } from './tray'
export { previewOverlay } from './preview'

type Corner = AppConfig['runtime']['window']['corner']

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    createSettingsWindow()
  })
}

function hostInfo(): HostInfo {
  const config = getConfig()
  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    screens: screen.getAllDisplays().map((display) => ({
      id: display.id,
      label: display.label || `Display ${display.id}`,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      primary: display.id === screen.getPrimaryDisplay().id
    })),
    shortcutRegistered: isHotkeyRegistered(),
    hotkey: config.runtime.toggleHotkey,
    startAtLogin: app.getLoginItemSettings().openAtLogin,
    isDev: isDev(),
    systemTransparency: getSystemTransparency(),
    widgetTransparent: useTransparentWindow()
  }
}

function registerIpc(): void {
  ipcMain.handle('config:get', () => getConfig())
  ipcMain.handle('config:update', (_event, patch: unknown) => updateConfig(patch))
  ipcMain.handle('config:reset', () => resetConfig())
  ipcMain.handle('config:path', () => configPath())
  /** 整份替换：撤销 / 重做 / 导入配置 */
  ipcMain.handle('config:replace', (_event, next: unknown) => replaceConfig(next))

  ipcMain.handle('config:export', async () => {
    const parent = getSettingsWindow()
    const options: Electron.SaveDialogOptions = {
      title: '导出设置',
      defaultPath: `countingdown-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false, canceled: true, path: '' }
    try {
      await exportConfigTo(result.filePath)
      return { ok: true, canceled: false, path: result.filePath }
    } catch (error) {
      return { ok: false, canceled: false, path: '', error: String(error) }
    }
  })

  ipcMain.handle('config:import', async () => {
    const parent = getSettingsWindow()
    const options: Electron.OpenDialogOptions = {
      title: '导入设置',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    const filePath = result.filePaths?.[0]
    if (result.canceled || !filePath) return { ok: false, canceled: true, path: '' }
    try {
      const config = await importConfigFrom(filePath)
      // 导入会改变窗口位置、托盘菜单与透明开关，重建一次组件窗口最省心
      recreateWidgetWindow()
      applyPosition()
      refreshTray()
      return { ok: true, canceled: false, path: filePath, config }
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error)
      return { ok: false, canceled: false, path: filePath, error: message }
    }
  })

  ipcMain.handle('host:info', () => hostInfo())
  ipcMain.handle('host:openConfigFile', () => shell.openPath(configPath()))

  ipcMain.handle('widget:toggle', () => {
    const visible = toggleWidgetVisible()
    refreshTray()
    return visible
  })
  ipcMain.handle('widget:setVisible', (_event, visible: boolean) => {
    const next = setWidgetVisible(Boolean(visible))
    refreshTray()
    return next
  })
  ipcMain.handle('widget:setInteractive', (_event, interactive: boolean) => {
    setWidgetInteractive(Boolean(interactive))
    return true
  })
  /** 拖动组件：渲染层按下时上报卡片位置，松手时由主进程换算偏移量 */
  ipcMain.handle('widget:dragStart', (_event, card: unknown) => beginWidgetDrag(card))
  ipcMain.handle('widget:dragEnd', () => endWidgetDrag())
  ipcMain.handle('widget:showSettings', () => {
    createSettingsWindow()
    return true
  })
  ipcMain.handle('widget:snapCorner', (_event, corner: Corner) => {
    // 选角落即把参考基准也切成该角落，并把偏移清零
    updateConfig({
      runtime: { window: { corner, cornerPreset: corner, offsetX: 0, offsetY: 0 } }
    })
    applyPosition()
    return corner
  })

  ipcMain.handle('countdown:setActive', (_event, id: string) => {
    const config = getConfig()
    if (!config.countdowns.some((item) => item.id === id)) return config.activeId
    updateConfig({ activeId: id })
    return id
  })
  ipcMain.handle('countdown:setEnabled', (_event, payload: { id: string; enabled: boolean }) => {
    const config = getConfig()
    const countdowns = config.countdowns.map((item) =>
      item.id === payload.id ? { ...item, enabled: Boolean(payload.enabled) } : item
    )
    updateConfig({ countdowns })
    return true
  })
  ipcMain.handle('countdown:reorder', (_event, from: number, to: number) => {
    const config = getConfig()
    const list = [...config.countdowns]
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return config.countdowns
    const [moved] = list.splice(from, 1)
    list.splice(to, 0, moved)
    updateConfig({ countdowns: list })
    return list
  })

  ipcMain.handle('settings:close', () => {
    getSettingsWindow()?.hide()
    return true
  })

  /** 在线更新：状态由主进程唯一持有，界面只发指令、收推送 */
  ipcMain.handle('update:state', () => getUpdateState())
  ipcMain.handle('update:check', () => checkForUpdate(true))
  ipcMain.handle('update:download', () => downloadUpdate())
  ipcMain.handle('update:install', () => installUpdate())
  ipcMain.handle('update:openPage', () => openDownloadPage())

  /**
   * 编辑草稿：只推给组件窗口，既不写盘也不广播给设置窗口，
   * 因此编辑器自己依赖的 props.config 不会被草稿污染。
   * null 表示清空覆盖层 —— 桌面卡片随即回到「编辑前」的持久化配置。
   */
  ipcMain.handle('preview:set', (_event, item: unknown) => {
    setPreviewItem((item as CountdownItem | null) ?? null)
    pushWidgetConfig()
    return true
  })

  ipcMain.handle('runtime:setHotkey', (_event, accelerator: string) => {
    const ok = applyHotkey(String(accelerator ?? ''))
    return { ok, hotkey: getConfig().runtime.toggleHotkey, registered: isHotkeyRegistered() }
  })
  ipcMain.handle('runtime:setStartAtLogin', (_event, enabled: boolean) => {
    const next = Boolean(enabled)
    updateConfig({ runtime: { startAtLogin: next } })
    app.setLoginItemSettings({ openAtLogin: next, args: ['--hidden'] })
    refreshTray()
    return app.getLoginItemSettings().openAtLogin
  })
  ipcMain.handle('runtime:quit', () => {
    ;(app as unknown as { isQuitting?: boolean }).isQuitting = true
    app.quit()
  })
  ipcMain.handle('runtime:hideAll', () => {
    setWidgetVisible(false)
    getSettingsWindow()?.hide()
    return true
  })

  /** 托盘菜单内容变化后立刻重建菜单（标题、勾选状态都由配置派生） */
  ipcMain.handle('runtime:refreshTray', () => {
    refreshTray()
    return true
  })

  /** 透明渲染开关：切换后需要重建组件窗口 */
  ipcMain.handle('runtime:setTransparency', (_event, enabled: boolean) => {
    updateConfig({ runtime: { window: { transparent: Boolean(enabled) } } })
    recreateWidgetWindow()
    refreshTray()
    return useTransparentWindow()
  })
}

function bootstrap(): void {
  initConfig()
  registerIpc()
  setupWindowSync()

  // 开机先探测系统透明效果：DWM 会把透明窗口画成不透明块，此时改用不透明渲染
  setSystemTransparency(detectTransparency())

  const config = getConfig()
  const launchedHidden = process.argv.includes('--hidden')

  createWidgetWindow()
  createTray()
  registerHotkey()
  startReminders()
  // 更新：启动后静默查一次（只提示、不下载），并盯住更新源有没有被改
  watchUpdateConfig()
  scheduleAutoCheck()

  // 组件窗口被外部销毁（用户从任务栏关掉它）时，托盘文案要跟着回到「显示倒数日」，
  // 否则菜单一直写着「隐藏」，用户找不到把卡片叫回来的入口。
  setOnWidgetWindowClosed(() => refreshTray())

  onConfigChange((next) => {
    broadcast('config:changed', next)
    // 覆盖层存在期间，组件窗口拿到的必须是「最新持久化配置 + 草稿」
    pushWidgetConfig()
    refreshTray()
  })

  const widget = getWidgetWindow()
  if (widget) {
    applyPosition()
    if (!launchedHidden && config.runtime.widgetVisible) {
      // 用统一的显示路径：内含强制重绘，避免透明窗口显示后出现不透明背板
      widget.once('ready-to-show', () => showWidgetWindow(widget))
      // transparent 窗口偶发不触发 ready-to-show，兜底再确认一次
      setTimeout(() => {
        if (widget && !widget.isDestroyed() && !widget.isVisible() && config.runtime.widgetVisible) {
          showWidgetWindow(widget)
        }
      }, 700)
    }
  }
}

app.whenReady().then(() => {
  // 任务栏归属：与 package.json 的 appId 保持一致，打包后图标与名称才对得上
  app.setAppUserModelId('com.countingdown.widget')

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '编辑',
        submenu: [
          // 不注册 undo / redo：菜单快捷键会抢在渲染层之前处理 Ctrl+Z，
          // 导致设置页自己的「撤销上一次改动」永远收不到按键。
          // 输入框内的原生文本撤销由 Chromium 自己处理，不受影响。
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' }
        ]
      }
    ])
  )

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      const allowed = isDev() ? process.env.ELECTRON_RENDERER_URL ?? '' : 'file://'
      if (!url.startsWith(allowed)) {
        event.preventDefault()
        if (/^https?:/.test(url)) void shell.openExternal(url)
      }
    })
  })

  bootstrap()
})

/** 把更新状态推给设置窗口；窗口没开就丢掉，下次打开自己会拉一次 */
onUpdateChange((state) => {
  getSettingsWindow()?.webContents.send('update:state', state)
})

app.on('window-all-closed', () => {
  // 托盘常驻，窗口全部关闭也不退出
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWidgetWindow()
})

app.on('before-quit', () => {
  ;(app as unknown as { isQuitting?: boolean }).isQuitting = true
})

app.on('will-quit', () => {
  stopReminders()
  unregisterHotkey()
  destroyTray()
})

process.on('uncaughtException', (error) => {
  console.error('[main] uncaughtException', error)
})

/** 供自动化验证与调试使用的内部入口（等价于托盘左键单击） */
export function triggerWidgetToggle(): boolean {
  const visible = toggleWidgetVisible()
  refreshTray()
  return visible
}

export function openSettingsWindow(): Electron.BrowserWindow {
  return createSettingsWindow()
}
