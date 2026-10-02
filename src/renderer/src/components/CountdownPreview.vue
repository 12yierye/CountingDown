<script setup lang="ts">
import { computed } from 'vue'
import type { AppConfig } from '@shared/types'
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
    /** 预览时整体缩放比例；0 表示按字号自动缩放 */
    scale?: number
    /** 覆盖样板标题（预设调参弹窗用它显示当前输入的预设名） */
    title?: string
  }>(),
  { sample: false, scale: 0, title: '' }
)

const card = useCountdownCard(() => props.config, {
  sample: true,
  /*
   * 必须是取值函数，不能写成 `props.title || '元旦'`：
   * 那样只在 setup 时求值一次，之后 props.title 再变也不会重新算 ——
   * 表现为「预设调参弹窗里输入预设名，右侧预览标题纹丝不动」。
   */
  sampleTitle: () => props.title || '元旦',
  live: true
})

const titleText = computed(() =>
  props.sample ? props.title || '元旦' : card.resolved.value?.text.title ?? ''
)

/** 预览时按比例缩小，避免大字号撑爆面板 */
const fitScale = computed(() => {
  if (props.scale > 0) return props.scale
  const fontSize = (card.resolved.value?.appearance ?? props.config.appearance).count.fontSize
  if (fontSize <= 64) return 1
  return Number((64 / fontSize).toFixed(3))
})
</script>

<template>
  <div class="preview">
    <div class="preview__stage" :style="{ transform: `scale(${fitScale})` }">
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
</template>

<style scoped>
.preview {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 0 4px;
  overflow: hidden;
}

.preview__stage {
  transform-origin: center center;
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
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
  max-width: 100%;
}
</style>
