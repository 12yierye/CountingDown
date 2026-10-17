<script setup lang="ts">
/**
 * 预设参数详情：让用户可以在**不套用**的前提下看清一个预设（内置或自定义）
 * 到底把哪些参数设成了什么值，包括各段文案的实际内容。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, AppearanceConfig } from '@shared/types'
import CountdownPreview from '@/components/CountdownPreview.vue'
import { textStyle } from '@/utils/style'

const props = defineProps<{
  modelValue: boolean
  name: string
  appearance: AppearanceConfig | null
  /** 预览与文案都取自真实配置；预设只覆盖其中的 appearance */
  config: AppConfig
}>()

const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()

const { t } = useI18n()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

interface StyleRow {
  key: 'title' | 'count' | 'hint' | 'status'
  label: string
  sample: string
}

const styleRows = computed<StyleRow[]>(() => [
  { key: 'title', label: 'appearance.titleStyle', sample: t('sample.title') },
  { key: 'count', label: 'appearance.countStyle', sample: '128' },
  { key: 'hint', label: 'appearance.hintStyle', sample: t('sample.hint') },
  { key: 'status', label: 'appearance.statusStyle', sample: t('sample.status') }
])

const bg = computed(() => props.appearance?.background ?? null)

const previewConfig = computed<AppConfig>(() =>
  props.appearance ? { ...props.config, appearance: props.appearance } : props.config
)

const textRows = computed(() => {
  const text = props.config.text
  if (!text) return []
  return [
    { label: 'target.hintText', value: text.hint },
    { label: 'target.futureText', value: text.futureText },
    { label: 'target.todayText', value: text.todayText },
    { label: 'target.pastText', value: text.pastText }
  ]
})

function show(value: unknown, suffix = ''): string {
  if (value === undefined || value === null || value === '') return t('preset.detailEmpty')
  return `${value}${suffix}`
}

function percent(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return t('preset.detailEmpty')
  return `${Math.round(value * 100)}%`
}
</script>

<template>
  <el-dialog v-model="visible" :title="t('preset.detailTitle')" width="720px" top="6vh">
    <div v-if="appearance" class="detail">
      <div class="detail__head">
        <div class="detail__sample-wrap">
          <!-- 真组件渲染，尺寸与比例和桌面卡片一致 -->
          <CountdownPreview :config="previewConfig" sample still :scale="0.5" />
        </div>
        <div class="detail__name">
          <span class="detail__name-label">{{ t('preset.nameLabel') }}</span>
          <span class="detail__name-value">{{ name }}</span>
          <span class="detail__note">{{ t('preset.detailNote') }}</span>
        </div>
      </div>

      <el-divider content-position="left">{{ t('preset.detailAppearance') }}</el-divider>
      <div class="detail__grid">
        <div class="detail__row">
          <span class="detail__label">{{ t('preset.fieldFont') }}</span>
          <span class="detail__value mono">{{ show(appearance.fontFamily) }}</span>
        </div>
        <div class="detail__row">
          <span class="detail__label">{{ t('preset.fieldBgColor') }}</span>
          <span class="detail__value mono">
            <span class="detail__swatch" :style="{ background: bg?.color }"></span>
            {{ show(bg?.color) }}
          </span>
        </div>
        <div class="detail__row">
          <span class="detail__label">{{ t('preset.fieldBgAlpha') }}</span>
          <span class="detail__value">{{ percent(bg?.alpha) }}</span>
        </div>
        <div class="detail__row">
          <span class="detail__label">{{ t('preset.fieldRadius') }}</span>
          <span class="detail__value">{{ show(bg?.radius, ' px') }}</span>
        </div>
        <div class="detail__row">
          <span class="detail__label">{{ t('preset.fieldPadding') }}</span>
          <span class="detail__value">{{ show(bg?.padding, ' px') }}</span>
        </div>
        <div class="detail__row">
          <span class="detail__label">{{ t('preset.fieldWidth') }}</span>
          <span class="detail__value">{{ show(bg?.width, ' px') }}</span>
        </div>
        <div class="detail__row">
          <span class="detail__label">{{ t('preset.fieldBorderWidth') }}</span>
          <span class="detail__value">{{ show(bg?.borderWidth, ' px') }}</span>
        </div>
        <div class="detail__row">
          <span class="detail__label">{{ t('preset.fieldBorderColor') }}</span>
          <span class="detail__value mono">
            <span class="detail__swatch" :style="{ background: bg?.borderColor }"></span>
            {{ show(bg?.borderColor) }}
          </span>
        </div>
        <div class="detail__row">
          <span class="detail__label">{{ t('preset.fieldShadow') }}</span>
          <span class="detail__value">{{ show(bg?.shadow) }}</span>
        </div>
        <div class="detail__row">
          <span class="detail__label">{{ t('preset.fieldShadowColor') }}</span>
          <span class="detail__value mono">
            <span class="detail__swatch" :style="{ background: bg?.shadowColor }"></span>
            {{ show(bg?.shadowColor) }}
          </span>
        </div>
        <div class="detail__row">
          <span class="detail__label">{{ t('preset.fieldTextAlpha') }}</span>
          <span class="detail__value">{{ percent(appearance.textAlpha) }}</span>
        </div>
      </div>

      <div class="detail__styles">
        <div v-for="row in styleRows" :key="row.key" class="detail__style">
          <div class="detail__style-head">
            <span class="detail__style-name">{{ t(row.label) }}</span>
            <span class="detail__style-sample" :style="textStyle(appearance[row.key], appearance.textAlpha)">
              {{ row.sample }}
            </span>
          </div>
          <div class="detail__style-values">
            <span>{{ t('preset.fieldFontSize') }} {{ appearance[row.key].fontSize }} px</span>
            <span class="mono">
              {{ t('preset.fieldColor') }} {{ appearance[row.key].color }}
              <span
                class="detail__swatch"
                :style="{ background: appearance[row.key].color }"
              ></span>
            </span>
            <span>{{ t('preset.fieldWeight') }} {{ appearance[row.key].weight }}</span>
            <span>{{ t('preset.fieldLetterSpacing') }} {{ appearance[row.key].letterSpacing }} px</span>
            <span>{{ t('preset.fieldOpacity') }} {{ percent(appearance[row.key].opacity) }}</span>
          </div>
        </div>
      </div>

      <template v-if="textRows.length">
        <el-divider content-position="left">{{ t('preset.detailText') }}</el-divider>
        <div class="detail__grid">
          <div v-for="row in textRows" :key="row.label" class="detail__row">
            <span class="detail__label">{{ t(row.label) }}</span>
            <span class="detail__value">{{ show(row.value) }}</span>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <el-button @click="visible = false">{{ t('common.close') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.detail__head {
  display: flex;
  align-items: center;
  gap: 20px;
}

.detail__sample-wrap {
  flex: none;
  width: 220px;
  height: 124px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--el-fill-color-light);
  overflow: hidden;
}

.detail__name {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.detail__name-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.detail__name-value {
  font-size: 15px;
  font-weight: 600;
}

.detail__note {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.detail__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 4px 24px;
}

.detail__row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-height: 26px;
  min-width: 0;
}

.detail__label {
  flex: none;
  width: 110px;
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
}

.detail__value {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  word-break: break-all;
}

.detail__swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid var(--el-border-color);
  vertical-align: -1px;
  margin-right: 4px;
}

.detail__styles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 10px 20px;
  margin-top: 6px;
}

.detail__style {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 8px 10px;
}

.detail__style-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
}

.detail__style-name {
  font-size: 12.5px;
  font-weight: 600;
}

.detail__style-sample {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 55%;
  text-shadow:
    0 1px 0 var(--el-bg-color),
    0 -1px 0 var(--el-bg-color);
}

.detail__style-values {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.mono {
  font-family: 'Cascadia Mono', Consolas, monospace;
}
</style>
