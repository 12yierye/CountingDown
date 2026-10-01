import type { DisplayMode } from '@shared/types'

/**
 * 设置面板里「显示模式」选项的文案：直接给出真实渲染出来长什么样，
 * 而不是抽象地描述成「天 + 时」。示例值固定为 95天 02时 46分 11秒，
 * 因此用户选分隔符时能立刻看出差别。
 *
 * 规则与 buildPrecisionParts 严格一致：每个数字后面跟它所属单位那一档的分隔符，
 * 最后一个数字不带任何标签 —— 这正是「天+时」与「天+时分」过去显示成
 * `95天 02:` 这种带尾巴冒号的根源。
 *
 * 注意「时与分之间」在 `天+时+分` 与 `天+时+分+秒` 里是同一个设置，
 * 所以两个选项展示出来的那一档必须一模一样（都是 02 后面那一段）。
 */
export const MODE_SAMPLE = { days: 95, hours: '02', minutes: '46', seconds: '11' }

export function modePreviewLabel(
  mode: DisplayMode,
  showDays: boolean,
  separator: { hm: string; ms: string }
): string {
  switch (mode) {
    case 'days':
      return String(MODE_SAMPLE.days)
    case 'days-hours':
      return `${MODE_SAMPLE.days}天 ${MODE_SAMPLE.hours}时`
    case 'days-hours-minutes':
      return `${MODE_SAMPLE.days}天 ${MODE_SAMPLE.hours}${separator.hm} ${MODE_SAMPLE.minutes}${separator.ms}`
    case 'precise': {
      const head = showDays ? `${MODE_SAMPLE.days}天 ` : ''
      return `${head}${MODE_SAMPLE.hours}${separator.hm} ${MODE_SAMPLE.minutes}${separator.ms} ${MODE_SAMPLE.seconds}`
    }
    default:
      return String(MODE_SAMPLE.days)
  }
}
