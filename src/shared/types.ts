/**
 * 全应用共享的类型定义（主进程 / 预加载 / 两个渲染进程均引用）
 */

/** 目标日期语义 */
export type DateMode = 'annual' | 'once'
/**
 * 倒计时显示模式：
 * - days               只显示天数
 * - days-hours         天 + 时
 * - days-hours-minutes 天 + 时:分
 * - precise            天 + 时:分:秒（可用 showDaysInPrecise 去掉天数部分）
 */
export type DisplayMode = 'days' | 'days-hours' | 'days-hours-minutes' | 'precise'
/** 带时分秒的三种显示模式（除「只显示天数」以外） */
export type PrecisionMode = Exclude<DisplayMode, 'days'>
/** 日期语义；空串表示跟随全局 */
export type OptionalDateMode = DateMode | ''
/** 角落；custom 表示使用自定义参考基准 */
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'custom'
/** 界面语言 */
export type AppLanguage = 'zh-CN' | 'en-US'

export interface TargetConfig {
  /** annual = 每年重复（使用 month/day）；once = 一次性（使用 date） */
  mode: DateMode
  /** 一次性模式：YYYY-MM-DD，或 YYYY-MM-DDTHH:mm */
  date: string
  /** 每年重复模式：1-12 */
  month: number
  /** 每年重复模式：1-31 */
  day: number
}

/** 列表中的单个倒数日 */
export interface CountdownItem {
  id: string
  /** 列表里显示的名字，也作为组件默认标题 */
  name: string
  /** 是否启用；停用后不能被选为桌面显示项，会被归入「已停用」分组 */
  enabled: boolean
  /** 单项日期；字段留空表示跟随全局 */
  target: TargetConfig
  /** 单项文案覆盖；空字符串表示跟随全局 */
  text: TextOverride
  /** 单项外观覆盖；字段未设置表示跟随全局 */
  appearance: AppearanceOverride
}

/** 文案覆盖：空字符串表示跟随全局 */
export interface TextOverride {
  hint: string
  futureText: string
  todayText: string
  pastText: string
  unit: string
  /** 副标题是否显示；inherit = 跟随全局 */
  showHint: VisibilityOverride
  /** 状态文案是否显示；inherit = 跟随全局 */
  showStatus: VisibilityOverride
}

/** 外观覆盖：字段缺省表示跟随全局 */
export interface AppearanceOverride {
  fontFamily?: string
  /** 组件不透明度 0.2 - 1 */
  opacity?: number
  background?: Partial<BackgroundConfig>
  title?: TextStyle
  count?: TextStyle
  hint?: TextStyle
  status?: TextStyle
}

export interface TextConfig {
  /** 大数字下方的提示行；留空自动使用目标日期 */
  hint: string
  /** 状态文案模板：还有 {days} 天 */
  futureText: string
  /** 当天文案 */
  todayText: string
  /** 过期文案 */
  pastText: string
  /** days 模式下的单位 */
  unit: string
  /** 是否显示副标题（全局默认） */
  showHint: boolean
  /** 是否显示状态文案（全局默认） */
  showStatus: boolean
}

/** 三态覆盖：'inherit' 跟随全局，其余强制显示/隐藏 */
export type VisibilityOverride = 'inherit' | 'show' | 'hide'

export interface TextStyle {
  fontSize: number
  color: string
  weight: number
  /** 仅用于大数字 */
  letterSpacing: number
}

export interface BackgroundConfig {
  color: string
  /** 0 - 1 */
  alpha: number
  /** 圆角 px */
  radius: number
  /** 内边距 px */
  padding: number
  /** 卡片投影强度 0 - 100，0 为不显示 */
  shadow: number
  shadowColor: string
  borderWidth: number
  borderColor: string
  /** 卡片宽度 px，0 表示自适应内容 */
  width: number
}

export interface AppearanceConfig {
  fontFamily: string
  /** 整块组件的不透明度 0.2 - 1（与背景自身的 alpha 相乘） */
  opacity: number
  background: BackgroundConfig
  title: TextStyle
  count: TextStyle
  hint: TextStyle
  status: TextStyle
}

export interface BehaviorConfig {
  displayMode: DisplayMode
  /** precise 模式是否显示天数部分 */
  showDaysInPrecise: boolean
  /** 过期后显示「已过去 N 天」而不是纯文案 */
  showPastDays: boolean
  /** 组件是否始终置顶 */
  alwaysOnTop: boolean
}

export interface WindowConfig {
  /** 角落预设；custom 表示使用自定义参考基准 */
  corner: Corner
  /** 偏移量的参考基准：某个角落，或自定义屏幕坐标 */
  cornerPreset: Corner
  /** 自定义参考基准的屏幕坐标（cornerPreset === 'custom' 时生效） */
  anchorX: number
  anchorY: number
  /** 相对参考基准的偏移量 */
  offsetX: number
  offsetY: number
  /** 是否允许直接用鼠标拖动组件（拖动结束后自动换算成偏移量） */
  allowDrag: boolean
  /**
   * 是否使用透明窗口。
   * 某些机器上 Windows 会把透明窗口渲染成不透明白块（整窗浅色背板），
   * 此时关掉它改为「整窗即卡片」的不透明渲染。
   */
  transparent: boolean
  /** 兼容旧结构：自由拖动留下的绝对坐标 */
  x: number
  y: number
}

/** 用户自己保存的外观预设 */
export interface CustomPreset {
  id: string
  name: string
  createdAt: number
  appearance: AppearanceConfig
}

export interface RuntimeConfig {
  /** 组件窗口是否显示 */
  widgetVisible: boolean
  /** 全局快捷键（Electron accelerator，留空表示禁用） */
  toggleHotkey: string
  startAtLogin: boolean
  language: AppLanguage
  /** 主题模式：影响托盘与设置界面的明暗 */
  theme: 'light' | 'dark'
  window: WindowConfig
}

export interface AppConfig {
  /** 倒数日列表 */
  countdowns: CountdownItem[]
  /** 当前显示在桌面上的倒数日 id */
  activeId: string
  /** 全局日期语义：单项字段留空时使用 */
  target: TargetConfig
  /** 全局文案：单项留空时使用 */
  text: TextConfig
  /** 全局外观 */
  appearance: AppearanceConfig
  behavior: BehaviorConfig
  runtime: RuntimeConfig
  /** 用户保存的外观预设 */
  customPresets: CustomPreset[]
}

export interface ScreenInfo {
  /** Electron display id */
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  primary: boolean
}

export interface HostInfo {
  appVersion: string
  electron: string
  platform: string
  screens: ScreenInfo[]
  shortcutRegistered: boolean
  hotkey: string
  startAtLogin: boolean
  isDev: boolean
  /** 系统是否支持/开启了透明效果 */
  systemTransparency: boolean
  /** 组件窗口当前是否真的使用透明渲染 */
  widgetTransparent: boolean
}

export interface ThemePreset {
  id: string
  nameZh: string
  nameEn: string
  appearance: AppearanceConfig
}

/** 解析后的有效配置：把单项覆盖与全局值合并 */
export interface ResolvedCountdown {
  id: string
  name: string
  target: TargetConfig
  text: {
    title: string
    hint: string
    futureText: string
    todayText: string
    pastText: string
    unit: string
  }
  /** 副标题最终是否显示（单项三态覆盖优先于全局） */
  showHint: boolean
  /** 状态文案最终是否显示 */
  showStatus: boolean
  appearance: AppearanceConfig
}

/** 某个文案字段「实际生效的值」的解析结果 */
export interface FieldResolution {
  /** 最终生效的值 */
  value: string
  /** 来源：单项自填 / 全局设置 / 内置默认 */
  source: 'item' | 'global' | 'default'
}

/** 显示开关（副标题/状态文案）的解析结果 */
export interface VisibilityResolution {
  show: boolean
  source: 'item' | 'global'
}
