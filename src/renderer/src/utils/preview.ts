import type { DisplayMode, UnitLabelConfig } from '@shared/types'

/**
 * 显示模式的展示样例。统一用 DD天 HH时 MM分 SS秒 这样的占位符，
 * 不再拿「95天」当示例 —— 用户看到的应该是一个格式模板，而不是一组具体数字。
 */
export const MODE_SAMPLE = { day: 'DD', hour: 'HH', minute: 'MM', second: 'SS' }

/** 当前模式下实际会渲染出哪些分段 */
export interface ModeSlots {
  days: boolean
  hours: boolean
  minutes: boolean
  seconds: boolean
}

/**
 * 由显示模式推出实际渲染的分段。某一段不存在时，它对应的单位字也不会渲染，
 * 这条规则在设置面板与编辑页共用，免得两边的判断各写一套。
 */
export function modeSlots(mode: DisplayMode, showDaysInPrecise: boolean): ModeSlots {
  if (mode === 'days') return { days: true, hours: false, minutes: false, seconds: false }
  return {
    days: mode !== 'precise' || showDaysInPrecise,
    hours: true,
    minutes: mode !== 'days-hours',
    seconds: mode === 'precise'
  }
}

/**
 * 「显示模式」选项的文案：直接给出该模式渲染出来的格式模板，用的就是当前单位字，
 * 所以换单位字时选项文字会同步变化。
 *
 * 分段之间补一个空格只是为了在标签里看得清；卡片本身是紧挨着的
 * （想加间距就把空格写进单位字里，见 buildPrecisionParts）。
 */
export function modePreviewLabel(
  mode: DisplayMode,
  showDays: boolean,
  units: UnitLabelConfig
): string {
  const slots = modeSlots(mode, showDays)
  const parts: string[] = []
  if (slots.days) parts.push(`${MODE_SAMPLE.day}${units.day}`)
  if (slots.hours) parts.push(`${MODE_SAMPLE.hour}${units.hour}`)
  if (slots.minutes) parts.push(`${MODE_SAMPLE.minute}${units.minute}`)
  if (slots.seconds) parts.push(`${MODE_SAMPLE.second}${units.second}`)
  return parts.join(' ')
}
