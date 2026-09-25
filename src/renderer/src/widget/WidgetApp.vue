<template>
  <div
    ref="stage"
    class="cd-stage"
    :class="{ 'is-opaque': !transparent }"
    :data-corner="config.runtime.window.corner"
  >
    <div v-if="resolved" ref="shrink" class="cd-shrink" :style="shrinkStyle">
      <div ref="card" class="cd-card" :style="cardStyleObject">
        <div v-if="resolved.text.title.trim()" class="cd-card__title" :style="titleStyle">
          {{ resolved.text.title }}
        </div>

        <div
          v-if="config.behavior.displayMode === 'precise'"
          class="cd-card__precise"
          :style="countStyle"
        >
          <span v-for="(part, index) in preciseParts" :key="index" class="cd-card__precision-part">
            <span class="cd-card__number">{{ part.value }}</span>
            <small v-if="part.label">{{ part.label }}</small>
          </span>
        </div>

        <div v-else class="cd-card__count" :style="countStyle">
          <span class="cd-card__number">{{ absDays }}</span>
          <span class="cd-card__unit" :style="unitStyle">{{ resolved.text.unit }}</span>
        </div>

        <div v-if="hintText && resolved.showHint" class="cd-card__hint" :style="hintStyle">
          {{ hintText }}
        </div>

        <div v-if="statusText && resolved.showStatus" class="cd-card__status" :style="statusStyle">
          {{ statusText }}
        </div>
      </div>
    </div>

    <!-- 列表为空时不再是一片全透明的“隐身”窗口，给一个可读的提示 -->
    <div v-else ref="emptyCard" class="cd-card cd-card--empty" :style="emptyCardStyle">
      <div class="cd-card__title" :style="titleStyle">{{ t('list.noCountdown') }}</div>
      <div class="cd-card__hint" :style="hintStyle">{{ t('list.noCountdownHint') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig } from '@shared/types'
import {
  applyTemplate,
  computeCountdown,
  findActiveItem,
  formatDateLabel,
  resolveCountdown
} from '@shared/defaults'
import { cardStyle, textStyle } from '@/utils/style'

const props = defineProps<{ config: AppConfig }>()

const { t } = useI18n()

const nowRef = ref(new Date())
let timer: number | undefined

const stage = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
const shrink = ref<HTMLElement | null>(null)
const emptyCard = ref<HTMLElement | null>(null)
const hoverLocked = ref(false)
let interactive = false

/** 是否真的在用透明渲染（系统关闭透明效果时会退回不透明模式） */
const transparent = ref(true)

/**
 * 内容比窗口还宽时（例如精确模式 + 超大字号）整体等比缩小，
 * 否则卡片会越过“安全区”被窗口裁掉。用 zoom 而不是 transform，
 * 因为 zoom 会真正缩小布局盒子。
 */
const zoom = ref(1)
const shrinkStyle = computed(() => (zoom.value < 1 ? { zoom: String(zoom.value) } : undefined))

function measureShrink(): void {
  const host = shrink.value
  const el = card.value
  // 不透明模式下卡片就是整窗，不需要缩放
  if (!host || !el || !transparent.value) {
    zoom.value = 1
    return
  }
  const stageEl = stage.value
  const available = (stageEl ? stageEl.clientWidth - 48 : host.clientWidth) - 2
  if (available <= 0) return
  // 直接用「当前渲染出来的宽度」比较：scrollWidth 已经反映了当前 zoom，
  // 不要再除以 zoom，否则会形成不断缩小的反馈。
  const natural = Math.max(el.getBoundingClientRect().width, el.scrollWidth)
  if (!natural) return
  const next = natural > available + 1 ? Math.max(0.5, available / natural) : 1
  if (Math.abs(next - zoom.value) > 0.02) {
    zoom.value = next
  } else if (next === 1 && zoom.value !== 1) {
    zoom.value = 1
  }
}

/** 当前显示在桌面上的倒数日（含单项覆盖合并结果） */
const resolved = computed(() => {
  const item = findActiveItem(props.config)
  if (!item || !item.enabled) return null
  return resolveCountdown(props.config, item)
})

const result = computed(() =>
  resolved.value ? computeCountdown(resolved.value.target, nowRef.value) : null
)

const cardStyleObject = computed(() => ({
  ...cardStyle(props.config, resolved.value?.appearance),
  opacity: String(props.config.behavior.opacity)
}))

/** 空态卡片固定使用全局外观，避免单项覆盖干扰 */
const emptyCardStyle = computed(() => ({
  ...cardStyle(props.config, props.config.appearance),
  opacity: String(props.config.behavior.opacity),
  maxWidth: '320px'
}))
const titleStyle = computed(() =>
  textStyle((resolved.value?.appearance ?? props.config.appearance).title)
)
const countStyle = computed(() =>
  textStyle((resolved.value?.appearance ?? props.config.appearance).count)
)
const hintStyle = computed(() =>
  textStyle((resolved.value?.appearance ?? props.config.appearance).hint)
)
const statusStyle = computed(() =>
  textStyle((resolved.value?.appearance ?? props.config.appearance).status)
)
const unitStyle = computed(() => {
  const count = (resolved.value?.appearance ?? props.config.appearance).count
  return {
    fontSize: `${Math.max(12, Math.round(count.fontSize * 0.42))}px`,
    color: count.color,
    fontWeight: String(Math.min(600, count.weight)),
    letterSpacing: `${count.letterSpacing}px`
  }
})

const absDays = computed(() => (result.value ? Math.abs(result.value.days) : 0))

const hintText = computed(() => {
  if (!resolved.value || !result.value) return ''
  const custom = resolved.value.text.hint.trim()
  if (custom) return custom
  return formatDateLabel(
    resolved.value.target,
    result.value.effective,
    props.config.runtime.language
  )
})

const statusText = computed(() => {
  if (!resolved.value || !result.value) return ''
  const text = resolved.value.text
  if (result.value.state === 'future') {
    return applyTemplate(text.futureText, { days: result.value.days })
  }
  if (result.value.state === 'today') {
    return applyTemplate(text.todayText, { days: 0 })
  }
  if (props.config.behavior.showPastDays && !text.pastText.includes('{days}')) {
    return `${text.pastText} · ${absDays.value}`
  }
  return applyTemplate(text.pastText, { days: absDays.value })
})

interface PrecisePart {
  value: string
  label: string
}

const preciseParts = computed<PrecisePart[]>(() => {
  if (!resolved.value || !result.value) return []
  const parts: PrecisePart[] = []
  if (props.config.behavior.showDaysInPrecise) {
    parts.push({ value: String(absDays.value), label: resolved.value.text.unit })
  }
  parts.push({ value: pad(result.value.hours), label: ':' })
  parts.push({ value: pad(result.value.minutes), label: ':' })
  parts.push({ value: pad(result.value.seconds), label: '' })
  return parts
})

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** 透明窗口默认让点击穿透到桌面，只有指针落在卡片上才恢复命中 */
function syncInteractive(): void {
  const el = card.value ?? emptyCard.value
  if (!el) return
  const next = hoverLocked.value
  if (next === interactive) return
  interactive = next
  window.cd.setInteractive(next)
  if (stage.value) stage.value.dataset.interactive = interactive ? 'true' : 'false'
}

function pointIn(el: HTMLElement | null, x: number, y: number, pad = 4): boolean {
  if (!el) return false
  const rect = el.getBoundingClientRect()
  return (
    x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad
  )
}

/** 主进程轮询到的屏幕坐标（透明窗口收不到鼠标事件，靠它判断命中） */
function onGlobalCursor(point: { x: number; y: number }): void {
  const clientX = point.x - window.screenX
  const clientY = point.y - window.screenY
  const el = card.value ?? emptyCard.value
  hoverLocked.value = pointIn(el, clientX, clientY)
  if (stage.value) {
    stage.value.dataset.hoverPoint = `${Math.round(clientX)},${Math.round(clientY)}`
  }
  syncInteractive()
}

let unhookCursor: (() => void) | null = null
let unhookShown: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  timer = window.setInterval(() => {
    nowRef.value = new Date()
  }, 1000)
  if (stage.value) stage.value.dataset.interactive = 'false'
  unhookCursor = window.cd.onCursor(onGlobalCursor)
  // 主进程每次显示组件都会重置鼠标穿透状态，这里同步丢掉缓存，
  // 否则「显示前指针已经在卡片上」时会被误判成不需要恢复命中
  unhookShown = window.cd.onWidgetShown(() => {
    interactive = false
    if (stage.value) stage.value.dataset.interactive = 'false'
  })
  try {
    const info = await window.cd.getHostInfo()
    transparent.value = info.widgetTransparent
  } catch (error) {
    console.warn('[widget] 读取透明模式失败', error)
  }
  void nextTick(measureShrink)
  // 卡片尺寸会随语言、文案、字号变化，尺寸一变就重新评估是否需要缩小
  if (typeof ResizeObserver !== 'undefined' && shrink.value) {
    const observer = new ResizeObserver(() => {
      measureShrink()
    })
    observer.observe(shrink.value)
    resizeObserver = observer
  }
})

/** 配置变化后重新测量（等 DOM 更新完） */
watch(
  () => [props.config, resolved.value] as const,
  () => {
    void nextTick(measureShrink)
  }
)

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
  resizeObserver?.disconnect()
  unhookCursor?.()
  unhookShown?.()
  if (interactive) void window.cd.setInteractive(false)
})
</script>
