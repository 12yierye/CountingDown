import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, Corner, CountdownItem, HostInfo } from '../shared/types'

type Unsubscribe = () => void

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  updateConfig: (patch: unknown): Promise<AppConfig> => ipcRenderer.invoke('config:update', patch),
  resetConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:reset'),
  getConfigPath: (): Promise<string> => ipcRenderer.invoke('config:path'),
  onConfigChange: (handler: (config: AppConfig) => void): Unsubscribe => {
    const listener = (_event: unknown, config: AppConfig): void => handler(config)
    ipcRenderer.on('config:changed', listener)
    return () => {
      ipcRenderer.removeListener('config:changed', listener)
    }
  },

  getHostInfo: (): Promise<HostInfo> => ipcRenderer.invoke('host:info'),
  openConfigFile: (): Promise<string> => ipcRenderer.invoke('host:openConfigFile'),

  toggleWidget: (): Promise<boolean> => ipcRenderer.invoke('widget:toggle'),
  setWidgetVisible: (visible: boolean): Promise<boolean> =>
    ipcRenderer.invoke('widget:setVisible', visible),
  showSettings: (): Promise<boolean> => ipcRenderer.invoke('widget:showSettings'),
  setInteractive: (interactive: boolean): Promise<boolean> =>
    ipcRenderer.invoke('widget:setInteractive', interactive),
  /** 开始拖动：传入卡片相对窗口的位置，主进程据此换算落点 */
  beginDrag: (card: { left: number; top: number; width: number; height: number }): Promise<boolean> =>
    ipcRenderer.invoke('widget:dragStart', card),
  /** 结束拖动：主进程写入新的角落与偏移量 */
  endDrag: (): Promise<boolean> => ipcRenderer.invoke('widget:dragEnd'),
  onCursor: (handler: (point: { x: number; y: number }) => void): Unsubscribe => {
    const listener = (_event: unknown, point: { x: number; y: number }): void => handler(point)
    ipcRenderer.on('widget:cursor', listener)
    return () => {
      ipcRenderer.removeListener('widget:cursor', listener)
    }
  },
  /** 主进程每次显示组件后都会发一次：渲染层需要丢掉缓存的命中状态重新判定 */
  onWidgetShown: (handler: () => void): Unsubscribe => {
    const listener = (): void => handler()
    ipcRenderer.on('widget:shown', listener)
    return () => {
      ipcRenderer.removeListener('widget:shown', listener)
    }
  },
  snapCorner: (corner: Corner): Promise<Corner> => ipcRenderer.invoke('widget:snapCorner', corner),

  setActiveCountdown: (id: string): Promise<string> =>
    ipcRenderer.invoke('countdown:setActive', id),
  setCountdownEnabled: (id: string, enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('countdown:setEnabled', { id, enabled }),
  reorderCountdowns: (from: number, to: number): Promise<unknown> =>
    ipcRenderer.invoke('countdown:reorder', from, to),

  closeSettings: (): Promise<boolean> => ipcRenderer.invoke('settings:close'),

  /** 编辑草稿：发给主进程做桌面实时预览，null 表示清空覆盖层（= 还原） */
  setPreviewItem: (item: CountdownItem | null): Promise<boolean> =>
    ipcRenderer.invoke('preview:set', item),
  /** 组件窗口专用：主进程推来的「持久化配置 + 草稿」 */
  onWidgetConfig: (handler: (config: AppConfig) => void): Unsubscribe => {
    const listener = (_event: unknown, config: AppConfig): void => handler(config)
    ipcRenderer.on('widget:preview', listener)
    return () => {
      ipcRenderer.removeListener('widget:preview', listener)
    }
  },
  /** 设置窗口重新显示时主进程会发一次：编辑器据此重发当前草稿 */
  onPreviewSync: (handler: () => void): Unsubscribe => {
    const listener = (): void => handler()
    ipcRenderer.on('preview:sync', listener)
    return () => {
      ipcRenderer.removeListener('preview:sync', listener)
    }
  },

  setHotkey: (accelerator: string): Promise<{ ok: boolean; hotkey: string; registered: boolean }> =>
    ipcRenderer.invoke('runtime:setHotkey', accelerator),
  setStartAtLogin: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('runtime:setStartAtLogin', enabled),
  setTransparency: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('runtime:setTransparency', enabled),
  /** 托盘菜单内容变化后重建菜单，让新的开关立刻生效 */
  refreshTray: (): Promise<boolean> => ipcRenderer.invoke('runtime:refreshTray'),
  quitApp: (): Promise<void> => ipcRenderer.invoke('runtime:quit'),
  hideAll: (): Promise<boolean> => ipcRenderer.invoke('runtime:hideAll'),

  platform: process.platform
}

export type CountingDownApi = typeof api

contextBridge.exposeInMainWorld('cd', api)
