<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { toHexColor } from '@/utils/style'

const props = withDefaults(
  defineProps<{
    modelValue: string
    label?: string
    alpha?: number
    showAlpha?: boolean
    /** 透明度滑块的标签；缺省用「透明度 / Alpha」 */
    alphaLabel?: string
    presetColors?: string[]
  }>(),
  {
    label: '',
    alpha: 1,
    showAlpha: false,
    alphaLabel: '',
    presetColors: () => [
      '#ffffff',
      '#000000',
      '#1e2230',
      '#2563eb',
      '#3a7aff',
      '#39ff88',
      '#d6336c',
      '#ffe3ec',
      '#fdf6d8',
      '#111827'
    ]
  }
)

const { t } = useI18n()

/** 以前这里写的是希腊字母 α，中文界面下没人看得懂；改成「透明度」/「Alpha」 */
const alphaText = computed(() => props.alphaLabel || t('common.alpha'))

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'update:alpha', value: number): void
}>()

const localColor = computed({
  get: () => toHexColor(props.modelValue, '#000000'),
  set: (value: string) => emit('update:modelValue', value || '#000000')
})

const localAlpha = computed({
  get: () => props.alpha,
  set: (value: number) => emit('update:alpha', Number(value))
})
</script>

<template>
  <div class="color-field">
    <div class="color-field__top">
      <el-color-picker
        v-model="localColor"
        :predefine="presetColors"
        :show-alpha="false"
        size="small"
      />
      <span class="color-field__hex">{{ localColor.toUpperCase() }}</span>
    </div>
    <div v-if="showAlpha" class="color-field__alpha-row">
      <span class="color-field__alpha-label">{{ alphaText }}</span>
      <el-slider
        v-model="localAlpha"
        class="color-field__alpha"
        :min="0"
        :max="1"
        :step="0.01"
        size="small"
        :show-tooltip="false"
      />
      <span class="color-field__value">{{ Math.round(localAlpha * 100) }}%</span>
    </div>
  </div>
</template>

<style scoped>
/* 透明度滑块另起一行：挤在一行时在窄列里会溢出并压到相邻列的文字上 */
.color-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.color-field__top {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.color-field__hex {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 12px;
  opacity: 0.8;
  white-space: nowrap;
}

.color-field__alpha-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.color-field__alpha-label {
  flex: none;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.color-field__alpha {
  flex: 1;
  min-width: 0;
}

.color-field__value {
  flex: none;
  min-width: 38px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
</style>
