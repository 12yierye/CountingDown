<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { TextStyle } from '@shared/types'
import { normalizeWeight, weightLabelKey } from '@/utils/style'
import SliderField from '@/components/SliderField.vue'

const props = withDefaults(
  defineProps<{
    title: string
    modelValue: TextStyle
    sample?: string
    /**
     * 是否显示标题行。外观覆盖的每个容器标题已经说明了这是哪一项，
     * 里面再重复一次只会白占高度，所以那边会把它关掉。
     */
    showTitle?: boolean
  }>(),
  { sample: '', showTitle: true }
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: TextStyle): void
}>()

const { t } = useI18n()

/** 字重只保留系统字体真正会呈现差异的几档 */
const weights = [400, 500, 600, 700, 800]

function update<K extends keyof TextStyle>(key: K, value: TextStyle[K]): void {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>

<template>
  <div class="text-style-editor">
    <div v-if="showTitle || sample" class="text-style-editor__head">
      <span v-if="showTitle" class="text-style-editor__title">{{ title }}</span>
      <span
        class="text-style-editor__sample"
        :style="{
          fontSize: `${Math.min(modelValue.fontSize, 30)}px`,
          color: modelValue.color,
          fontWeight: String(modelValue.weight),
          letterSpacing: `${modelValue.letterSpacing}px`,
          opacity: String(modelValue.opacity ?? 1)
        }"
      >
        {{ sample || '128 天' }}
      </span>
    </div>

    <div class="row">
      <span class="row__label">{{ t('appearance.fontSize') }}</span>
      <div class="row__control">
        <SliderField
          :model-value="modelValue.fontSize"
          :min="10"
          :max="140"
          unit="px"
          @update:model-value="(v: number) => update('fontSize', v)"
        />
      </div>
    </div>

    <div class="row">
      <span class="row__label">{{ t('appearance.color') }}</span>
      <div class="row__control">
        <el-color-picker
          :model-value="modelValue.color"
          size="small"
          @update:model-value="(v: string | null) => update('color', v || '#ffffff')"
        />
      </div>
    </div>

    <div class="row">
      <span class="row__label">{{ t('appearance.weight') }}</span>
      <div class="row__control">
        <el-radio-group
          class="is-compact"
          :model-value="modelValue.weight"
          @update:model-value="(v: string | number | boolean | undefined) => update('weight', normalizeWeight(Number(v)))"
        >
          <el-radio-button v-for="w in weights" :key="w" :value="w">
            {{ t(weightLabelKey(w)) }}
          </el-radio-button>
        </el-radio-group>
      </div>
    </div>

    <div class="row">
      <span class="row__label">{{ t('appearance.letterSpacing') }}</span>
      <div class="row__control">
        <SliderField
          :model-value="modelValue.letterSpacing"
          :min="-6"
          :max="12"
          :step="0.5"
          unit="px"
          @update:model-value="(v: number) => update('letterSpacing', v)"
        />
      </div>
    </div>

    <!-- 透明度按「颜色 + 透明度」拆开：它只影响这一行文字，和背景透明度无关 -->
    <div class="row">
      <span class="row__label">{{ t('appearance.styleOpacity') }}</span>
      <div class="row__control">
        <SliderField
          :model-value="modelValue.opacity ?? 1"
          :min="0.05"
          :max="1"
          :step="0.05"
          @update:model-value="(v: number) => update('opacity', v)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.text-style-editor {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 12px;
  background: var(--el-fill-color-lighter);
  min-width: 0;
}

.text-style-editor__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 12px;
}

.text-style-editor__title {
  font-weight: 600;
  font-size: 13px;
}

.text-style-editor__sample {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 55%;
  /* 这里显示的是组件真实配色，深色主题下在浅底上必然偏淡，属于预期 */
  text-shadow:
    0 1px 0 var(--el-bg-color),
    0 -1px 0 var(--el-bg-color);
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 34px;
}

.row__label {
  width: 58px;
  flex: none;
  font-size: 13px;
  opacity: 0.78;
}

.row__control {
  flex: 1;
  min-width: 0;
}

/* 只有滑块需要裁掉内部 18px 溢出；标签按钮的边框要完整显示，不能裁 */
.text-style-editor :deep(.slider-field),
.text-style-editor :deep(.el-slider) {
  overflow: hidden;
}
</style>
