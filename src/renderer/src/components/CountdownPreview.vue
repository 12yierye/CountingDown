<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, CountdownItem } from '@shared/types'
import { useCountdownCard } from '@/composables/useCountdownCard'
import CountdownCard from '@/components/CountdownCard.vue'
import '@/widget/widget.css'

const props = withDefaults(
  defineProps<{
    config: AppConfig
    /**
     * 全局样式样板：标题固定、日期固定为元旦，
     * 用来展示「全局外观 + 全局文案」长什么样。
     */
    sample?: boolean
    /** 预览时整体缩放比例；0 表示自动适配容器尺寸 */
    scale?: number
    /** 覆盖样板标题（预设调参弹窗用它显示当前输入的预设名） */
    title?: string
    /**
     * 指定要预览的倒数日（编辑页用）。
     * 传了它之后标题、日期、文案、外观都来自这一项，不再用元旦样板。
     */
    item?: CountdownItem | null
    /**
     * 静止模式：不启动每秒重算的定时器。
     * 预设缩略图一次要渲染十几份，样板日期又是固定的，没必要让它们各自跑一个 interval。
     */
    still?: boolean
  }>(),
  { sample: false, scale: 0, title: '', item: null, still: false }
)

const { t } = useI18n()

const card = useCountdownCard(() => props.config, {
  sample: !props.item,
  /*
   * 必须是取值函数，不能写成 `props.title || '元旦'`：
   * 那样只在 setup 时求值一次，之后 props.title 再变也不会重新算 ——
   * 表现为「预设调参弹窗里输入预设名，右侧预览标题纹丝不动」。
   */
  sampleTitle: () => props.title || t('sample.title'),
  item: () => props.item ?? null,
  live: !props.still
})

const titleText = computed(() => {
  // 新建项还没输入名称时给一个占位，否则预览顶部是一条空白行
  if (props.item) {
    return card.resolved.value?.text.title || props.item.name || t('editor.unnamed')
  }
  return props.sample ? props.title || t('sample.title') : card.resolved.value?.text.title ?? ''
})

/** 字号超过 64px 时先按字号缩一档，避免一个超大数字把整张卡撑得没法看 */
const fontScale = computed(() => {
  if (props.scale > 0) return props.scale
  const fontSize = (card.resolved.value?.appearance ?? props.config.appearance).count.fontSize
  if (fontSize <= 64) return 1
  return Number((64 / fontSize).toFixed(3))
})

/* ------------------------------------------------------------------ *
 * 自动适配容器
 *
 * 用户把卡片宽度设成 600px、字号拉到 140，预览栏只有两百多像素 —— 内容会直接
 * 溢出到栏外（编辑页右侧那一列最明显）。这里量**未经变换**的布局尺寸
 * （offsetWidth/offsetHeight 不受 transform 影响），再按容器的可用宽高等比缩。
 *
 * 高度上限从 `.preview--fit` 的 `max-height` 解析值来，不是 clientHeight：
 * 外层盒子的高度是按缩放结果回填的，拿 clientHeight 当输入会「缩一点 → 盒子变矮
 * → 再缩一点」来回震荡；max-height 是外部常量，天然稳定。
 * ------------------------------------------------------------------ */
const fixedScale = computed(() => props.scale > 0)

const wrapRef = ref<HTMLElement | null>(null)
const boxRef = ref<HTMLElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)
const autoScale = ref(1)
/** 缩放后内容真正占的高度；给外层盒子用，避免下面拖出一大片空白 */
const boxHeight = ref<number | null>(null)
const scale = computed(() => (fixedScale.value ? props.scale : Math.min(fontScale.value, autoScale.value)))

let frame = 0
let observer: ResizeObserver | null = null

function measure(): void {
  if (frame) {
    cancelAnimationFrame(frame)
    frame = 0
  }
  if (fixedScale.value) {
    autoScale.value = 1
    boxHeight.value = null
    return
  }
  const wrap = wrapRef.value
  const content = contentRef.value
  if (!wrap || !content) return
  const contentWidth = content.offsetWidth
  const contentHeight = content.offsetHeight
  if (!contentWidth || !contentHeight) return
  const style = getComputedStyle(wrap)
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
  const availWidth = wrap.clientWidth - padX
  /*
   * 高度上限取 max-height 的解析值，而不是 clientHeight：
   * clientHeight 会被我们自己设的盒子高度影响，拿它当输入会来回震荡
   * （缩一点 → 盒子变矮 → 再缩一点）。max-height 是外部常量，天然稳定。
   */
  const maxHeight = parseFloat(style.maxHeight)
  const availHeight = (Number.isFinite(maxHeight) ? maxHeight : wrap.clientHeight) - padY
  if (availWidth <= 0 || availHeight <= 0) return
  const next = Math.min(1, availWidth / contentWidth, availHeight / contentHeight)
  // 0.2 兜底：容器初始化时宽度可能是 0，别把预览缩成一个点
  const clamped = Math.max(0.2, Number(next.toFixed(3)))
  if (Math.abs(clamped - autoScale.value) > 0.002) autoScale.value = clamped
  const height = Math.round(contentHeight * autoScale.value)
  if (boxHeight.value === null || Math.abs(boxHeight.value - height) > 1) boxHeight.value = height
}

function schedule(): void {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    measure()
  })
}

onMounted(() => {
  measure()
  void nextTick(measure)
  window.addEventListener('resize', schedule)
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(schedule)
    if (wrapRef.value) observer.observe(wrapRef.value)
    if (contentRef.value) observer.observe(contentRef.value)
  }
})

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  window.removeEventListener('resize', schedule)
  observer?.disconnect()
  observer = null
})

/*
 * 卡片尺寸变化一般由 ResizeObserver 兜住，但「改外观配置」这条路径不能只靠它：
 * 一次 patch 会同时改字号和宽度，观察回调偶尔会拿到变更前的尺寸（实测过），
 * 结果就是按旧尺寸算出来的比例一直挂着。这里在 DOM 更新后补量一次，双保险。
 */
watch(
  () => [props.scale, props.item, props.config.appearance],
  () => void nextTick(measure)
)
</script>

<template>
  <div ref="wrapRef" class="preview" :class="{ 'preview--fit': !fixedScale }">
    <div ref="boxRef" class="preview__box" :style="boxHeight ? { height: boxHeight + 'px' } : undefined">
      <div ref="contentRef" class="preview__content" :style="{ transform: `scale(${scale})` }">
        <div class="cd-stage is-preview">
          <div class="cd-shrink">
            <CountdownCard
              :title="titleText"
              :precise-parts="card.precisionMode.value ? card.preciseParts.value : null"
              :abs-days="card.absDays.value"
              :unit="card.unit.value"
              :hint-text="card.hintText.value"
              :status-text="card.statusText.value"
              :show-hint="card.showHint.value"
              :show-status="card.showStatus.value"
              :style="card.cardStyleObject.value"
              :title-style="card.titleStyle.value"
              :count-style="card.countStyle.value"
              :hint-style="card.hintStyle.value"
              :status-style="card.statusStyle.value"
              :unit-style="card.unitStyle.value"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 0 4px;
  overflow: hidden;
}

/* 自动适配模式才限高：限高后超出的部分本来就被缩掉了，不会真的被裁掉内容 */
.preview--fit {
  align-items: flex-start;
  max-height: var(--cd-preview-max-height, 420px);
}

/*
 * 外层盒子只负责「占位」：高度由缩小后的视觉尺寸算出，宽度取内容的自然宽度。
 * 这样缩下去之后，下面的说明文字不会被一大块空白推走。
 */
.preview__box {
  flex: none;
  width: max-content;
  max-width: none;
}

/*
 * 这块是「未变换」的布局盒：量 offsetWidth / offsetHeight 拿到的才是卡片的自然尺寸。
 *
 * 固定比例（预设缩略图）保持从中心缩放，和以前完全一致；
 * 自动适配时改成从顶部中间展开 —— 视觉内容贴着盒子顶边排，正好填满缩小后的高度。
 */
.preview__content {
  width: max-content;
  max-width: none;
  transform-origin: center center;
}

.preview--fit .preview__content {
  transform-origin: top center;
}

/*
 * 预览里的舞台只负责提供角落对齐所需的 flex 上下文：
 * 组件窗口里 .cd-shrink 是绝对定位在 624×600 的安全区里，预览没有这个尺寸，
 * 所以改成流式布局，宽度交给卡片自己（fit-content 或用户设定的固定宽度）。
 */
.preview :deep(.cd-stage.is-preview) {
  position: static;
  width: auto;
  height: auto;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview :deep(.cd-stage.is-preview .cd-shrink) {
  position: static;
  top: auto;
  right: auto;
  bottom: auto;
  left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  max-width: none;
}
</style>
