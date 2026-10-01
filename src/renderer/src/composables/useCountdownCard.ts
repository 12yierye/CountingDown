import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import type { AppConfig, PrecisionMode, ResolvedCountdown } from '@shared/types'
import {
  applyTemplate,
  buildPrecisionParts,
  computeCountdown,
  createCountdownItem,
  findActiveItem,
  formatDateLabel,
  resolveCountdown,
  type CountdownResult,
  type PrecisionPart
} from '@shared/defaults'
import { cardStyle, textStyle } from '@/utils/style'

/** 组件窗口每秒重算一次倒计时；预览同样走这条路径，两边行为完全一致 */
const TICK_MS = 1000

export interface CountdownCardState {
  /** 当前应显示在桌面上的倒数日（含单项覆盖合并结果）；列表为空时为 null */
  resolved: ComputedRef<ResolvedCountdown | null>
  /** 倒计时计算结果 */
  result: ComputedRef<CountdownResult | null>
  /** 非 null 时走「大数字 + 小标签」序列，否则走大数字 + 单位 */
  precisionMode: ComputedRef<PrecisionMode | null>
  preciseParts: ComputedRef<PrecisionPart[]>
  /** days 模式下的绝对值天数 */
  absDays: ComputedRef<number>
  hintText: ComputedRef<string>
  statusText: ComputedRef<string>
  /** days 模式下是否渲染「天」这个单位 */
  showUnit: ComputedRef<boolean>
  /** 是否渲染副标题 / 状态文案 */
  showHint: ComputedRef<boolean>
  showStatus: ComputedRef<boolean>
  cardStyleObject: ComputedRef<Record<string, string>>
  titleStyle: ComputedRef<Record<string, string>>
  countStyle: ComputedRef<Record<string, string>>
  hintStyle: ComputedRef<Record<string, string>>
  statusStyle: ComputedRef<Record<string, string>>
  unitStyle: ComputedRef<Record<string, string>>
  /** 每秒更新一次的时间源，供需要自行取时间的调用方复用 */
  now: Ref<Date>
}

export interface CountdownCardOptions {
  /**
   * 示例模式：标题固定为 sampleTitle、日期固定为元旦，
   * 并且只使用全局外观与全局文案（忽略单项覆盖）。
   * 设置页的「实时预览」用它来当全局样式的样板。
   */
  sample?: boolean
  sampleTitle?: string
  /** 示例模式固定用的日期；缺省为当年元旦 */
  sampleDate?: Date
  /** 是否每秒重算（预览与组件窗口都需要） */
  live?: boolean
}

/** 预览样例用的固定月日：元旦 */
const SAMPLE_MONTH = 1
const SAMPLE_DAY = 1

/**
 * 把「月/日」表示成下一次出现的那一天（带具体日期）。
 *
 * 不能直接交给 annual 模式处理：annual 的「过了就滚到明年」判断在 1 月 1 日当天
 * 按午夜比较会被判成「已过去」，示例预览就会在元旦当天显示成过期。
 * 这里先自己算出明确的目标年份，交给 once 语义计算，全年任意一天结果都稳定。
 */
function nextAnnualDateIso(month: number, day: number, now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let year = now.getFullYear()
  if (new Date(year, month - 1, day).getTime() < today.getTime()) year += 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 由外部传入的响应式配置驱动的一整套卡片渲染状态 */
export function useCountdownCard(
  config: () => AppConfig,
  options: CountdownCardOptions = {}
): CountdownCardState {
  const now = ref(new Date())
  const sample = options.sample === true
  let timer: number | undefined

  if (options.live !== false) {
    onMounted(() => {
      timer = window.setInterval(() => {
        now.value = new Date()
      }, TICK_MS)
    })
    onBeforeUnmount(() => {
      if (timer) window.clearInterval(timer)
    })
  }

  const resolved = computed<ResolvedCountdown | null>(() => {
    const cfg = config()
    // 示例模式：标题与日期都固定，但外观与文案仍然来自全局设置
    if (sample) {
      const item = createCountdownItem({ id: 'preview_sample', name: options.sampleTitle ?? '' })
      const base = resolveCountdown(cfg, item)
      const month = options.sampleDate ? options.sampleDate.getMonth() + 1 : SAMPLE_MONTH
      const day = options.sampleDate ? options.sampleDate.getDate() : SAMPLE_DAY
      return {
        ...base,
        target: { mode: 'annual', date: '', month, day },
        text: { ...base.text, title: options.sampleTitle ?? base.text.title },
        separator: {
          hm: cfg.behavior.separatorHM,
          ms: cfg.behavior.separatorMS
        }
      }
    }
    const item = findActiveItem(cfg)
    return item ? resolveCountdown(cfg, item) : null
  })

  const result = computed<CountdownResult | null>(() => {
    const current = resolved.value
    if (!current) return null
    if (sample) {
      const { month, day } = current.target
      return computeCountdown(
        { mode: 'once', date: nextAnnualDateIso(month, day, now.value), month, day },
        now.value
      )
    }
    return computeCountdown(current.target, now.value)
  })

  const appearance = computed(() => resolved.value?.appearance ?? config().appearance)

  const cardStyleObject = computed<Record<string, string>>(() => ({
    ...cardStyle(config(), resolved.value?.appearance)
  }))

  const titleStyle = computed(() => textStyle(appearance.value.title, appearance.value.textAlpha))
  const countStyle = computed(() => textStyle(appearance.value.count, appearance.value.textAlpha))
  const hintStyle = computed(() => textStyle(appearance.value.hint, appearance.value.textAlpha))
  const statusStyle = computed(() => textStyle(appearance.value.status, appearance.value.textAlpha))
  const unitStyle = computed(() => {
    const count = appearance.value.count
    return {
      fontSize: `${Math.max(12, Math.round(count.fontSize * 0.42))}px`,
      color: textStyle(count, appearance.value.textAlpha).color,
      fontWeight: String(Math.min(600, count.weight)),
      letterSpacing: `${count.letterSpacing}px`
    }
  })

  const absDays = computed(() => (result.value ? Math.abs(result.value.days) : 0))

  const hintText = computed(() => {
    const current = resolved.value
    const computedResult = result.value
    if (!current || !computedResult) return ''
    const custom = current.text.hint.trim()
    if (custom) return custom
    return formatDateLabel(current.target, computedResult.effective, config().runtime.language)
  })

  const statusText = computed(() => {
    const current = resolved.value
    const computedResult = result.value
    if (!current || !computedResult) return ''
    const text = current.text
    if (computedResult.state === 'future') {
      return applyTemplate(text.futureText, { days: computedResult.days })
    }
    if (computedResult.state === 'today') {
      return applyTemplate(text.todayText, { days: 0 })
    }
    if (config().behavior.showPastDays && !text.pastText.includes('{days}')) {
      return `${text.pastText} · ${absDays.value}`
    }
    return applyTemplate(text.pastText, { days: absDays.value })
  })

  /** 显示模式：'days' 走大数字 + 单位，其余三种走「数字 + 单位/分隔符」序列 */
  const precisionMode = computed<PrecisionMode | null>(() => {
    const mode = config().behavior.displayMode
    return mode === 'days' ? null : mode
  })

  const preciseParts = computed<PrecisionPart[]>(() => {
    const mode = precisionMode.value
    const current = resolved.value
    const computedResult = result.value
    if (!mode || !current || !computedResult) return []
    return buildPrecisionParts(
      mode,
      config().behavior.showDaysInPrecise,
      current.text.unit,
      current.separator,
      computedResult
    )
  })

  return {
    resolved,
    result,
    precisionMode,
    preciseParts,
    absDays,
    hintText,
    statusText,
    showUnit: computed(() => resolved.value?.showUnit !== false),
    showHint: computed(() => resolved.value?.showHint !== false),
    showStatus: computed(() => resolved.value?.showStatus !== false),
    cardStyleObject,
    titleStyle,
    countStyle,
    hintStyle,
    statusStyle,
    unitStyle,
    now
  }
}