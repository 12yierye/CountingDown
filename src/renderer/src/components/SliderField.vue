<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

/**
 * 带可编辑数值的滑块。
 * 顶部不用 el-slider 的 show-input：它内部是完整的 el-input-number（130px 起，
 * 自带滚动条），放进两列网格会把轨道压到 100px 左右。
 * 这里的数值块可以直接点进去输入，避免为了精确值反复拖动。
 */
const props = withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    max?: number
    step?: number
    unit?: string
    /** 精度：显示与舍入的小数位 */
    precision?: number
  }>(),
  { min: 0, max: 100, step: 1, unit: '', precision: 0 }
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: number): void
}>()

/** 0~1 且步长小于 1 时按百分比显示与输入 */
const isRatio = computed(() => props.min === 0 && props.max === 1 && props.step < 1)

const decimals = computed(() => (props.precision > 0 ? props.precision : props.step < 1 ? 2 : 0))

function clamp(value: number): number {
  if (!Number.isFinite(value)) return props.modelValue
  return Math.min(props.max, Math.max(props.min, value))
}

function format(value: number): string {
  if (isRatio.value) return `${Math.round(value * 100)}`
  return Number(value.toFixed(decimals.value)).toString()
}

const display = computed(() => `${format(props.modelValue)}${isRatio.value ? '%' : props.unit}`)

const editing = ref(false)
const draft = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

async function beginEdit(): Promise<void> {
  draft.value = format(props.modelValue)
  editing.value = true
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
}

function commit(): void {
  editing.value = false
  const raw = Number(draft.value.replace(/[^\d.\-]/g, ''))
  if (!Number.isFinite(raw)) return
  const next = clamp(isRatio.value ? raw / 100 : raw)
  emit('update:modelValue', Number(next.toFixed(decimals.value)))
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    commit()
  } else if (event.key === 'Escape') {
    editing.value = false
  }
}

// 外部值变化时退出编辑态，避免显示与真实值不一致
watch(
  () => props.modelValue,
  () => {
    if (editing.value) editing.value = false
  }
)

function onChange(value: number | number[]): void {
  emit('update:modelValue', clamp(Number(value)))
}
</script>

<template>
  <div class="slider-field">
    <el-slider
      class="slider-field__slider"
      :model-value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      size="small"
      :show-tooltip="false"
      @update:model-value="onChange"
    />
    <input
      v-if="editing"
      ref="inputRef"
      v-model="draft"
      class="slider-field__input"
      type="text"
      inputmode="decimal"
      @blur="commit"
      @keydown="onKeydown"
    />    <button v-else class="slider-field__value" type="button" title="点击输入数值" @click="beginEdit">
      {{ display }}
    </button>
  </div>
</template>
<style scoped>
.slider-field {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  width: 100%;
}

.slider-field__slider {
  flex: 1;
  min-width: 0;
}

.slider-field__value,
.slider-field__input {
  flex: none;
  width: 58px;
  padding: 2px 6px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-light);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font-family: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  white-space: nowrap;
  cursor: text;
}

.slider-field__value:hover {
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
}

.slider-field__input {
  outline: none;
  cursor: text;
}

.slider-field__input:focus {
  border-color: var(--el-color-primary);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
}
</style>
