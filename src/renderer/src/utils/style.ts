import type { AppConfig, AppearanceConfig, TextStyle } from '@shared/types'
import { clampInt } from '@shared/defaults'

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

export function textStyle(style: TextStyle): Record<string, string> {
  return {
    fontSize: `${style.fontSize}px`,
    color: style.color,
    fontWeight: String(style.weight),
    letterSpacing: `${style.letterSpacing}px`,
    lineHeight: '1.2'
  }
}

export function cardStyle(cfg: AppConfig, appearance?: AppearanceConfig): Record<string, string> {
  const look = appearance ?? cfg.appearance
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
  if (weight <= 400) return 'appearance.weightRegular'
  if (weight <= 500) return 'appearance.weightMedium'
  if (weight <= 600) return 'appearance.weightSemiBold'
  if (weight <= 700) return 'appearance.weightBold'
  return 'appearance.weightBlack'
}

export function normalizeWeight(value: number): number {
  return clampInt(value, 100, 900)
}

/**
 * 字体族下拉里不要把整串 CSS font-family 全显示出来（会被裁切），
 * 只显示第一个字体名，并标注它还有回退字体。
 */
export function fontLabel(stack: string): string {
  const raw = (stack ?? '').trim()
  if (!raw) return 'system-ui'
  const parts = raw
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
  const first = parts[0] ?? raw
  return parts.length > 1 ? `${first} …` : first
}
