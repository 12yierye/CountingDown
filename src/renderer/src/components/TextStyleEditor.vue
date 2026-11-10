<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TextStyle } from '@shared/types'
import { normalizeWeight } from '@shared/defaults'
import { sampleBackground, textStyle, weightLabelKey } from '@/utils/style'
import ColorField from '@/components/ColorField.vue'
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
    /**
     * 紧凑模式：只留字号与颜色两行，隐藏字重 / 字距 / 透明度。
     * 外观页默认用它 —— 这三项属于「高级参数」，多数人不会为了调个颜色去滚三屏。
     */
    compact?: boolean
    /**
     * 样张底色。传卡片自己的背景（含透明度），样张里的颜色对比才是它实际的样子。
     * 不传则退回分区底色，用于拿不到完整背景的场景。
     */
    background?: { color?: string; alpha?: number } | null
    /** 样张字体族：卡片实际用的字体，不传则继承外层 */
    fontFamily?: string
  }>(),
  { sample: '', showTitle: true, compact: false, background: null, fontFamily: '' }
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: TextStyle): void
}>()

const { t } = useI18n()

/** 字重只留两档：多数系统字体在 500/600 之间的差异肉眼看不出来，放在这里只是干扰 */
const weights = [400, 700]

function update<K extends keyof TextStyle>(key: K, value: TextStyle[K]): void {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

/** 样张舞台：底色 + 字体族都取卡片自己的，看到的就是桌面上的效果 */
const stageStyle = computed(() => ({
  ...sampleBackground(props.background),
  ...(props.fontFamily ? { fontFamily: props.fontFamily } : {})
}))

/** 字号用真实值，不做缩减 —— 样张存在的意义就是让你看到这个字号有多大 */
const sampleStyle = computed(() => textStyle(props.modelValue))
</script>

<template>
  <div class="text-style-editor">
    <div v-if="showTitle" class="text-style-editor__head">
      <span class="text-style-editor__title">{{ title }}</span>
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
        <ColorField
          :model-value="modelValue.color"
          @update:model-value="(v: string) => update('color', v)"
        />
      </div>
    </div>

    <div v-if="!compact" class="row">
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

    <div v-if="!compact" class="row">
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
    <div v-if="!compact" class="row">
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

    <!--
      样张放在参数下面，和「预设详情」里的一致：
      它是参数的结果，摆在标题行右侧只能容下几个像素高的一行字，看不出字号。
      底色用卡片自己的背景，颜色和透明度的对比才是真实效果。
    -->
    <div class="text-style-editor__stage" :style="stageStyle">
      <span class="text-style-editor__sample" :style="sampleStyle">
        {{ sample || t('sample.count') }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.text-style-editor {
  border: 1px solid var(--cd-line-soft);
  border-radius: var(--cd-r-md);
  padding: 12px 14px;
  margin-bottom: 12px;
  background: var(--cd-s2);
  min-width: 0;
}

.text-style-editor__head {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
  gap: 12px;
}

.text-style-editor__title {
  font-weight: 600;
  font-size: 13px;
}

/* 样张舞台。没有背景故事的时候（弹窗里拿不到卡片背景）退回比分区亮一档的灰，
   至少能看出这是一块"卡片"，而不是一团浮在面板上的字。 */
.text-style-editor__stage {
  margin-top: 10px;
  padding: 10px 14px;
  border-radius: var(--cd-r-sm);
  border: 1px solid var(--cd-line-soft);
  background: var(--cd-s3);
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.text-style-editor__sample {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
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
</style>
