<template>
  <div
    ref="stage"
    class="cd-stage"
    :class="{ 'is-opaque': !transparent }"
    :data-corner="config.runtime.window.corner"
  >
    <div v-if="resolved" ref="shrink" class="cd-shrink" :style="shrinkStyle">
      <div
        ref="card"
        class="cd-card"
        :style="cardStyleObject"
        :class="{ 'is-draggable': allowDrag }"
        @pointerdown="onPointerDown"
      >
        <div v-if="resolved.text.title.trim()" class="cd-card__title" :style="titleStyle">
          {{ resolved.text.title }}
        </div>

        <div
          v-if="precisionMode"
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
    <div
      v-else
      ref="emptyCard"
      class="cd-card cd-card--empty"
      :style="emptyCardStyle"
      :class="{ 'is-draggable': allowDrag }"
      @pointerdown="onPointerDown"
    >
      <div class="cd-card__title" :style="titleStyle">{{ t('list.noCountdown') }}</div>
      <div class="cd-card__hint" :style="hintStyle">{{ t('list.noCountdownHint') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, PrecisionMode } from '@shared/types'
import {
  applyTemplate,
  buildPrecisionParts,
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
 *
 * 测量要点：zoom 作用在 .cd-shrink 上，所以 `getBoundingClientRect()` 给的是**缩放后**的
 * 视觉尺寸，而 `scrollWidth` / `offsetWidth` 给的是**布局尺寸**（不随 zoom 变化）。
 * 这里一律用布局尺寸算「自然宽度」，一次就能得到正确的比例。
 * 早先直接用视觉宽度与可用宽度比较，收敛点会偏大（约 √(可用 / 自然)），表现就是
 * 显示到秒时文字比卡片还宽、卡片也顶出安全区 —— 也就是「超出或贴近容器边缘」。
 */
const zoom = ref(1)
const shrinkStyle = computed(() => (zoom.value < 1 ? { zoom: String(zoom.value) } : undefined))

/**
 * 卡片的布局宽度上限（布局 px；0 表示交给 CSS 的 max-width: 100%）。
 * zoom ≠ 1 时 Chromium 下 .cd-shrink 的布局宽度与视觉宽度不再严格等比，
 * 单靠 max-width: 100% 会允许卡片比安全区宽出几像素，所以这里按缩放比换算一个硬上限。
 */
const cardMaxWidth = ref(0)

/** 舞台四边各留 24px 安全区，再扣掉 2px 余量，卡片不得越过 */
const SAFE_AREA_INSET = 24
const SAFE_AREA_SLACK = 2

function measureShrink(): void {
  const host = shrink.value
  const el = card.value
  // 不透明模式下卡片就是整窗，不需要缩放
  if (!host || !el || !transparent.value) {
    zoom.value = 1
    cardMaxWidth.value = 0
    return
  }
  const stageEl = stage.value
  const available =
    (stageEl ? stageEl.clientWidth - SAFE_AREA_INSET * 2 : host.clientWidth) - SAFE_AREA_SLACK
  if (available <= 0) return

  const cardComputed = getComputedStyle(el)
  const padX =
    (Number.parseFloat(cardComputed.paddingLeft) || 0) +
    (Number.parseFloat(cardComputed.paddingRight) || 0)
  const borderX =
    (Number.parseFloat(cardComputed.borderLeftWidth) || 0) +
    (Number.parseFloat(cardComputed.borderRightWidth) || 0)

  // 每行的自然（布局）宽度：nowrap 的行会溢出卡片，scrollWidth 正好给出真实内容宽度；
  // 标题/副标题是故意省略号裁切的，量到的就是裁切后的宽度，不会误伤。
  let content = 0
  el.querySelectorAll<HTMLElement>(':scope > *').forEach((row) => {
    content = Math.max(content, row.scrollWidth, row.offsetWidth)
  })
  if (content <= 0) content = Math.max(0, el.scrollWidth - padX)

  // 自然宽度包含卡片自身的内边距与边框，否则缩到刚好放下文字时文字会压到（甚至压出）卡片边缘
  const natural = content + padX + borderX
  // 固定宽度：比内容窄时按内容放宽（宁可卡片变宽，也不让文字跑到背景外面），
  // 比安全区还宽时不参与缩放（多余部分本来就由 max-width 兜住）
  const fixedWidth = Number.parseFloat(cardComputed.getPropertyValue('--cd-card-width')) || 0
  const target = Math.max(natural, fixedWidth > 0 ? Math.min(fixedWidth, available) : 0)
  if (!Number.isFinite(target) || target <= 0) return

  const next = target > available + 0.5 ? Math.max(0.5, available / target) : 1
  // 缩小后卡片的布局上限 = 可用宽度 / 缩放比，视觉上正好落在安全区内
  cardMaxWidth.value = next < 1 ? Math.max(1, Math.floor(available / next)) : 0
  if (Math.abs(next - zoom.value) > 0.005) zoom.value = next
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
  opacity: String(resolved.value?.appearance.opacity ?? props.config.appearance.opacity ?? 1),
  ...(cardMaxWidth.value > 0 ? { maxWidth: `${cardMaxWidth.value}px` } : {})
}))

/** 空态卡片固定使用全局外观，避免单项覆盖干扰 */
const emptyCardStyle = computed(() => ({
  ...cardStyle(props.config, props.config.appearance),
  opacity: String(props.config.appearance.opacity ?? 1),
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

/** 是否允许直接拖动组件（布局设置 / 托盘菜单里都能开关） */
const allowDrag = computed(() => props.config.runtime.window.allowDrag !== false)

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

/** 显示模式：'days' 走大数字 + 单位，其余三种走「大数字 + 小标签」序列 */
const precisionMode = computed<PrecisionMode | null>(() =>
  props.config.behavior.displayMode === 'days' ? null : props.config.behavior.displayMode
)

const preciseParts = computed<PrecisePart[]>(() => {
  const mode = precisionMode.value
  if (!mode || !resolved.value || !result.value) return []
  return buildPrecisionParts(
    mode,
    props.config.behavior.showDaysInPrecise,
    resolved.value.text.unit,
    result.value
  )
})

/** 透明窗口默认让点击穿透到桌面，只有指针落在卡片上才恢复命中 */
function syncInteractive(): void {
  const el = card.value ?? emptyCard.value
  if (!el) return
  // 拖动期间必须一直保持命中，否则指针甩出卡片就会丢掉拖动
  const next = hoverLocked.value || dragging.value
  if (next === interactive) return
  interactive = next
  window.cd.setInteractive(next)
  if (stage.value) stage.value.dataset.interactive = interactive ? 'true' : 'false'
}

/* ---- 拖动：按下卡片后由主进程轮询光标移动窗口，松手时写回偏移量 ---- */

const dragging = ref(false)

function endDrag(): void {
  if (!dragging.value) return
  dragging.value = false
  void window.cd.endDrag()
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  if (props.config.runtime.window.allowDrag === false) return
  const el = (event.currentTarget as HTMLElement | null) ?? card.value ?? emptyCard.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return
  event.preventDefault()
  dragging.value = true
  syncInteractive()
  try {
    el.setPointerCapture(event.pointerId)
  } catch {
    /* 指针捕获失败时仍然按光标轮询移动窗口 */
  }
  void window.cd
    .beginDrag({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    .then((ok) => {
      if (!ok) endDrag()
    })
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

/** 松手的位置可能已经跑到窗口外面，所以监听挂在 window 上而不是卡片上 */
function onPointerUp(): void {
  endDrag()
}

onMounted(async () => {
  timer = window.setInterval(() => {
    nowRef.value = new Date()
  }, 1000)
  if (stage.value) stage.value.dataset.interactive = 'false'
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('blur', onPointerUp)
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

/** 拖动状态对外暴露，便于自动化验证与调试 */
watch(dragging, (value) => {
  if (stage.value) stage.value.dataset.dragging = value ? 'true' : 'false'
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
  resizeObserver?.disconnect()
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  window.removeEventListener('blur', onPointerUp)
  unhookCursor?.()
  unhookShown?.()
  if (dragging.value) void window.cd.endDrag()
  if (interactive) void window.cd.setInteractive(false)
})
</script>
