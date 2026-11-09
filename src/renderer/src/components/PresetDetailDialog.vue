<script setup lang="ts">
/**
 * 预设参数详情：让用户可以在**不套用**的前提下看清一个预设（内置或自定义）
 * 到底把哪些参数设成了什么值，包括各段文案的实际内容。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, AppearanceConfig } from '@shared/types'
import CountdownPreview from '@/components/CountdownPreview.vue'
import { hexToRgba, textStyle } from '@/utils/style'

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

/**
 * 样张底色 = 这个预设自己的背景色（带上它的透明度）。
 *
 * 原来样张直接摆在对话框的白底上，靠一层 text-shadow 勉强描边，
 * 遇到「深色卡片 + 白字」的预设仍然几乎看不见。铺上真实底色之后，
 * 对比度就是预设实际的样子，也不再需要那层阴影。
 */
const sampleBg = computed(() => {
  const color = props.appearance?.background?.color
  if (!color) return {}
  const alpha = props.appearance?.background?.alpha
  const rgba = hexToRgba(color, typeof alpha === 'number' ? alpha : 1)
  // 用一层渐变叠在浅色底上：背景本身半透明时仍然看得见底，不会变成一片空白
  return { backgroundImage: `linear-gradient(${rgba}, ${rgba})` }
})

/**
 * 字体族只显示第一个字体名，后面挂一个「+N」。
 *
 * 整串 CSS 栈（`"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", …`）
 * 放进参数表会换行五六行，把整张网格撑歪；省略号 + 悬浮又要鼠标才能看全。
 * 这里默认只给一个人能读的名字，点一下**就地**展开完整栈，再点收起。
 */
const fontStack = computed(() =>
  String(props.appearance?.fontFamily ?? '')
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
)

const fontHead = computed(() => fontStack.value[0] ?? '')
const fontRest = computed(() => Math.max(0, fontStack.value.length - 1))
const fontExpanded = ref(false)

/** 换一个预设就收起展开的字体栈，别把上一个的状态带过来 */
watch(
  () => props.name,
  () => {
    fontExpanded.value = false
  }
)

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
          <button
            v-if="fontStack.length"
            type="button"
            class="detail__font"
            :aria-expanded="fontExpanded"
            @click="fontExpanded = !fontExpanded"
          >
            <span class="detail__font-head">{{ fontHead }}</span>
            <span v-if="fontRest" class="detail__font-badge">+{{ fontRest }}</span>
          </button>
          <span v-else class="detail__value">{{ show('') }}</span>
        </div>
        <div v-if="fontExpanded" class="detail__font-full mono">
          {{ appearance.fontFamily }}
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
      </div>

      <div class="detail__styles">
        <div v-for="row in styleRows" :key="row.key" class="detail__style">
          <div class="detail__style-name">{{ t(row.label) }}</div>

          <!--
            一项一行，不并排：五行参数长短不一，挤成一行时会按字数自己折行，
            四张卡的折行位置各不相同，整块看起来就是参差不齐的。
          -->
          <div class="detail__style-values">
            <div class="detail__kv">
              <span class="detail__k">{{ t('preset.fieldFontSize') }}</span>
              <span class="detail__v">{{ appearance[row.key].fontSize }} px</span>
            </div>
            <div class="detail__kv">
              <span class="detail__k">{{ t('preset.fieldColor') }}</span>
              <span class="detail__v mono">
                <span
                  class="detail__swatch"
                  :style="{ background: appearance[row.key].color }"
                ></span>
                {{ appearance[row.key].color }}
              </span>
            </div>
            <div class="detail__kv">
              <span class="detail__k">{{ t('preset.fieldWeight') }}</span>
              <span class="detail__v">{{ appearance[row.key].weight }}</span>
            </div>
            <div class="detail__kv">
              <span class="detail__k">{{ t('preset.fieldLetterSpacing') }}</span>
              <span class="detail__v">{{ appearance[row.key].letterSpacing }} px</span>
            </div>
            <div class="detail__kv">
              <span class="detail__k">{{ t('preset.fieldOpacity') }}</span>
              <span class="detail__v">{{ percent(appearance[row.key].opacity) }}</span>
            </div>
          </div>

          <!--
            样张放在参数下面而不是和名字并排：它的大小、颜色都属于「结果」，
            并排会让每张卡的标题行被样张高度撑得不一样高。
            底色用这个预设自己的背景色，深底浅字才看得出对比。
          -->
          <div
            class="detail__style-sample"
            :style="[
              textStyle(appearance[row.key]),
              { fontFamily: appearance.fontFamily },
              sampleBg
            ]"
          >
            {{ row.sample }}
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
  /* break-all 会把 "Microsoft" 从中间劈开，中文段落又需要能断行：用 anywhere 而不是 break-all */
  word-break: normal;
  overflow-wrap: anywhere;
}

/* 字体族：首字体 + 「+N」，点一下就地展开完整栈（不弹窗、不用省略号） */
.detail__font {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  color: var(--el-color-primary);
  text-align: left;
  cursor: pointer;
}

.detail__font:hover .detail__font-head {
  text-decoration: underline;
}

.detail__font-head {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail__font-badge {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--el-fill-color);
  font-size: 11px;
  line-height: 17px;
  color: var(--el-text-color-secondary);
}

/* 展开后的完整字体栈：跨两列铺开，等宽字体，允许换行 */
.detail__font-full {
  grid-column: 1 / -1;
  margin: 0 0 4px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
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
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 8px 10px;
}

.detail__style-name {
  font-size: 12.5px;
  font-weight: 600;
}

/* 一项一行：左边参数名、右边取值，两端对齐，不再按字数自己折行 */
.detail__style-values {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
  font-size: 12px;
}

.detail__kv {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  min-height: 18px;
}

.detail__k {
  flex: none;
  color: var(--el-text-color-secondary);
}

.detail__v {
  min-width: 0;
  color: var(--el-text-color-regular);
  font-variant-numeric: tabular-nums;
  text-align: right;
  overflow-wrap: anywhere;
}

/* 样张：参数下面是「结果」，底色用预设自己的背景色 */
.detail__style-sample {
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background-color: var(--el-fill-color-light);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mono {
  font-family: 'Cascadia Mono', Consolas, monospace;
}
</style>
