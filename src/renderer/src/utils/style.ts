import type { AppConfig, AppearanceConfig, DisplayMode, TextStyle } from '@shared/types'

export function hexToRgba(hex: string, alpha: number): string {
  const value = (hex || '#000000').trim()
  const short = /^#([0-9a-f]{3})$/i.exec(value)
  const long = /^#([0-9a-f]{6})$/i.exec(value)
  const eight = /^#([0-9a-f]{8})$/i.exec(value)
  let r = 0
  let g = 0
  let b = 0
  let baseAlpha = 1
  if (short) {
    r = parseInt(short[1][0] + short[1][0], 16)
    g = parseInt(short[1][1] + short[1][1], 16)
    b = parseInt(short[1][2] + short[1][2], 16)
  } else if (long) {
    r = parseInt(long[1].slice(0, 2), 16)
    g = parseInt(long[1].slice(2, 4), 16)
    b = parseInt(long[1].slice(4, 6), 16)
  } else if (eight) {
    r = parseInt(eight[1].slice(0, 2), 16)
    g = parseInt(eight[1].slice(2, 4), 16)
    b = parseInt(eight[1].slice(4, 6), 16)
    baseAlpha = parseInt(eight[1].slice(6, 8), 16) / 255
  } else {
    return `rgba(0, 0, 0, ${alpha})`
  }
  const a = Math.min(1, Math.max(0, alpha * baseAlpha))
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`
}

/** 去掉 8 位 hex 的透明通道，仅保留 #rrggbb，用于颜色选择器 */
export function toHexColor(value: string, fallback = '#000000'): string {
  const v = (value || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
  if (/^#[0-9a-f]{8}$/i.test(v)) return `#${v.slice(1, 7)}`.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    const s = v.slice(1)
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`.toLowerCase()
  }
  return fallback
}

/**
 * 文字样式：透明度单独抽成 alpha 而不是用 CSS `opacity`，
 * 这样它只影响这一行文字，和卡片背景的透明度完全无关。
 */
export function textStyle(style: TextStyle): Record<string, string> {
  const alpha = clampAlpha(style?.opacity ?? 1)
  return {
    fontSize: `${style.fontSize}px`,
    color: hexToRgba(style.color, alpha),
    fontWeight: String(style.weight),
    letterSpacing: `${style.letterSpacing}px`,
    lineHeight: '1.2'
  }
}

function clampAlpha(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0, Number(value.toFixed(3))))
}

/**
 * 「结果预览」的底色：把卡片背景色（含它的透明度）铺成一层纯色。
 *
 * 预设详情、各段文字样张都用它。文字颜色和透明度只有摆在真实底色上才是它实际的
 * 样子 —— 把「深色卡片 + 白字」的样张放在面板灰底上，会让人误以为字太亮；
 * 反过来「浅色卡片 + 深字」放在深色面板上又像根本看不清。
 *
 * 只传 color/alpha 两个字段就能用，方便拿 BackgroundOverride 这种局部对象直接喂进来。
 */
export function sampleBackground(bg: { color?: string; alpha?: number } | undefined | null): Record<string, string> {
  if (!bg?.color) return {}
  const alpha = typeof bg.alpha === 'number' ? bg.alpha : 1
  return { backgroundColor: hexToRgba(bg.color, alpha) }
}

export function cardStyle(cfg: AppConfig, appearance?: AppearanceConfig): Record<string, string> {
  return cardStyleFor(appearance ?? cfg.appearance)
}

/** 只依赖外观对象本身：预设画廊这类没有完整配置的场景直接用它 */
export function cardStyleFor(look: AppearanceConfig): Record<string, string> {
  const bg = look.background
  const blur = bg.alpha < 1 ? 'blur(14px)' : 'none'
  const shadowAlpha = (Math.min(100, Math.max(0, bg.shadow)) / 100) * 0.6
  return {
    fontFamily: look.fontFamily,
    backgroundColor: hexToRgba(bg.color, bg.alpha),
    borderRadius: `${bg.radius}px`,
    padding: `${bg.padding}px`,
    border:
      bg.borderWidth > 0
        ? `${bg.borderWidth}px solid ${hexToRgba(bg.borderColor, 1)}`
        : '1px solid transparent',
    boxShadow:
      bg.shadow > 0
        ? `0 ${Math.round(bg.shadow * 0.25)}px ${Math.round(bg.shadow * 0.7)}px -8px ${hexToRgba(
            bg.shadowColor,
            shadowAlpha
          )}`
        : 'none',
    backdropFilter: blur,
    WebkitBackdropFilter: blur,
    // 卡片宽度用内联变量传递：写成内联 width 会盖掉 .cd-stage.is-opaque 里的类规则
    '--cd-card-width': bg.width > 0 ? `${bg.width}px` : 'fit-content'
  }
}

export function weightLabelKey(weight: number): string {
  return weight >= 700 ? 'appearance.weightBold' : 'appearance.weightRegular'
}

/**
 * 字体族下拉里不要把整串 CSS font-family 缩写掉：每个选项都完整显示字体栈，
 * 否则「微软雅黑 + 不同回退」这类选项在列表里长得一模一样，根本分不出来。
 * 下拉项允许换行（见 settings.css 的 .cd-font-select），窄窗口下也不会被裁切。
 */
export const FONT_STACKS: string[] = [
  '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", system-ui, sans-serif',
  '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
  '"Segoe UI", system-ui, sans-serif',
  '"Cascadia Mono", Consolas, monospace',
  '"KaiTi", "STKaiti", serif',
  '"SimSun", "Songti SC", serif',
  '"HarmonyOS Sans SC", "Microsoft YaHei UI", sans-serif',
  'system-ui, sans-serif'
]

/**
 * 预览框尺寸与缩略图缩放，按「显示精度」分档。
 *
 * 精度越高，卡片上并排的分段越多（天 → 天时分 → 天时分秒），同一个缩放下面片
 * 会越来越宽；精度只有「天」时卡片很窄，如果还套用给秒级准备的宽度，两侧就会
 * 剩下一大片空白 —— 看起来像「卡片缩在框里」。
 *
 * 所以：精度低 → 框更窄更高、允许放大；精度高 → 框更宽更矮、缩放收紧。
 */
export interface PreviewMetrics {
  /** 预览框宽度 px */
  width: number
  /** 预览框高度 px */
  height: number
  /** 缩略图允许的最大缩放 */
  maxScale: number
}

export const PREVIEW_BY_MODE: Record<DisplayMode, PreviewMetrics> = {
  days: { width: 180, height: 172, maxScale: 0.72 },
  'days-hours': { width: 200, height: 152, maxScale: 0.64 },
  'days-hours-minutes': { width: 214, height: 136, maxScale: 0.58 },
  precise: { width: 220, height: 124, maxScale: 0.52 }
}

export function previewMetrics(mode: DisplayMode | undefined): PreviewMetrics {
  return PREVIEW_BY_MODE[mode ?? 'precise'] ?? PREVIEW_BY_MODE.precise
}
