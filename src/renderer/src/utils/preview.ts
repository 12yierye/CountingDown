import type { DisplayMode } from '@shared/types'

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
