<script setup lang="ts">
/**
 * 预设参数详情：让用户可以在**不套用**的前提下看清一个预设（内置或自定义）
 * 到底把哪些参数设成了什么值。
 *
 * 只列外观参数，不列文案 —— 预设只覆盖 appearance，文案取自当前配置，
 * 把它摆在「预设参数」里会让人误以为文案也是这个预设的一部分。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, AppearanceConfig } from '@shared/types'
import CountdownPreview from '@/components/CountdownPreview.vue'
import { previewMetrics, sampleBackground, textStyle } from '@/utils/style'

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
 * 与「文字样式样张」共用同一个工具函数，两处看到的是同一套对比度 ——
 * 之前这里用 linear-gradient 叠层、那边用白底 + text-shadow，同一个预设
 * 在两个界面上会显出不同的深浅。
 */
const sampleBg = computed(() => sampleBackground(props.appearance?.background))

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

/**
 * 精简 / 完整：默认精简。
 *
 * 口径与编辑器里的那颗开关一致 —— 只影响四段文字的**字重 / 字距 / 透明度**这三项
 * 高级参数；字号与颜色照常显示，上面的背景参数也整块保留（它们决定「这东西长什么样」，
 * 拆掉反而看不出预设之间的差别）。
 */
const full = ref(false)

/**
 * 每次打开都回到「精简」；换一个预设时收起展开的字体栈。
 *
 * 与外观页那颗「完整参数」一样，查看模式属于「这次怎么看」，不写配置、也不跨次记忆 ——
 * 否则用户切过一次完整，之后再点「查看参数」就再也看不到默认的精简版了。
 */
watch(
  [() => props.modelValue, () => props.name],
  ([open]) => {
    if (!open) return
    full.value = false
    fontExpanded.value = false
  }
)

/**
 * 预览框尺寸跟着「显示精度」走。
 *
 * 精度只有「天」时卡片本身很窄，用给秒级准备的 220×124 会把卡片缩在中间、
 * 两边留出大片空白；反过来精度到秒时卡片很宽，框再窄就会把内容挤扁。
 * 所以低精度用更窄更高的框，高精度用更宽更矮的框。
 */
const metrics = computed(() => previewMetrics(props.config.behavior.displayMode))

const previewConfig = computed<AppConfig>(() =>
  props.appearance ? { ...props.config, appearance: props.appearance } : props.config
)

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
  <el-dialog
    v-model="visible"
    class="preset-detail-dialog"
    :title="t('preset.detailTitle')"
    width="720px"
    align-center
  >
    <div v-if="appearance" class="detail">
      <div class="detail__head">
        <div
          class="detail__sample-wrap"
          :style="{
            width: `${metrics.width}px`,
            height: `${metrics.height}px`,
            '--cd-preview-max-height': `${metrics.height}px`
          }"
        >
          <!-- 真组件渲染；scale 交给它自己按框的大小算，框变窄时卡片跟着缩 -->
          <CountdownPreview :config="previewConfig" sample still />
        </div>
        <div class="detail__name">
          <span class="detail__name-label">{{ t('preset.nameLabel') }}</span>
          <span class="detail__name-value">{{ name }}</span>
          <span class="detail__note">{{ t('preset.detailNote') }}</span>
        </div>
      </div>

      <!--
        「外观参数」分隔线右端挂查看模式开关：和 el-divider 自带的标题是同一套做法 ——
        绝对定位压在线上、用弹窗底色把线遮断，读起来就是「文字 ──── 文字 ────」。
        放标题栏里像个弹窗动作，放名称区右边又离它控制的那四张卡太远。
      -->
      <div class="detail__divider">
        <el-divider content-position="left">{{ t('preset.detailAppearance') }}</el-divider>
        <div class="detail__toggle-wrap">
          <el-button class="detail__toggle" link size="small" @click="full = !full">
            {{ full ? t('appearance.textCompact') : t('appearance.textFull') }}
          </el-button>
        </div>
      </div>
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
            <!-- 字重 / 字距 / 透明度属于高级参数，精简模式下不显示（与编辑器同一口径） -->
            <template v-if="full">
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
            </template>
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

/* 宽高由内联样式按显示精度给，这里只负责定住位置与底色 */
.detail__sample-wrap {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--cd-r-md);
  background: var(--cd-s2);
  overflow: hidden;
}

/* 自动适配要靠容器的可用宽度来决定缩放比例：
   预览根节点默认按内容宽度撑开，量到的永远是"卡片多宽"，缩放就成了 1。 */
.detail__sample-wrap :deep(.preview) {
  width: 100%;
}

.detail__name {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/* 分隔线 + 右端开关：开关压在线上，包一层带底色的容器把线遮断 */
.detail__divider {
  position: relative;
}

.detail__toggle-wrap {
  position: absolute;
  top: 50%;
  right: 0;
  display: flex;
  align-items: center;
  /* 左侧留白 = 线与文字之间的断口 */
  padding-left: 12px;
  background: var(--el-dialog-bg-color);
  transform: translateY(-50%);
}

.detail__toggle {
  flex: none;
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
  color: var(--cd-ink-1);
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
  border-radius: var(--cd-r-full);
  background: var(--cd-s3);
  font-size: 11px;
  line-height: 17px;
  color: var(--cd-ink-3);
}

/* 展开后的完整字体栈：跨两列铺开，等宽字体，允许换行 */
.detail__font-full {
  grid-column: 1 / -1;
  margin: 0 0 4px;
  padding: 6px 8px;
  border-radius: var(--cd-r-sm);
  background: var(--cd-s2);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--cd-ink-2);
  word-break: break-all;
}

.detail__swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 4px;
  border: 1px solid var(--cd-line);
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
  border: 1px solid var(--cd-line-soft);
  border-radius: var(--cd-r-md);
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
  border-radius: var(--cd-r-sm);
  background-color: var(--cd-s2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mono {
  font-family: 'Cascadia Mono', Consolas, monospace;
}
</style>
