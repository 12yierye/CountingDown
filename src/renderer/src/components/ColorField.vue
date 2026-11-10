<script setup lang="ts">
/**
 * 取色器 + 十六进制显示 + 悬浮取色信息。
 *
 * 透明度**不**在这里：它是「背景」这一级的独立设置，塞进取色器弹层里
 * 等于把它藏起来（用户根本不知道点开颜色还有一根滑条）。调用方各自放一行滑块。
 *
 * 悬浮层不用 el-tooltip：tooltip 的定位与箭头是为「一句说明」设计的，
 * 这里要放两行对齐的键值（HEX / RGB），用 tooltip 会被压成一段文字。
 * 自己画一个 position: fixed 的小浮层，还能顺带躲开滚动容器的 overflow 裁剪。
 */
import { computed, ref } from 'vue'
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

const hex = computed(() => localColor.value.toUpperCase())

/** 只算 RGB：透明度是独立设置，混进颜色值里会让人以为改的是同一件事 */
const rgb = computed(() => {
  const value = localColor.value.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `${r}, ${g}, ${b}`
})

const root = ref<HTMLElement | null>(null)
const hover = ref(false)
const anchor = ref({ top: 0, left: 0 })

function showInfo(): void {
  const rect = root.value?.getBoundingClientRect()
  if (!rect) return
  // 贴边时往回让一点，别让浮层跑出窗口 —— 弹窗里最下面那行颜色最容易踩到
  const top = Math.min(rect.bottom + 6, window.innerHeight - 66)
  const left = Math.min(rect.left, window.innerWidth - 168)
  // fixed 定位：父级可能是 overflow:auto 的滚动区，相对定位会被裁掉
  anchor.value = { top, left }
  hover.value = true
}
</script>

<template>
  <div ref="root" class="color-field" @mouseenter="showInfo" @mouseleave="hover = false">
    <div class="color-field__top">
      <el-color-picker
        v-model="localColor"
        :predefine="presetColors"
        :show-alpha="false"
        size="small"
      />
      <span class="color-field__hex">{{ hex }}</span>
    </div>

    <div
      v-if="hover"
      class="color-field__info"
      :style="{ top: `${anchor.top}px`, left: `${anchor.left}px` }"
      role="status"
    >
      <span class="color-field__info-key">HEX</span>
      <span class="color-field__info-value">{{ hex }}</span>
      <span class="color-field__info-key">RGB</span>
      <span class="color-field__info-value">{{ rgb }}</span>
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

/* 悬浮信息：两列键值，比 tooltip 更像一张小卡片，也不抢焦点 */
.color-field__info {
  position: fixed;
  z-index: 4000;
  display: grid;
  grid-template-columns: auto auto;
  gap: 2px 10px;
  padding: 6px 9px;
  border-radius: var(--cd-r-md);
  border: 1px solid var(--cd-line);
  background: var(--cd-s2);
  box-shadow: var(--el-box-shadow-light);
  pointer-events: none;
  white-space: nowrap;
}

.color-field__info-key {
  font-size: 11px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.color-field__info-value {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--el-text-color-primary);
  font-variant-numeric: tabular-nums;
}
</style>
