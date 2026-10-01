import type {
  AppConfig,
  AppearanceConfig,
  AppearanceOverride,
  BehaviorConfig,
  CountdownItem,
  DisplayMode,
  FieldResolution,
  PrecisionMode,
  ResolvedCountdown,
  SeparatorConfig,
  SeparatorOverride,
  TargetConfig,
  TextConfig,
  TextOverride,
  TextStyle,
  ThemePreset,
  TrayMenuConfig,
  VisibilityOverride,
  VisibilityResolution
} from './types'

/** 可覆盖的文案字段（不含三个显示开关） */
type TextFieldKey = 'hint' | 'futureText' | 'todayText' | 'pastText' | 'unit'

export const DAY_MS = 86_400_000

/** 文字透明度的合法区间 */
export const TEXT_ALPHA_MIN = 0
export const TEXT_ALPHA_MAX = 1

/** 把任意输入收敛到合法的文字透明度 */
export function clampTextAlpha(value: unknown, fallback = 1): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(TEXT_ALPHA_MAX, Math.max(TEXT_ALPHA_MIN, Number(n.toFixed(2))))
}

/** 单个文字样式的透明度合法区间 */
export const STYLE_OPACITY_MIN = 0.05
export const STYLE_OPACITY_MAX = 1

/** 把任意输入收敛到合法的单项文字透明度；0 会让文字彻底消失，所以下限不取 0 */
export function clampStyleOpacity(value: unknown, fallback = 1): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(
    STYLE_OPACITY_MAX,
    Math.max(STYLE_OPACITY_MIN, Number(n.toFixed(2)))
  )
}

/** 补齐文字样式里可能缺失的透明度（旧配置 / 旧预设没有这个字段） */
export function normalizeTextStyle(style: TextStyle): TextStyle {
  return { ...style, opacity: clampStyleOpacity(style?.opacity, 1) }
}

export function createItemId(): string {
  return `cd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function emptyTextOverride(): TextOverride {
  return {
    hint: '',
    futureText: '',
    todayText: '',
    pastText: '',
    unit: '',
    showHint: 'inherit',
    showStatus: 'inherit',
    showUnit: 'inherit'
  }
}

function emptySeparatorOverride(): SeparatorOverride {
  return { enabled: false, hm: '', ms: '' }
}

function emptyTarget(): TargetConfig {
  return { mode: 'annual', date: '', month: 1, day: 1 }
}

export function createCountdownItem(partial: Partial<CountdownItem> = {}): CountdownItem {
  return {
    id: partial.id ?? createItemId(),
    name: partial.name ?? '',
    enabled: partial.enabled ?? true,
    target: partial.target ?? emptyTarget(),
    text: { ...emptyTextOverride(), ...(partial.text ?? {}) },
    separator: { ...emptySeparatorOverride(), ...(partial.separator ?? {}) },
    appearance: partial.appearance ?? {}
  }
}

/**
 * 内置兜底值：单项留空、全局也留空时最终生效的内容。
 * 编辑页的 placeholder 会显示这个链路解析出来的结果。
 */
export const BUILTIN_TEXT: TextConfig = {
  hint: '',
  futureText: '还有 {days} 天',
  todayText: '就在今天！',
  pastText: '已远去',
  unit: '天',
  showHint: true,
  showStatus: true,
  showUnit: true
}

/** 内置兜底的分隔符：天/时/分 都用中文单位，最后一段不带分隔 */
export const BUILTIN_SEPARATOR: SeparatorConfig = { hm: '时', ms: '分' }

/** 分隔符下拉里的常见选项（仍可自由输入） */
export const SEPARATOR_PRESETS = [':', '时', '分', '秒', '·', ' ', '天'] as const

/** 单项分隔符 -> 全局分隔符 -> 内置默认 */
export function resolveSeparator(
  override: SeparatorOverride | undefined,
  global: SeparatorConfig | undefined
): SeparatorConfig {
  if (override?.enabled) {
    return { hm: override.hm ?? '', ms: override.ms ?? '' }
  }
  return {
    hm: global?.hm ?? BUILTIN_SEPARATOR.hm,
    ms: global?.ms ?? BUILTIN_SEPARATOR.ms
  }
}

/** 副标题/状态文案的显示与否：单项三态优先，其次全局 */
export function resolveVisibility(
  override: VisibilityOverride | undefined,
  globalValue: boolean
): VisibilityResolution {
  if (override === 'show') return { show: true, source: 'item' }
  if (override === 'hide') return { show: false, source: 'item' }
  return { show: globalValue !== false, source: 'global' }
}

/** 单项 -> 全局 -> 内置默认 的解析，返回每个字段的实际生效值 */
export function resolveTextField(
  item: TextOverride | undefined,
  global: TextConfig,
  key: TextFieldKey
): FieldResolution {
  const own = (item?.[key] ?? '').trim()
  if (own) return { value: own, source: 'item' }
  const fromGlobal = (global[key] ?? '').trim()
  if (fromGlobal) return { value: fromGlobal, source: 'global' }
  return { value: BUILTIN_TEXT[key], source: 'default' }
}

/** 一次性把整组文案解析出来 */
export function resolveText(
  item: TextOverride | undefined,
  global: TextConfig
): Record<TextFieldKey, FieldResolution> {
  const keys: TextFieldKey[] = ['hint', 'futureText', 'todayText', 'pastText', 'unit']
  const out = {} as Record<TextFieldKey, FieldResolution>
  for (const key of keys) out[key] = resolveTextField(item, global, key)
  return out
}

/** 日期字段是否留空（留空即跟随全局） */
export function isTargetBlank(target: TargetConfig | undefined | null): boolean {
  if (!target) return true
  if (target.mode === 'once') return !String(target.date ?? '').trim()
  const month = Number(target.month)
  const day = Number(target.day)
  return !Number.isFinite(month) || !Number.isFinite(day) || month <= 0 || day <= 0
}

/** 单项日期 -> 全局日期 -> 内置默认 */
export function resolveTarget(
  item: TargetConfig | undefined | null,
  global: TargetConfig
): TargetConfig {
  if (!isTargetBlank(item)) return item as TargetConfig
  if (!isTargetBlank(global)) return global
  return emptyTarget()
}

export function createDefaultConfig(): AppConfig {
  const now = new Date()
  const nextYear = now.getFullYear() + 1
  const first = createCountdownItem({
    name: '元旦',
    target: { mode: 'annual', date: `${nextYear}-01-01T00:00`, month: 1, day: 1 }
  })
  return {
    countdowns: [first],
    activeId: first.id,
    target: {
      mode: 'annual',
      date: `${nextYear}-01-01T00:00`,
      month: 1,
      day: 1
    },
    text: {
      hint: '',
      futureText: '还有 {days} 天',
      todayText: '就在今天！',
      pastText: '已远去',
      unit: '天',
      showHint: true,
      showStatus: true,
      showUnit: true
    },
    appearance: {
      fontFamily:
        '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", system-ui, sans-serif',
      textAlpha: 1,
      background: {
        color: '#1e2230',
        alpha: 0.78,
        radius: 18,
        padding: 20,
        shadow: 45,
        shadowColor: '#000000',
        borderWidth: 1,
        borderColor: '#ffffff2e',
        width: 0
      },
      title: { fontSize: 16, color: '#b9c4dc', weight: 500, letterSpacing: 0, opacity: 0.9 },
      count: { fontSize: 64, color: '#ffffff', weight: 700, letterSpacing: -1, opacity: 1 },
      hint: { fontSize: 14, color: '#a7b3cc', weight: 400, letterSpacing: 0, opacity: 0.9 },
      status: { fontSize: 15, color: '#7ec8ff', weight: 500, letterSpacing: 0, opacity: 1 }
    },
    behavior: {
      displayMode: 'days',
      showDaysInPrecise: true,
      separatorHM: BUILTIN_SEPARATOR.hm,
      separatorMS: BUILTIN_SEPARATOR.ms,
      showPastDays: false,
      alwaysOnTop: true
    },
    runtime: {
      widgetVisible: true,
      toggleHotkey: 'ScrollLock',
      startAtLogin: false,
      language: 'zh-CN',
      theme: 'dark',
      window: {
        corner: 'top-right',
        cornerPreset: 'top-right',
        anchorX: 0,
        anchorY: 0,
        offsetX: 0,
        offsetY: 0,
        allowDrag: true,
        clickThrough: false,
        transparent: true,
        layoutVersion: 2
      },
      trayMenu: {
        toggleVisible: true,
        resetPosition: true,
        allowDrag: true,
        alwaysOnTop: true,
        startAtLogin: true,
        hotkey: true
      }
    },
    customPresets: []
  }
}

/** 深合并，用于把持久化配置补齐到最新结构 */
export function mergeConfig(base: AppConfig, patch: unknown): AppConfig {
  if (!patch || typeof patch !== 'object') return base
  const merge = (
    target: Record<string, unknown>,
    source: Record<string, unknown>
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...target }
    for (const [key, value] of Object.entries(source)) {
      const current = target[key]
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        current &&
        typeof current === 'object' &&
        !Array.isArray(current)
      ) {
        out[key] = merge(current as Record<string, unknown>, value as Record<string, unknown>)
      } else if (value !== undefined) {
        out[key] = value
      }
    }
    return out
  }
  const merged = merge(
    base as unknown as Record<string, unknown>,
    patch as Record<string, unknown>
  ) as unknown as AppConfig
  // 数组按下标深合并会串味，列表整体替换更安全
  if (Array.isArray((patch as { countdowns?: unknown }).countdowns)) {
    merged.countdowns = (patch as { countdowns: CountdownItem[] }).countdowns.map((item) =>
      normalizeItem(item)
    )
  }
  return normalizeConfig(merged)
}

function normalizeItem(item: CountdownItem): CountdownItem {
  return {
    id: item.id || createItemId(),
    name: item.name ?? '',
    enabled: item.enabled !== false,
    target: item.target ?? emptyTarget(),
    text: { ...emptyTextOverride(), ...(item.text ?? {}) },
    separator: { ...emptySeparatorOverride(), ...(item.separator ?? {}) },
    appearance: normalizeOverride(item.appearance)
  }
}

/**
 * 外观覆盖清理：旧版本存过 `opacity`（整块组件的不透明度），现在已由
 * 「背景透明度 + 文字透明度」取代，读到就丢掉，免得它继续以未知字段躺在配置里。
 */
function normalizeOverride(input: AppearanceOverride | undefined): AppearanceOverride {
  if (!input) return {}
  const out: AppearanceOverride = {}
  if (typeof input.fontFamily === 'string' && input.fontFamily) out.fontFamily = input.fontFamily
  if (input.textAlpha !== undefined) out.textAlpha = clampTextAlpha(input.textAlpha, 1)
  if (input.background && Object.keys(input.background).length) {
    out.background = { ...input.background }
  }
  for (const key of ['title', 'count', 'hint', 'status'] as const) {
    const style = input[key]
    if (style && Object.keys(style).length) out[key] = normalizeTextStyle(style)
  }
  return out
}

/** 全部合法的显示模式，用于兜底非法值（旧配置 / 手改配置） */
const DISPLAY_MODES: DisplayMode[] = ['days', 'days-hours', 'days-hours-minutes', 'precise']

/** 分隔符兜底：非字符串一律回落到内置默认，长度也收一收 */
function normalizeSeparator(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return value.slice(0, 6)
}

/** 行为配置兜底：显示模式只认已知的四种，其余回落到「只显示天数」 */
function normalizeBehavior(input: BehaviorConfig | undefined): BehaviorConfig {
  const fallback = createDefaultConfig().behavior
  const source = input ?? fallback
  return {
    displayMode: DISPLAY_MODES.includes(source.displayMode) ? source.displayMode : fallback.displayMode,
    showDaysInPrecise: source.showDaysInPrecise !== false,
    separatorHM: normalizeSeparator(source.separatorHM, fallback.separatorHM),
    separatorMS: normalizeSeparator(source.separatorMS, fallback.separatorMS),
    showPastDays: source.showPastDays === true,
    alwaysOnTop: source.alwaysOnTop !== false
  }
}

/** 托盘菜单开关兜底：只有显式 false 才隐藏，缺省一律显示 */
function normalizeTrayMenu(input: TrayMenuConfig | undefined): TrayMenuConfig {
  const fallback = createDefaultConfig().runtime.trayMenu
  const source = input ?? fallback
  const out = { ...fallback }
  for (const key of Object.keys(fallback) as Array<keyof TrayMenuConfig>) {
    out[key] = source[key] !== false
  }
  return out
}

/** 保证列表、选中项、全局字段、窗口与自定义预设都合法 */
export function normalizeConfig(config: AppConfig): AppConfig {
  const countdowns = (Array.isArray(config.countdowns) ? config.countdowns : []).map(normalizeItem)
  // 只有启用的项才能作为桌面显示项
  const selectable = countdowns.filter((item) => item.enabled)
  const activeId = selectable.some((item) => item.id === config.activeId)
    ? config.activeId
    : selectable[0]?.id ?? ''
  const window = normalizeWindow(config.runtime?.window)
  return {
    ...config,
    countdowns,
    activeId,
    appearance: normalizeAppearance(config.appearance),
    behavior: normalizeBehavior(config.behavior),
    runtime: {
      ...config.runtime,
      window,
      trayMenu: normalizeTrayMenu(config.runtime?.trayMenu)
    },
    customPresets: Array.isArray(config.customPresets) ? config.customPresets : []
  }
}

/** 外观兜底：文字透明度与四个文字样式都可能缺字段，逐一补齐 */
function normalizeAppearance(input: AppearanceConfig | undefined): AppearanceConfig {
  const fallback = createDefaultConfig().appearance
  const source = input ?? fallback
  return {
    ...source,
    textAlpha: clampTextAlpha(source.textAlpha, fallback.textAlpha),
    title: normalizeTextStyle(source.title ?? fallback.title),
    count: normalizeTextStyle(source.count ?? fallback.count),
    hint: normalizeTextStyle(source.hint ?? fallback.hint),
    status: normalizeTextStyle(source.status ?? fallback.status)
  }
}

function normalizeWindow(input: Partial<AppConfig['runtime']['window']> | undefined): AppConfig['runtime']['window'] {
  const fallback = createDefaultConfig().runtime.window
  const source = input ?? fallback
  const cornerPreset = (source.cornerPreset ?? source.corner ?? 'top-right') as AppConfig['runtime']['window']['cornerPreset']
  const valid: Array<AppConfig['runtime']['window']['cornerPreset']> = [
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
    'custom'
  ]
  const preset = valid.includes(cornerPreset) ? cornerPreset : 'top-right'
  const corner = valid.includes(source.corner as never) ? (source.corner as never) : preset

  // 旧版（layoutVersion < 2）的偏移量在贴右/下边时方向是反的：那时正值把卡片推向
  // 屏幕外侧，现在正值统一表示朝屏幕内侧。这里翻一次符号，升级后位置保持不变。
  const legacy = Number(source.layoutVersion ?? 1) < LAYOUT_VERSION
  const flipX = legacy && (preset === 'top-right' || preset === 'bottom-right')
  const flipY = legacy && (preset === 'bottom-left' || preset === 'bottom-right')
  const rawOffsetX = Number.isFinite(source.offsetX) ? Number(source.offsetX) : 0
  const rawOffsetY = Number.isFinite(source.offsetY) ? Number(source.offsetY) : 0

  return {
    corner,
    cornerPreset: preset,
    anchorX: Number.isFinite(source.anchorX) ? Number(source.anchorX) : 0,
    anchorY: Number.isFinite(source.anchorY) ? Number(source.anchorY) : 0,
    offsetX: flipX ? -rawOffsetX : rawOffsetX,
    offsetY: flipY ? -rawOffsetY : rawOffsetY,
    allowDrag: source.allowDrag !== false,
    clickThrough: source.clickThrough === true,
    transparent: source.transparent !== false,
    layoutVersion: LAYOUT_VERSION
  }
}

/**
 * 旧版本（单个 target/text）迁移到列表结构。
 * 只要磁盘上存在 target 或 text 且没有 countdowns，就认定是旧配置。
 */
export function migrateLegacy(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const source = raw as Record<string, unknown>
  if (Array.isArray(source.countdowns) && source.countdowns.length > 0) return raw
  const legacyTarget = source.target as TargetConfig | undefined
  const legacyText = source.text as TextConfig | undefined
  const legacyAppearance = source.appearance as AppearanceConfig | undefined
  if (!legacyTarget && !legacyText) return raw

  const nextYear = new Date().getFullYear() + 1
  const target: TargetConfig = legacyTarget ?? {
    mode: 'annual',
    date: `${nextYear}-01-01T00:00`,
    month: 1,
    day: 1
  }
  // 旧版本的标题存在 text.title 里（新结构由列表项 name 承载）
  const legacyTitle = (legacyText as unknown as { title?: string } | undefined)?.title
  const name = legacyTitle?.trim() || (target.mode === 'annual' ? '纪念日' : '倒数日')

  // 旧版的文案全部上提为全局默认；单项不设置覆盖，这样之后改全局依然生效
  const item = createCountdownItem({ name, target })

  const rest = { ...source }
  delete rest.target
  delete rest.text
  // 旧版本没有 customPresets，交给 normalizeConfig 补
  void legacyAppearance

  return {
    ...rest,
    countdowns: [item],
    activeId: item.id,
    target,
    text: {
      hint: legacyText?.hint ?? '',
      futureText: legacyText?.futureText || '还有 {days} 天',
      todayText: legacyText?.todayText || '就在今天！',
      pastText: legacyText?.pastText || '已远去',
      unit: legacyText?.unit || '天',
      showHint: true,
      showStatus: true,
      showUnit: true
    }
  }
}

/**
 * 递归合并外观覆盖：只有显式给出的字段才覆盖全局。
 * 文字透明度（textAlpha 与四个样式各自的 opacity）与背景 alpha 完全独立，
 * 因此这里不需要也不应该做任何相乘。
 */
export function mergeAppearance(
  base: AppearanceConfig,
  override?: AppearanceOverride
): AppearanceConfig {
  if (!override) return base
  const mergeStyle = (global: TextStyle, local?: Partial<TextStyle>): TextStyle => {
    if (!local) return global
    const out: Record<string, unknown> = { ...global }
    for (const [key, value] of Object.entries(local)) {
      if (value !== undefined && value !== null) out[key] = value
    }
    return normalizeTextStyle(out as unknown as TextStyle)
  }
  return {
    fontFamily: override.fontFamily || base.fontFamily,
    textAlpha:
      override.textAlpha === undefined || override.textAlpha === null
        ? base.textAlpha ?? 1
        : clampTextAlpha(override.textAlpha, base.textAlpha ?? 1),
    background: mergeBackground(base.background, override.background),
    title: mergeStyle(base.title, override.title),
    count: mergeStyle(base.count, override.count),
    hint: mergeStyle(base.hint, override.hint),
    status: mergeStyle(base.status, override.status)
  }
}

function mergeBackground(
  base: AppearanceConfig['background'],
  local?: Partial<AppearanceConfig['background']>
): AppearanceConfig['background'] {
  if (!local) return base
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(local)) {
    if (value !== undefined && value !== null) out[key] = value
  }
  return out as unknown as AppearanceConfig['background']
}

/** 文案覆盖：空字符串表示跟随全局 */
export function mergeText(base: TextConfig, override?: TextOverride): TextConfig {
  const keys: TextFieldKey[] = ['hint', 'futureText', 'todayText', 'pastText', 'unit']
  const out = { ...base }
  for (const key of keys) {
    out[key] = resolveTextField(override, base, key).value
  }
  return out
}

/** 只保留启用的项，用于「能被选为桌面显示」的判断 */
export function selectableCountdowns(config: AppConfig): CountdownItem[] {
  return (config.countdowns ?? []).filter((item) => item.enabled)
}

/** 选出当前应显示的倒数日：优先 activeId，其次第一个启用的项 */
export function findActiveItem(config: AppConfig): CountdownItem | null {
  const list = config.countdowns ?? []
  if (!list.length) return null
  const active = list.find((item) => item.id === config.activeId && item.enabled)
  if (active) return active
  return list.find((item) => item.enabled) ?? null
}

/** 把单项覆盖合并成最终渲染配置 */
export function resolveCountdown(config: AppConfig, item: CountdownItem): ResolvedCountdown {
  return {
    id: item.id,
    name: item.name,
    target: resolveTarget(item.target, config.target),
    text: { title: item.name, ...mergeText(config.text, item.text) },
    showHint: resolveVisibility(item.text?.showHint, config.text.showHint).show,
    showStatus: resolveVisibility(item.text?.showStatus, config.text.showStatus).show,
    showUnit: resolveVisibility(item.text?.showUnit, config.text.showUnit !== false).show,
    separator: resolveSeparator(item.separator, {
      hm: config.behavior.separatorHM,
      ms: config.behavior.separatorMS
    }),
    appearance: mergeAppearance(config.appearance, item.appearance)
  }
}

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

export function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(value.trim())
}

export function parseTargetDate(target: TargetConfig): Date {
  if (target.mode === 'annual') {
    const year = new Date().getFullYear()
    return new Date(year, clampInt(target.month, 1, 12) - 1, clampInt(target.day, 1, 31), 0, 0, 0, 0)
  }
  const raw = target.date?.trim() ?? ''
  if (!isValidDateString(raw)) return new Date(NaN)
  const hasTime = raw.includes('T')
  const [datePart, timePart] = raw.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  if (!hasTime) return new Date(y, m - 1, d, 0, 0, 0, 0)
  const [hh, mm] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0)
}

/** 当前偏移量语义版本；旧配置读入时会据此换算方向 */
export const LAYOUT_VERSION = 2

export function clampInt(value: number, min: number, max: number): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/** 一次性模式是否带具体时刻 */
export function targetHasTime(target: TargetConfig): boolean {
  return target.mode === 'once' && (target.date ?? '').includes('T')
}

function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

/**
 * 解析出用于展示的目标日期：
 * - annual：若今年已过（当天除外），自动滚动到下一年
 * - once：原样返回
 */
export function resolveEffectiveTarget(target: TargetConfig, now: Date = new Date()): Date {
  if (target.mode !== 'annual') return parseTargetDate(target)
  const month = clampInt(target.month, 1, 12)
  const day = clampInt(target.day, 1, 31)
  const today = atMidnight(now)
  let year = now.getFullYear()
  let candidate = new Date(year, month - 1, day, 0, 0, 0, 0)
  if (candidate.getTime() < today.getTime()) {
    year += 1
    candidate = new Date(year, month - 1, day, 0, 0, 0, 0)
  }
  return candidate
}

export function formatDateLabel(target: TargetConfig, effective: Date, language: string): string {
  if (Number.isNaN(effective.getTime())) return '—'
  const zh = language !== 'en-US'
  const weekZh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const weekEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const week = zh ? weekZh[effective.getDay()] : weekEn[effective.getDay()]
  const time = targetHasTime(target)
    ? ` ${pad2(effective.getHours())}:${pad2(effective.getMinutes())}`
    : ''
  if (target.mode === 'annual') {
    return zh
      ? `${effective.getMonth() + 1} 月 ${effective.getDate()} 日 · ${week}`
      : `${effective.toLocaleString('en-US', { month: 'short' })} ${effective.getDate()} · ${week}`
  }
  return zh
    ? `${effective.getFullYear()} 年 ${effective.getMonth() + 1} 月 ${effective.getDate()} 日 · ${week}${time}`
    : `${effective.toLocaleString('en-US', { month: 'short' })} ${effective.getDate()}, ${effective.getFullYear()} · ${week}${time}`
}

export type CountdownState = 'future' | 'today' | 'past'

export interface CountdownResult {
  state: CountdownState
  effective: Date
  /** precision 模式剩余毫秒（可为负） */
  diffMs: number
  /** 日历天数差（>=0 表示未来） */
  days: number
  hours: number
  minutes: number
  seconds: number
}

export function computeCountdown(target: TargetConfig, now: Date = new Date()): CountdownResult {
  const effective = resolveEffectiveTarget(target, now)
  if (Number.isNaN(effective.getTime())) {
    return { state: 'past', effective, diffMs: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }
  }

  const diffMs = effective.getTime() - now.getTime()
  const precise = targetHasTime(target)
  const today = atMidnight(now)
  const targetDay = atMidnight(effective)
  const dayDiff = Math.round((targetDay.getTime() - today.getTime()) / DAY_MS)

  // 无具体时刻：按「整天」语义判断；带具体时刻：到点即为过去
  let state: CountdownState
  if (dayDiff > 0) state = 'future'
  else if (dayDiff === 0) state = !precise || diffMs > 0 ? 'today' : 'past'
  else state = 'past'

  const abs = Math.abs(diffMs)
  return {
    state,
    effective,
    diffMs,
    days: dayDiff,
    hours: Math.floor(abs / 3_600_000) % 24,
    minutes: Math.floor(abs / 60_000) % 60,
    seconds: Math.floor(abs / 1000) % 60
  }
}

/** 时分秒显示的一段：数字 + 跟在它后面的单位或分隔符小标签 */
export interface PrecisionPart {
  value: string
  label: string
}

/**
 * 按显示模式组装「数字 + 单位/分隔符」序列。桌面组件与设置里的预览共用这一份，
 * 免得两边的模式判断各写一遍、改一处漏一处。
 *
 * 分隔符不写死成冒号，而是由 SeparatorConfig 决定，用户可以选「:」「时」或自己写的符号。
 * 规则：每一段带的是**它自己的单位**（天/时/分），秒不带动词也不需要分隔符，
 * 因此末尾永远不会出现 `46分 11:` 这种多余尾巴；单位本身取对应那一档的分隔符，
 * 所以换掉分隔符就等于换掉那个单位字：
 *
 * - days-hours          天 + 时                → `95天 02时`
 * - days-hours-minutes  天 + 时 + 分           → `95天 02时 46分`
 * - precise             天 + 时 + 分 + 秒      → `95天 02时 46分 11`
 * - precise + 不含天数                         → `02时 46分 11`
 * - 分隔符改成 `:`                             → `95天 02: 46: 11`
 *
 * 「时与分之间」这一档在两个模式下是同一个设置：
 * `天+时+分` 里它出现在 46 后面，`天+时+分+秒` 里同时出现在 46 和 11 前面，
 * 所以两个显示模式选项展示出来的那一档必须一模一样。
 */
export function buildPrecisionParts(
  mode: PrecisionMode,
  showDays: boolean,
  unit: string,
  separator: SeparatorConfig,
  result: CountdownResult
): PrecisionPart[] {
  const withDays = mode !== 'precise' || showDays
  // 每一段记下它所属的单位；单位是后面挑分隔符的依据，与「是不是最后一段」无关
  const entries: Array<{ value: string; kind: 'day' | 'hour' | 'minute' | 'second' }> = []
  if (withDays) entries.push({ value: String(Math.abs(result.days)), kind: 'day' })
  entries.push({ value: pad2(result.hours), kind: 'hour' })
  if (mode !== 'days-hours') entries.push({ value: pad2(result.minutes), kind: 'minute' })
  if (mode === 'precise') entries.push({ value: pad2(result.seconds), kind: 'second' })

  const labelOf = (kind: 'day' | 'hour' | 'minute' | 'second'): string => {
    if (kind === 'day') return unit
    if (kind === 'hour') return separator.hm
    if (kind === 'minute') return separator.ms
    // 秒之后没有东西需要分隔，所以永远不带标签
    return ''
  }

  return entries.map((entry) => ({ value: entry.value, label: labelOf(entry.kind) }))
}

export function applyTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key]
    return value === undefined ? match : String(value)
  })
}

export type ThemePresetDef = ThemePreset

/** 预设主题：只覆盖全局外观字段 */
export const THEME_PRESETS: ThemePresetDef[] = [
  {
    id: 'midnight',
    nameZh: '午夜蓝',
    nameEn: 'Midnight',
    appearance: {
      fontFamily:
        '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", system-ui, sans-serif',
      textAlpha: 1,
      background: {
        color: '#1e2230',
        alpha: 0.78,
        radius: 18,
        padding: 20,
        shadow: 45,
        shadowColor: '#000000',
        borderWidth: 1,
        borderColor: '#ffffff2e',
        width: 0
      },
      title: { fontSize: 16, color: '#b9c4dc', weight: 500, letterSpacing: 0, opacity: 0.9 },
      count: { fontSize: 64, color: '#ffffff', weight: 700, letterSpacing: -1, opacity: 1 },
      hint: { fontSize: 14, color: '#a7b3cc', weight: 400, letterSpacing: 0, opacity: 0.85 },
      status: { fontSize: 15, color: '#7ec8ff', weight: 500, letterSpacing: 0, opacity: 1 }
    }
  },
  {
    id: 'frost',
    nameZh: '晨雾白',
    nameEn: 'Frost',
    appearance: {
      fontFamily: '"Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif',
      textAlpha: 1,
      background: {
        color: '#ffffff',
        alpha: 0.82,
        radius: 20,
        padding: 20,
        shadow: 30,
        shadowColor: '#6b7a99',
        borderWidth: 1,
        borderColor: '#00000014',
        width: 0
      },
      title: { fontSize: 16, color: '#4b5563', weight: 500, letterSpacing: 0, opacity: 0.9 },
      count: { fontSize: 64, color: '#111827', weight: 700, letterSpacing: -1, opacity: 1 },
      hint: { fontSize: 14, color: '#5f6672', weight: 400, letterSpacing: 0, opacity: 0.85 },
      status: { fontSize: 15, color: '#2563eb', weight: 500, letterSpacing: 0, opacity: 1 }
    }
  },
  {
    id: 'sakura',
    nameZh: '樱花粉',
    nameEn: 'Sakura',
    appearance: {
      fontFamily: '"Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif',
      textAlpha: 1,
      background: {
        color: '#ffe3ec',
        alpha: 0.9,
        radius: 24,
        padding: 22,
        shadow: 35,
        shadowColor: '#d9698f',
        borderWidth: 1,
        borderColor: '#ffffffaa',
        width: 0
      },
      title: { fontSize: 16, color: '#a33a63', weight: 500, letterSpacing: 0, opacity: 0.9 },
      count: { fontSize: 68, color: '#a32652', weight: 800, letterSpacing: -1, opacity: 1 },
      hint: { fontSize: 14, color: '#96486a', weight: 400, letterSpacing: 0, opacity: 0.85 },
      status: { fontSize: 15, color: '#8f2f56', weight: 600, letterSpacing: 0, opacity: 1 }
    }
  },
  {
    id: 'terminal',
    nameZh: '极客绿',
    nameEn: 'Terminal',
    appearance: {
      fontFamily: '"Cascadia Mono", "Consolas", "JetBrains Mono", monospace',
      textAlpha: 1,
      background: {
        color: '#0b1a10',
        alpha: 0.85,
        radius: 6,
        padding: 18,
        shadow: 50,
        shadowColor: '#000000',
        borderWidth: 1,
        borderColor: '#39ff8855',
        width: 0
      },
      title: { fontSize: 15, color: '#5fbf87', weight: 500, letterSpacing: 2, opacity: 0.9 },
      count: { fontSize: 62, color: '#39ff88', weight: 700, letterSpacing: 0, opacity: 1 },
      hint: { fontSize: 13, color: '#4e9c72', weight: 400, letterSpacing: 1, opacity: 0.85 },
      status: { fontSize: 14, color: '#9dffc4', weight: 500, letterSpacing: 1, opacity: 1 }
    }
  },
  {
    id: 'paper',
    nameZh: '纸质便签',
    nameEn: 'Paper Note',
    appearance: {
      fontFamily: '"KaiTi", "STKaiti", "Microsoft YaHei UI", serif',
      textAlpha: 1,
      background: {
        color: '#fdf6d8',
        alpha: 0.96,
        radius: 4,
        padding: 20,
        shadow: 40,
        shadowColor: '#8a7b3f',
        borderWidth: 0,
        borderColor: '#00000000',
        width: 0
      },
      title: { fontSize: 16, color: '#7a6435', weight: 500, letterSpacing: 1, opacity: 0.9 },
      count: { fontSize: 66, color: '#5b4a1f', weight: 700, letterSpacing: 0, opacity: 1 },
      hint: { fontSize: 14, color: '#7b6a3d', weight: 400, letterSpacing: 0, opacity: 0.85 },
      status: { fontSize: 15, color: '#a0481a', weight: 600, letterSpacing: 0, opacity: 1 }
    }
  }
]
