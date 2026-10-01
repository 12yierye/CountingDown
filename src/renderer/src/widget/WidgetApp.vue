<template>
  <div
    ref="stage"
    class="cd-stage"
    :class="{ 'is-opaque': !transparent }"
    :data-corner="config.runtime.window.corner"
  >
    <div v-if="card.resolved.value" ref="shrink" class="cd-shrink" :style="shrinkStyle">
      <CountdownCard
        ref="cardEl"
        class="cd-card"
        :class="{ 'is-draggable': allowDrag }"
        :style="cardStyleObject"
        :title="card.resolved.value.text.title"
        :precise-parts="card.precisionMode.value ? card.preciseParts.value : null"
        :abs-days="card.absDays.value"
        :unit="card.unit.value"
        :hint-text="card.hintText.value"
        :status-text="card.statusText.value"
        :show-hint="card.showHint.value"
        :show-status="card.showStatus.value"
        :title-style="card.titleStyle.value"
        :count-style="card.countStyle.value"
        :hint-style="card.hintStyle.value"
        :status-style="card.statusStyle.value"
        :unit-style="card.unitStyle.value"
        @pointerdown="onPointerDown"
      />
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
      <div class="cd-card__title" :style="card.titleStyle.value">
        {{ t('list.noCountdown') }}
      </div>
      <div class="cd-card__hint" :style="card.hintStyle.value">
        {{ t('list.noCountdownHint') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig } from '@shared/types'
import { cardStyle } from '@/utils/style'
import { useCountdownCard } from '@/composables/useCountdownCard'
import CountdownCard from '@/components/CountdownCard.vue'

const props = defineProps<{ config: AppConfig }>()

const { t } = useI18n()

const card = useCountdownCard(() => props.config, { live: true })

const stage = ref<HTMLElement | null>(null)
/** CountdownCard 组件实例：`$el` 就是卡片根元素（组件只有一个根节点） */
const cardEl = ref<{ $el?: HTMLElement } | null>(null)
const shrink = ref<HTMLElement | null>(null)
const emptyCard = ref<HTMLElement | null>(null)
const hoverLocked = ref(false)
/** 主进程推来的最后一次屏幕坐标；关掉点击穿透时用它重新定位命中 */
let lastPoint: { x: number; y: number } | null = null
let interactive = false

/** 是否真的在用透明渲染（系统关闭透明效果时会退回不透明模式） */
const transparent = ref(true)

/** 鼠标点击穿透：开启后组件完全不接收鼠标事件 */
const clickThrough = computed(() => props.config.runtime.window.clickThrough === true)

/**
 * 内容比窗口还宽时（例如精确模式 + 超大字号）整体等比缩小，
 * 否则卡片会越过“安全区”被窗口裁掉。用 zoom 而不是 transform，
 * 因为 zoom 会真正缩小布局盒子。
 *
 * 测量要点：zoom 作用在 .cd-shrink 上，所以 `getBoundingClientRect()` 给的是**缩放后**的
 * 视觉尺寸，而 `scrollWidth` / `offsetWidth` 给的是**布局尺寸**（不随 zoom 变化）。
 * 这里一律用布局尺寸算「自然宽度」，一次就能得到正确的比例。
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

/** 卡片本体：拖动与命中判定都要拿到真实 DOM 节点 */
function cardNode(): HTMLElement | null {
  return cardEl.value?.$el ?? emptyCard.value
}

function measureShrink(): void {
  const host = shrink.value
  const el = cardNode()
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

const cardStyleObject = computed(() => ({
  ...card.cardStyleObject.value,
  ...(cardMaxWidth.value > 0 ? { maxWidth: `${cardMaxWidth.value}px` } : {})
}))

/** 空态卡片固定使用全局外观，避免单项覆盖干扰 */
const emptyCardStyle = computed(() => ({
  ...cardStyle(props.config, props.config.appearance),
  maxWidth: '320px'
}))

/** 是否允许直接拖动组件（布局设置 / 托盘菜单里都能开关） */
const allowDrag = computed(
  () => props.config.runtime.window.allowDrag !== false && !clickThrough.value
)

/** 透明窗口默认让点击穿透到桌面，只有指针落在卡片上才恢复命中 */
function syncInteractive(): void {
  const el = cardNode()
  if (!el) return
  // 点击穿透模式下永远不恢复命中；拖动期间必须保持命中，否则指针甩出卡片就会丢掉拖动
  const next = clickThrough.value
    ? false
    : hoverLocked.value || dragging.value
  if (next === interactive) return
  interactive = next
  // 主进程会在应用状态前用 clickThrough 判一次「是否真的需要穿透」，渲染层的这次调用
  // 只负责把状态同步过去，因此即便两边判断一致也不会互相打架
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
  if (!allowDrag.value) return
  if (props.config.runtime.window.allowDrag === false) return
  const el = (event.currentTarget as HTMLElement | null) ?? cardNode()
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
  // 穿透期间虽然不处理命中，但坐标要一直记着：关掉穿透的那一刻要靠它立刻恢复命中
  lastPoint = point
  if (clickThrough.value) return
  hoverLocked.value = pointIn(cardNode(), point.x - window.screenX, point.y - window.screenY)
  if (stage.value) {
    stage.value.dataset.hoverPoint = `${Math.round(point.x - window.screenX)},${Math.round(
      point.y - window.screenY
    )}`
  }
  syncInteractive()
}

/**
 * 关闭点击穿透那一刻的兜底判定。
 *
 * 指针可能正停在卡片上而且一动不动：主进程的光标轮询只对「坐标变化」发事件，
 * 复位后的命中状态就没人再上报，组件会一直不可点（表现为「关了穿透还是点不到」）。
 *
 * 渲染进程拿不到全局光标位置，但主进程推来的最后一次坐标是有效的：
 * 用它 + 当前窗口位置重新算一次即可，指针真移开了的话，
 * 下一次轮询（80ms 一次）会用新坐标纠正回来。
 */
function relocalizeHover(): void {
  const el = cardNode()
  if (!el) return
  if (lastPoint) {
    hoverLocked.value = pointIn(el, lastPoint.x - window.screenX, lastPoint.y - window.screenY)
    return
  }
  // 还从没收到过光标位置：用 :hover 兜底（Chromium 会按真实指针位置计算）
  hoverLocked.value = el.matches(':hover')
}

let unhookCursor: (() => void) | null = null
let unhookShown: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null

/** 松手的位置可能已经跑到窗口外面，所以监听挂在 window 上而不是卡片上 */
function onPointerUp(): void {
  endDrag()
}

onMounted(async () => {
  if (stage.value) stage.value.dataset.interactive = 'false'
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('blur', onPointerUp)
  unhookCursor = window.cd.onCursor(onGlobalCursor)
  // 主进程每次显示组件都会重置鼠标穿透状态，这里同步丢掉缓存，
  // 否则「显示前指针已经在卡片上」时会被误判成不需要恢复命中
  unhookShown = window.cd.onWidgetShown(() => {
    interactive = false
    hoverLocked.value = false
    lastPoint = null
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
  syncInteractive()
})

/** 配置变化后重新测量（等 DOM 更新完） */
watch(
  () => [props.config, card.resolved.value] as const,
  () => {
    void nextTick(measureShrink)
  }
)

/**
 * 点击穿透开关变化：立刻重新判定命中状态。
 *
 * 关闭穿透时指针可能正停在卡片上而且一动不动，主进程的光标轮询不会再产生新事件，
 * 这里必须主动做一次本地判定（用真实屏幕坐标算，而不是盲目置 true），
 * 否则组件会一直保持「不接收鼠标」，表现为「关了穿透还是点不到」。
 */
watch(clickThrough, (value) => {
  if (value) {
    hoverLocked.value = false
    syncInteractive()
    return
  }
  relocalizeHover()
  syncInteractive()
})

/** 拖动状态对外暴露，便于自动化验证与调试 */
watch(dragging, (value) => {
  if (stage.value) stage.value.dataset.dragging = value ? 'true' : 'false'
})

onBeforeUnmount(() => {
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
