<script setup lang="ts">
/**
 * 取色器 + 十六进制显示。
 *
 * 透明度**不**在这里：它是「背景」这一级的独立设置，塞进取色器弹层里
 * 等于把它藏起来（用户根本不知道点开颜色还有一根滑条）。调用方各自放一行滑块。
 */
import { computed } from 'vue'
import { toHexColor } from '@/utils/style'

const props = withDefaults(
  defineProps<{
    modelValue: string
    label?: string
    presetColors?: string[]
  }>(),
  {
    label: '',
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

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()

const localColor = computed({
  get: () => toHexColor(props.modelValue, '#000000'),
  set: (value: string) => emit('update:modelValue', value || '#000000')
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
  </div>
</template>

<style scoped>
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
</style>
