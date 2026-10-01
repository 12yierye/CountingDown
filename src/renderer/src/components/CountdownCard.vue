<script setup lang="ts">
/**
 * 卡片本体：桌面组件窗口与设置里的实时预览共用这一份模板。
 *
 * 以前预览是照抄一遍组件结构，新增一种显示模式或改一次分隔符就得改两处，
 * 漏一处预览就和真实组件对不上。现在结构只有这一份，两边只在「外壳」
 * （窗口舞台 / 预览舞台）和交互（拖动、窗口缩放）上不同。
 */
import type { PrecisionPart } from '@shared/defaults'

defineProps<{
  title: string
  /** 非 null 时渲染「数字 + 单位/分隔符」序列，否则渲染大数字 + 单位 */
  preciseParts: PrecisionPart[] | null
  absDays: number
  unit: string
  showUnit: boolean
  hintText: string
  statusText: string
  showHint: boolean
  showStatus: boolean
  style: Record<string, string>
  titleStyle: Record<string, string>
  countStyle: Record<string, string>
  hintStyle: Record<string, string>
  statusStyle: Record<string, string>
  unitStyle: Record<string, string>
}>()
</script>

<template>
  <div class="cd-card" :style="style">
    <div v-if="title.trim()" class="cd-card__title" :style="titleStyle">{{ title }}</div>

    <div v-if="preciseParts" class="cd-card__precise" :style="countStyle">
      <span v-for="(part, index) in preciseParts" :key="index" class="cd-card__precision-part">
        <span class="cd-card__number">{{ part.value }}</span>
        <small v-if="part.label">{{ part.label }}</small>
      </span>
    </div>

    <div v-else class="cd-card__count" :style="countStyle">
      <span class="cd-card__number">{{ absDays }}</span>
      <span v-if="showUnit" class="cd-card__unit" :style="unitStyle">{{ unit }}</span>
    </div>

    <div v-if="hintText && showHint" class="cd-card__hint" :style="hintStyle">{{ hintText }}</div>
    <div v-if="statusText && showStatus" class="cd-card__status" :style="statusStyle">
      {{ statusText }}
    </div>
  </div>
</template>
