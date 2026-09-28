<script setup lang="ts">
import { computed } from 'vue'
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
import '@/widget/widget.css'

const props = withDefaults(defineProps<{ config: AppConfig; scale?: number }>(), { scale: 0 })

const resolved = computed(() => {
  const item = findActiveItem(props.config)
  return item ? resolveCountdown(props.config, item) : null
})

const result = computed(() =>
  resolved.value ? computeCountdown(resolved.value.target, new Date()) : null
)

const appearance = computed(() => resolved.value?.appearance ?? props.config.appearance)

const cardStyleObject = computed(() => ({
  ...cardStyle(props.config, resolved.value?.appearance ?? undefined),
  // 不透明度属于外观，这里跟桌面组件保持一致
  opacity: String(appearance.value.opacity ?? 1)
}))
const titleStyle = computed(() => textStyle(appearance.value.title))
const countStyle = computed(() => textStyle(appearance.value.count))
const hintStyle = computed(() => textStyle(appearance.value.hint))
const statusStyle = computed(() => textStyle(appearance.value.status))
const unitStyle = computed(() => ({
  fontSize: `${Math.max(12, Math.round(appearance.value.count.fontSize * 0.42))}px`,
  color: appearance.value.count.color,
  fontWeight: String(Math.min(600, appearance.value.count.weight)),
  letterSpacing: `${appearance.value.count.letterSpacing}px`
}))

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
  if (result.value.state === 'future') return applyTemplate(text.futureText, { days: result.value.days })
  if (result.value.state === 'today') return applyTemplate(text.todayText, { days: 0 })
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

/** 预览时按比例缩小，避免大字号撑爆面板 */
const scale = computed(() => {
  if (props.scale > 0) return props.scale
  const fontSize = appearance.value.count.fontSize
  if (fontSize <= 64) return 1
  return Number((64 / fontSize).toFixed(3))
})

const titleText = computed(() => resolved.value?.text.title ?? '')
</script>

<template>
  <div class="preview">
    <div class="preview__stage" :style="{ transform: `scale(${scale})` }">
      <div v-if="resolved" class="cd-card" :style="cardStyleObject">
        <div v-if="titleText.trim()" class="cd-card__title" :style="titleStyle">
          {{ titleText }}
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
      <div v-else class="cd-card__empty">—</div>
    </div>
  </div>
</template>

<style scoped>
.preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 190px;
  padding: 22px 18px;
  border-radius: 12px;
  border: 1px dashed var(--el-border-color);
  background-image:
    linear-gradient(45deg, var(--el-fill-color) 25%, transparent 25%),
    linear-gradient(-45deg, var(--el-fill-color) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--el-fill-color) 75%),
    linear-gradient(-45deg, transparent 75%, var(--el-fill-color) 75%);
  background-size: 18px 18px;
  background-position:
    0 0,
    0 9px,
    9px -9px,
    -9px 0;
  overflow: hidden;
}

.preview__stage {
  transform-origin: center center;
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
}
</style>
