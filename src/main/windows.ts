import { join } from 'node:path'
import { BrowserWindow, app, nativeTheme, screen, shell } from 'electron'
import { getConfig, isDev, onConfigChange, updateConfig } from './config-store'
import type { Corner } from '../shared/types'

let widgetWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
/** 光标轮询定时器：透明窗口无法收到鼠标事件，改为主动告知渲染层光标位置 */
let cursorTimer: NodeJS.Timeout | null = null
let lastCursor: { x: number; y: number } | null = null

/**
 * 渲染层最近一次请求的命中状态：true = 指针在卡片上、窗口要接收鼠标，false = 空白处穿透。
 *
 * 这个状态只在窗口「已经显示」之后才能落到原生窗口上：
 * 一旦在首次显示之前调用 setIgnoreMouseEvents，Windows 会让分层窗口丢掉逐像素透明，
 * 整窗被画成一块不透光的浅色背板（624×600 的白色方块），而且之后再怎么调用都救不回来，
 * 只能重建窗口。非置顶窗口尤其明显（置顶时观察不到）。
 */
let widgetInteractive = false

/** 把命中状态落到原生窗口；窗口没显示过就只记状态，等显示后再应用 */
function applyIgnoreMouse(win: BrowserWindow): void {
  // 不透明兜底模式下整窗就是卡片，必须始终可点，不需要穿透
  if (!useTransparentWindow()) return
  if (!win.isVisible()) return
  win.setIgnoreMouseEvents(!widgetInteractive, { forward: true })
}

function stopCursorWatch(): void {
  if (cursorTimer) {
    clearInterval(cursorTimer)
    cursorTimer = null
  }
  lastCursor = null
}

function startCursorWatch(): void {
  stopCursorWatch()
  cursorTimer = setInterval(() => {
    const win = getWidgetWindow()
    if (!win || !win.isVisible()) {
      lastCursor = null
      return
    }
    const point = screen.getCursorScreenPoint()
    if (lastCursor && lastCursor.x === point.x && lastCursor.y === point.y) return
    lastCursor = point
    win.webContents.send('widget:cursor', point)
  }, 80)
}

// 组件窗口：比卡片本身留出 24px 内边距，保证卡片到屏幕边缘的距离与四个方向一致
const WIDGET_ANCHOR_SIZE = 624
const WIDGET_ANCHOR_HEIGHT = 600

const rendererDir = (): string => join(__dirname, '../renderer')

function loadRenderer(win: BrowserWindow, page: 'widget' | 'settings'): void {
  if (isDev() && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}.html`)
  } else {
    void win.loadFile(join(rendererDir(), `${page}.html`))
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 贴角时的基础留白；偏移量在此基础上叠加 */
const EDGE_INSET = 20

/**
 * 检测 Windows 是否开启「透明效果」。
 * 关闭时透明窗口会被 DWM 渲染成不透明白块（整窗浅色背板），此时应当用不透明模式。
 */
function detectTransparency(): boolean {
  if (process.platform !== 'win32') return true
  // 便于无人值守验证：强制指定系统透明能力
  if (process.env.CD_FORCE_SYSTEM_TRANSPARENCY === '0') return false
  if (process.env.CD_FORCE_SYSTEM_TRANSPARENCY === '1') return true
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
    const out = execFileSync(
      'reg',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
        '/v',
        'EnableTransparency'
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }
    )
    const match = /EnableTransparency\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(String(out))
    if (match) return parseInt(match[1], 16) !== 0
  } catch (error) {
    console.warn('[window] 无法读取透明效果设置，按开启处理', error)
  }
  return true
}

let systemTransparency = true

export function setSystemTransparency(value: boolean): void {
  systemTransparency = value
}

export function getSystemTransparency(): boolean {
  return systemTransparency
}

/** 配置里的开关 + 系统能力，两者都满足才真的用透明窗口 */
export function useTransparentWindow(): boolean {
  return getConfig().runtime.window.transparent !== false && systemTransparency
}

export { detectTransparency }

/**
 * 依据「参考基准 + 偏移量」计算窗口左上角坐标。
 * - 基准为某个角落：先按 EDGE_INSET 贴角，再叠加偏移量（距该角两条边的距离）
 * - 基准为自定义坐标：偏移量相对该坐标点，坐标与偏移都会限制在屏幕范围内
 */
export function computeCornerPosition(width: number, height: number): { x: number; y: number } {
  const display = screen.getPrimaryDisplay()
  const area = display.workArea
  const win = getConfig().runtime.window
  const preset = win.cornerPreset === 'custom' ? 'custom' : win.cornerPreset
  const offsetX = clamp(Math.round(win.offsetX || 0), -area.width, area.width)
  const offsetY = clamp(Math.round(win.offsetY || 0), -area.height, area.height)
  const inset = EDGE_INSET
  const shiftX = inset + offsetX
  const shiftY = inset + offsetY

  let x: number
  let y: number

  if (preset === 'custom') {
    const anchorX = clamp(Math.round(win.anchorX || 0), area.x, area.x + area.width)
    const anchorY = clamp(Math.round(win.anchorY || 0), area.y, area.y + area.height)
    x = anchorX + offsetX
    y = anchorY + offsetY
  } else {
    const [vertical, horizontal] = preset.split('-')
    x = horizontal === 'left' ? area.x + shiftX : area.x + area.width - width - shiftX
    y = vertical === 'top' ? area.y + shiftY : area.y + area.height - height - shiftY
  }

  // 保证窗口至少有一部分留在工作区内，避免出现“点了找不到”的恶性情况
  x = clamp(x, area.x - width + 80, area.x + area.width - 80)
  y = clamp(y, area.y, area.y + area.height - 40)
  return { x: Math.round(x), y: Math.round(y) }
}

function widgetBoundsByConfig(): { x: number; y: number; width: number; height: number } {
  const width = WIDGET_ANCHOR_SIZE
  const height = WIDGET_ANCHOR_HEIGHT
  const pos = computeCornerPosition(width, height)
  return { ...pos, width, height }
}

export function createWidgetWindow(): BrowserWindow {
  if (widgetWindow && !widgetWindow.isDestroyed()) return widgetWindow
  // 新窗口配新的渲染进程，命中状态从「未命中」重新开始，避免沿用旧窗口的状态
  widgetInteractive = false
  const bounds = widgetBoundsByConfig()
  const transparent = useTransparentWindow()
  widgetWindow = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent,
    // 始终用全透明底色：是否真透明由 Windows 的 transparent 属性决定，
    // 这样在“不透明兜底模式”下也能让卡片的圆角外侧露出桌面。
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: getConfig().behavior.alwaysOnTop,
    hasShadow: false,
    acceptFirstMouse: true,
    autoHideMenuBar: true,
    // 透明模式下自己画圆角；不透明模式让系统给窗口加圆角，避免出现直角大色块
    roundedCorners: transparent,
    title: '倒数日',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  })
  widgetWindow.setAlwaysOnTop(getConfig().behavior.alwaysOnTop, 'screen-saver')
  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  widgetWindow.setSkipTaskbar(true)
  // 注意：这里不能设置鼠标穿透。窗口显示之前调用 setIgnoreMouseEvents 会让整窗变成
  // 不透光的浅色背板，必须等 showWidgetWindow 显示之后再应用（见 applyIgnoreMouse）。

  widgetWindow.on('closed', () => {
    widgetWindow = null
    cancelWidgetDrag()
    stopCursorWatch()
  })

  loadRenderer(widgetWindow, 'widget')
  startCursorWatch()
  return widgetWindow
}

export function getWidgetWindow(): BrowserWindow | null {
  return widgetWindow && !widgetWindow.isDestroyed() ? widgetWindow : null
}

/** 透明/不透明模式切换需要重建窗口（transparent 只能在创建时指定） */
export function recreateWidgetWindow(): BrowserWindow {
  const visible = getWidgetWindow()?.isVisible() ?? true
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.destroy()
  }
  widgetWindow = null
  const next = createWidgetWindow()
  if (visible) showWidgetWindow(next)
  return next
}

export function applyPosition(): void {
  const win = getWidgetWindow()
  if (!win) return
  win.setBounds(widgetBoundsByConfig())
}

/* ------------------------------------------------------------------ *
 * 拖动组件：渲染层按下卡片后由主进程轮询光标移动窗口，松手时把落点
 * 换算成「最近角落 + 偏移量」写回配置，设置里的布局面板随即同步。
 * ------------------------------------------------------------------ */

/** 卡片相对窗口的位置（渲染层在按下时上报，用于换算落点） */
export interface DragCardRect {
  left: number
  top: number
  width: number
  height: number
}

interface DragState {
  /** 按下时的屏幕光标位置 */
  cursor: { x: number; y: number }
  /** 按下时的窗口位置与尺寸 */
  bounds: Electron.Rectangle
  /** 卡片相对窗口的位置 */
  card: DragCardRect
  /** 按下时的角落对齐方式（拖动过程中不变） */
  corner: Corner
}

let dragTimer: NodeJS.Timeout | null = null
let dragState: DragState | null = null

function stopDragTimer(): void {
  if (dragTimer) {
    clearInterval(dragTimer)
    dragTimer = null
  }
}

/**
 * 把窗口位置限制在「卡片完整落在工作区内」的范围里。
 *
 * 窗口（624×600）比卡片大得多，如果按窗口整块留在工作区内来限制，卡片在纵向就
 * 只能移动 480px 左右，根本拖不到屏幕另一半；反过来也不能让卡片跑出屏幕。
 * 上限同时不越过 computeCornerPosition 的兜底范围，保证「配置 -> 位置」能精确还原。
 */
function clampWindowForCard(
  x: number,
  y: number,
  bounds: Electron.Rectangle,
  card: DragCardRect
): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea
  const minX = Math.max(area.x - card.left, area.x - bounds.width + 80)
  const maxX = Math.min(area.x + area.width - (card.left + card.width), area.x + area.width - 80)
  const minY = Math.max(area.y - card.top, area.y)
  const maxY = Math.min(area.y + area.height - (card.top + card.height), area.y + area.height - 40)
  return {
    x: Math.round(clamp(x, Math.min(minX, maxX), Math.max(minX, maxX))),
    y: Math.round(clamp(y, Math.min(minY, maxY), Math.max(minY, maxY)))
  }
}

function normalizeCardRect(input: unknown): DragCardRect | null {
  const source = input as Partial<DragCardRect> | undefined
  if (!source) return null
  const left = Number(source.left)
  const top = Number(source.top)
  const width = Number(source.width)
  const height = Number(source.height)
  if (![left, top, width, height].every((value) => Number.isFinite(value))) return null
  if (width <= 1 || height <= 1) return null
  return { left, top, width, height }
}

/** 卡片在窗口内的位置：只有贴着的那条边会跟随角落变化 */
function cardRectInWindow(
  corner: Corner,
  from: Corner,
  card: DragCardRect,
  bounds: Electron.Rectangle
): DragCardRect {
  const [fromVertical, fromHorizontal] = (from === 'custom' ? 'top-left' : from).split('-')
  const [vertical, horizontal] = (corner === 'custom' ? 'top-left' : corner).split('-')
  const gapX = fromHorizontal === 'left' ? card.left : bounds.width - card.width - card.left
  const gapY = fromVertical === 'top' ? card.top : bounds.height - card.height - card.top
  return {
    left: horizontal === 'left' ? gapX : bounds.width - gapX - card.width,
    top: vertical === 'top' ? gapY : bounds.height - gapY - card.height,
    width: card.width,
    height: card.height
  }
}

/** 开始拖动；返回 false 表示当前不允许拖动（设置里关掉了 / 窗口不存在） */
export function beginWidgetDrag(input: unknown): boolean {
  const win = getWidgetWindow()
  const card = normalizeCardRect(input)
  if (!win || !card) return false
  const config = getConfig()
  if (config.runtime.window.allowDrag === false) return false
  cancelWidgetDrag()
  dragState = {
    cursor: screen.getCursorScreenPoint(),
    bounds: win.getBounds(),
    card,
    corner: config.runtime.window.corner
  }
  // 拖动期间必须保持可命中：光标一旦甩到卡片外，穿透会让拖动直接断掉
  widgetInteractive = true
  applyIgnoreMouse(win)
  dragTimer = setInterval(() => tickWidgetDrag(), 16)
  return true
}

function tickWidgetDrag(): void {
  const win = getWidgetWindow()
  if (!win || !dragState) {
    cancelWidgetDrag()
    return
  }
  const point = screen.getCursorScreenPoint()
  const next = clampWindowForCard(
    dragState.bounds.x + (point.x - dragState.cursor.x),
    dragState.bounds.y + (point.y - dragState.cursor.y),
    dragState.bounds,
    dragState.card
  )
  const current = win.getBounds()
  if (current.x !== next.x || current.y !== next.y) {
    win.setBounds({ ...current, x: next.x, y: next.y })
  }
}

/**
 * 结束拖动：按卡片中心的落点选择最近的角落，并把窗口摆到「新角落 + 新偏移量」
 * 能还原出同一落点的位置，这样松手时卡片不会跳。
 */
export function endWidgetDrag(): boolean {
  stopDragTimer()
  const win = getWidgetWindow()
  const state = dragState
  dragState = null
  if (!win || !state) return false

  const area = screen.getPrimaryDisplay().workArea
  const bounds = win.getBounds()
  const card = state.card

  // 拖动过程中角落没变，所以卡片相对窗口的位置仍是按下时上报的那个
  const cardLeft = bounds.x + card.left
  const cardTop = bounds.y + card.top

  const horizontal = cardLeft + card.width / 2 <= area.x + area.width / 2 ? 'left' : 'right'
  const vertical = cardTop + card.height / 2 <= area.y + area.height / 2 ? 'top' : 'bottom'
  const corner = `${vertical}-${horizontal}` as Corner
  const next = cardRectInWindow(corner, state.corner, card, bounds)

  const pos = clampWindowForCard(cardLeft - next.left, cardTop - next.top, bounds, next)
  win.setBounds({ ...bounds, x: pos.x, y: pos.y })

  const offsetX =
    horizontal === 'left'
      ? pos.x - area.x - EDGE_INSET
      : area.x + area.width - (pos.x + bounds.width) - EDGE_INSET
  const offsetY =
    vertical === 'top'
      ? pos.y - area.y - EDGE_INSET
      : area.y + area.height - (pos.y + bounds.height) - EDGE_INSET

  updateConfig({
    runtime: {
      window: {
        corner,
        cornerPreset: corner,
        offsetX: Math.round(offsetX),
        offsetY: Math.round(offsetY)
      }
    }
  })
  return true
}

/** 放弃拖动（窗口被隐藏/销毁时调用）：保留窗口当前位置，不写配置 */
export function cancelWidgetDrag(): void {
  stopDragTimer()
  dragState = null
}

/** 透明区域点击穿透开关：指针在卡片上时恢复鼠标事件 */
export function setWidgetInteractive(interactive: boolean): void {
  widgetInteractive = interactive
  const win = getWidgetWindow()
  if (!win) return
  applyIgnoreMouse(win)
  // 窗口隐藏时状态只记在 widgetInteractive 上，等下次显示后由 showWidgetWindow 应用
}

/**
 * 用 1px 位移抖动强制触发一次重新合成，缓解分层窗口在 showInactive() 之后偶尔不重绘的问题。
 * 注意：它治不了「整窗浅色背板」——那个问题的根因是首次显示前调用了 setIgnoreMouseEvents，
 * 已经在上面的 applyIgnoreMouse 里从源头规避，重建窗口之外的调用都无法修复。
 */
function nudgeRepaint(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const bounds = win.getBounds()
  try {
    win.setBounds({ ...bounds, x: bounds.x + 1 })
    win.setBounds(bounds)
  } catch (error) {
    console.warn('[window] 强制重绘失败', error)
  }
}

export function showWidgetWindow(win: BrowserWindow): void {
  applyPosition()
  win.showInactive()
  // 鼠标穿透必须等窗口显示之后再设置，否则会触发整窗浅色背板（见 widgetInteractive 注释）
  applyIgnoreMouse(win)
  // 显示后命中状态已按 widgetInteractive 重置，通知渲染层丢掉缓存的判定结果，
  // 让它在下一次光标轮询里重新判断指针是否落在卡片上
  if (!win.webContents.isDestroyed()) win.webContents.send('widget:shown')
  lastCursor = null
  nudgeRepaint(win)
}

export function setWidgetVisible(visible: boolean): boolean {
  const win = getWidgetWindow()
  updateConfig({ runtime: { widgetVisible: visible } })
  if (!win) return visible
  if (visible) {
    showWidgetWindow(win)
  } else {
    cancelWidgetDrag()
    win.hide()
    setWidgetInteractive(false)
  }
  return visible
}

export function toggleWidgetVisible(): boolean {
  return setWidgetVisible(!getConfig().runtime.widgetVisible)
}

export function createSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }
  settingsWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    show: false,
    title: '倒数日 · 设置',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#17181d' : '#f5f6fa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })
  // 设置窗口保留在任务栏中，方便切换
  settingsWindow.setSkipTaskbar(false)
  settingsWindow.on('close', (event) => {
    if (!(app as unknown as { isQuitting?: boolean }).isQuitting) {
      event.preventDefault()
      settingsWindow?.hide()
    }
  })
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  loadRenderer(settingsWindow, 'settings')
  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show()
    settingsWindow?.focus()
  })
  return settingsWindow
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null
}

export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function setupWindowSync(): void {
  onConfigChange((config) => {
    const win = getWidgetWindow()
    if (!win) return
    win.setAlwaysOnTop(config.behavior.alwaysOnTop, 'screen-saver')
    // 只处理「配置说显示但窗口还没显示」的情况，走统一显示路径（含强制重绘）
    if (config.runtime.widgetVisible && !win.isVisible()) showWidgetWindow(win)
    if (!config.runtime.widgetVisible && win.isVisible()) win.hide()
  })

  const onDisplayChange = (): void => {
    if (getConfig().runtime.window.corner !== 'custom') applyPosition()
  }
  screen.on('display-metrics-changed', onDisplayChange)
  screen.on('display-added', onDisplayChange)
  screen.on('display-removed', onDisplayChange)
}

export { WIDGET_ANCHOR_SIZE, WIDGET_ANCHOR_HEIGHT }
