<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import type {
  AppConfig,
  AppearanceOverride,
  CountdownItem,
  DateMode,
  DisplayMode
} from '@shared/types'
import {
  createCountdownItem,
  resolveTarget,
  resolveText
} from '@shared/defaults'
import { toPlain } from '@/composables/useConfig'
import { useStickyStuck } from '@/composables/useStickyStuck'
import { modeSlots } from '@/utils/preview'
import FieldRow from '@/components/FieldRow.vue'
import UnitLabelField from '@/components/UnitLabelField.vue'
import TextVariables from '@/components/TextVariables.vue'
import SettingSection from '@/components/SettingSection.vue'
import ItemAppearanceDialog from '@/components/ItemAppearanceDialog.vue'

const props = defineProps<{ config: AppConfig; item: CountdownItem }>()
const emit = defineEmits<{
  (event: 'save', item: CountdownItem): void
  (event: 'close', payload: { saved: boolean }): void
}>()

const { t } = useI18n()

/**
 * 全局文案：留空字段的显示值与初值都来自这里。
 * 注意：不能在 setup 阶段就用它初始化草稿 —— 那时 store 里还是默认配置，
 * 而 computed 之后才更新，reactive 草稿不会跟着变。
 */
const globalText = computed(() => resolveText(undefined, props.config.text))

interface Draft {
  name: string
  enabled: boolean
  /** 当天提醒；不跟随全局，默认关闭 */
  notifyOnToday: boolean
  /** 显示模式覆盖；'' = 跟随全局 */
  displayMode: DisplayMode | ''
  mode: DateMode
  date: string
  month: number
  day: number
  useText: boolean
  text: CountdownItem['text']
  /** 是否单独覆盖四个单位字 */
  unitsCustom: boolean
  units: CountdownItem['units']
}

const draft = reactive<Draft>({
  name: '',
  enabled: true,
  notifyOnToday: false,
  displayMode: '',
  mode: 'annual',
  date: '',
  month: 1,
  day: 1,
  useText: false,
  text: createCountdownItem().text,
  unitsCustom: false,
  units: createCountdownItem().units
})

const appearance = ref<AppearanceOverride>({})
const useAppearance = ref(false)

/**
 * 吸顶状态：吸顶后去掉上方圆角与上边框，左右下边框与下方圆角保留（见样式里的 .is-stuck）。
 * 判定锚点是紧贴栏体前面的零高度元素，与 `top` 的具体数值无关。
 */
const stickyBar = ref<HTMLElement | null>(null)
const stickyAnchor = ref<HTMLElement | null>(null)
const { stuck } = useStickyStuck(stickyBar, stickyAnchor)

/** 把 props.item 的当前值同步进草稿（初始化与外部改动都用这一条路径） */
function syncFromItem(item: CountdownItem): void {
  draft.name = item.name
  draft.enabled = item.enabled
  draft.notifyOnToday = item.notifyOnToday === true
  draft.displayMode = item.displayMode ?? ''
  // 日期是这一项自己的字段；留空只可能是旧数据，resolveTarget 会兜底成 1/1
  const target = resolveTarget(item.target)
  draft.mode = target.mode
  draft.date = target.date
  draft.month = target.month
  draft.day = target.day

  draft.text = { ...createCountdownItem().text, ...(item.text ?? {}) }
  draft.useText = (
    ['hint', 'futureText', 'todayText', 'pastText'] as const
  ).some((key) => String(draft.text[key] ?? '').trim().length > 0)

  /*
   * 单位字覆盖：草稿里放的必须是**配置里存的那一份**，不能提前塞进全局值
   * —— 否则「有未保存修改」的比较会把一个没动过的项判成脏的（打开新建页就弹放弃对话框）。
   * 打开覆盖开关时再把全局当前值填进去（见 toggleUnitsOverride）。
   */
  const savedUnits = { ...createCountdownItem().units, ...(item.units ?? {}) }
  draft.unitsCustom = savedUnits.enabled === true
  draft.units = savedUnits

  appearance.value = JSON.parse(JSON.stringify(item.appearance ?? {})) as AppearanceOverride
  useAppearance.value = Object.keys(appearance.value).length > 0
}

syncFromItem(props.item)

/** 已保存状态的快照字符串，用来判断是否有未保存修改 */
function snapshotOf(item: CountdownItem): string {
  return JSON.stringify({
    name: item.name,
    enabled: item.enabled,
    notifyOnToday: item.notifyOnToday === true,
    displayMode: item.displayMode ?? '',
    target: item.target,
    text: item.text,
    units: item.units,
    appearance: item.appearance
  })
}

const baseline = ref(snapshotOf(props.item))
const savedFlash = ref(false)

/** 把草稿组装成完整列表项 */
function computeItem(): CountdownItem {
  return {
    ...props.item,
    name: draft.name.trim(),
    enabled: draft.enabled,
    notifyOnToday: draft.notifyOnToday,
    displayMode: draft.displayMode,
    target: { mode: draft.mode, date: draft.date, month: draft.month, day: draft.day },
    text: { ...createCountdownItem().text, ...cleanText(draft.text), ...visibilityPatch() },
    /*
     * 单位字：**键顺序必须和 normalizeItem 的输出逐字一致**，否则「有没有未保存修改」
     * 会一直误报 —— 那个判断比的是 JSON.stringify，键序不同就是不同的字符串。
     *   - 开启覆盖：normalizeItem 写 `{ ...normalizeUnits(...), enabled: true }`
     *     （四个字在前、enabled 在最后），所以这里也必须 enabled 在最后；
     *   - 未开启：两边都是 emptyUnitOverride() 的 `{ enabled, day, hour, minute, second }`。
     * 曾经这里写成 enabled 在前，于是开着覆盖的项每次打开编辑页都显示「未保存的更改」。
     */
    units: draft.unitsCustom
      ? {
          day: draft.units.day,
          hour: draft.units.hour,
          minute: draft.units.minute,
          second: draft.units.second,
          enabled: true
        }
      : { enabled: false, day: '', hour: '', minute: '', second: '' },
    appearance: useAppearance.value ? compact(appearance.value) : {}
  }
}

/** 显示开关（两个三态覆盖）单独取，避免被 cleanText 当普通字段过滤掉 */
function visibilityPatch(): Pick<CountdownItem['text'], 'showHint' | 'showStatus'> {
  return {
    showHint: draft.text.showHint,
    showStatus: draft.text.showStatus
  }
}

function currentSnapshot(): string {
  return snapshotOf(computeItem())
}

const dirty = computed(() => currentSnapshot() !== baseline.value)

/**
 * 编辑页自己的实时预览：桌面上那张卡片就是预览本身。
 *
 * 从前这里只有「编辑当前桌面显示项」才会在桌面上看到效果，改别的项等于盲调；
 * 现在草稿会被推给主进程，卡片临时渲染这一项（连 activeId 一起换过去），
 * 退出编辑时还原。
 */
const previewItem = computed<CountdownItem>(() => computeItem())

/* ------------------------------------------------------------------ *
 * 桌面实时预览：把草稿发给主进程（纯内存，不落盘），由主进程套给组件窗口
 * 并强制显示 —— 正在编辑时卡片不允许被关掉。离开编辑页即清空覆盖层，
 * 桌面卡片回到编辑前的样子，显示状态也按原本的意愿还原。
 * ------------------------------------------------------------------ */

const PREVIEW_DEBOUNCE = 60
let previewTimer: number | undefined

function publishPreview(immediate = false): void {
  if (previewTimer) window.clearTimeout(previewTimer)
  if (immediate) {
    previewTimer = undefined
    void window.cd.setPreviewItem(toPlain(computeItem()))
    return
  }
  previewTimer = window.setTimeout(() => {
    previewTimer = undefined
    // computeItem() 里有响应式依赖，必须等定时器触发后再取值
    void window.cd.setPreviewItem(toPlain(computeItem()))
  }, PREVIEW_DEBOUNCE)
}

// 用与「未保存修改」同一个信号：它覆盖到草稿的每一个字段
watch(
  () => currentSnapshot(),
  () => publishPreview()
)

// 设置窗口重新显示时补发一次，避免隐藏期间预览失效
const unsubscribePreviewSync = window.cd.onPreviewSync(() => publishPreview(true))

onMounted(() => publishPreview(true))

onBeforeUnmount(() => {
  if (previewTimer) window.clearTimeout(previewTimer)
  unsubscribePreviewSync()
  // 清空覆盖层 = 还原到编辑前；主进程在设置窗口隐藏/关闭时也会兜底清一次
  void window.cd.setPreviewItem(null)
})

/** 只有外部真的改了配置才重载草稿 */
watch(
  () => props.item,
  (item) => {
    if (currentSnapshot() === snapshotOf(item)) return
    syncFromItem(item)
    baseline.value = snapshotOf(item)
    // 换了编辑对象：内容可能一字不差，但 id 变了，桌面得换成新那一项
    publishPreview(true)
  }
)

/** 只保留真正有内容的文案字段，空白字段继续跟随全局 */
function cleanText(source: CountdownItem['text']): Partial<CountdownItem['text']> {
  const out: Partial<CountdownItem['text']> = {}
  const keys = ['hint', 'futureText', 'todayText', 'pastText'] as const
  for (const key of keys) {
    const value = String(source[key] ?? '').trim()
    if (value) out[key] = value
  }
  return out
}

/** 去掉空对象/空值，保证「未设置的字段」不会写入配置 */
function compact(source: AppearanceOverride): AppearanceOverride {
  const out: AppearanceOverride = {}
  if (source.fontFamily) out.fontFamily = source.fontFamily
  if (source.background && Object.keys(source.background).length) {
    out.background = { ...source.background }
  }
  for (const key of ['title', 'count', 'hint', 'status'] as const) {
    const style = source[key]
    if (style && Object.keys(style).length) out[key] = { ...style }
  }
  return out
}

/**
 * 本次编辑里是否至少保存过一次。
 *
 * 「保存」按钮现在不再顺手返回列表，于是会出现「新建项 → 保存 → 返回列表」这条路径。
 * 列表那边把「没保存就离开的新建项」当空白项删掉，所以离开时必须把「已经存过了」
 * 这件事告诉它，否则刚保存的项会在返回时被当成空白项删掉。
 */
let everSaved = false

function save(): void {
  const item = computeItem()
  if (!item.name) item.name = t('editor.unnamed')
  everSaved = true
  emit('save', item)
  baseline.value = currentSnapshot()
  savedFlash.value = true
  window.setTimeout(() => {
    savedFlash.value = false
  }, 1400)
  ElMessage.success(t('common.savedOk'))
}

function saveAndBack(): void {
  save()
  emit('close', { saved: true })
}

async function requestClose(): Promise<void> {
  if (!dirty.value) {
    emit('close', { saved: everSaved })
    return
  }
  try {
    await ElMessageBox.confirm(t('common.discarding'), t('common.discardTitle'), {
      confirmButtonText: t('common.saveAndBack'),
      cancelButtonText: t('common.discardChanges'),
      distinguishCancelAndClose: true,
      type: 'warning'
    })
    saveAndBack()
  } catch (action) {
    if (action === 'cancel') emit('close', { saved: everSaved })
  }
}

/* ------------------------------------------------------------------ *
 * 分区标题行不放任何状态回显
 *
 * 分区收起后只剩一个标题：不回显当前值，也不回显「哪些项被覆盖」。
 * 那些摘要每加一条就要多维护一处随草稿变的文案，收起时读一眼也记不住，
 * 反而把「基本信息 / 日期与显示」这些标题的层级冲淡了。要看值就展开。
 * ------------------------------------------------------------------ */

/** 外观覆盖弹窗 */
const appearanceDialog = ref(false)

/** 显示模式的短标签；'' 表示跟随全局 */
function displayModeLabel(value: DisplayMode | ''): string {
  switch (value || props.config.behavior.displayMode) {
    case 'days':
      return t('behavior.days')
    case 'days-hours':
      return t('behavior.daysHours')
    case 'days-hours-minutes':
      return t('behavior.daysHoursMinutes')
    default:
      return t('behavior.precise')
  }
}

const globalModeLabel = computed(() => displayModeLabel(''))

/** 外观覆盖：数一数草稿里真正占了几个顶层字段（展开后那行摘要用） */
const appearanceCount = computed(() => {
  const source = appearance.value
  let count = 0
  if (source.fontFamily) count += 1
  if (source.background && Object.keys(source.background).length) count += 1
  for (const key of ['title', 'count', 'hint', 'status'] as const) {
    const style = source[key]
    if (style && Object.keys(style).length) count += 1
  }
  return count
})

/**
 * 文案覆盖开关。
 *
 * 打开时把全局当前值填进草稿 —— 用户是从「现在卡片上看到的字」开始改，
 * 而不是对着一排空框猜；关闭时清空四个字段，重新跟随全局。
 * 与单位字覆盖开关保持同一套语义。
 */
function toggleTextOverride(value: boolean): void {
  draft.useText = value
  if (value) {
    const resolved = globalText.value
    draft.text = {
      ...draft.text,
      hint: draft.text.hint || resolved.hint.value || '',
      futureText: draft.text.futureText || resolved.futureText.value || '',
      todayText: draft.text.todayText || resolved.todayText.value || '',
      pastText: draft.text.pastText || resolved.pastText.value || ''
    }
    return
  }
  draft.text = { ...draft.text, hint: '', futureText: '', todayText: '', pastText: '' }
}

const dateValue = computed<Date | null>(() => {
  const parsed = new Date(draft.date)
  return Number.isNaN(parsed.getTime()) ? null : parsed
})

const dateType = computed<'date' | 'datetime'>(() =>
  draft.date.includes('T') ? 'datetime' : 'date'
)

function toDateString(value: Date, type: 'date' | 'datetime'): string {
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  if (type === 'datetime') {
    const hh = String(value.getHours()).padStart(2, '0')
    const mm = String(value.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${d}T${hh}:${mm}`
  }
  return `${y}-${m}-${d}`
}

function onDateChange(value: Date | null): void {
  if (!value) return
  draft.date = toDateString(value, dateType.value)
}

function onDateTypeChange(next: 'date' | 'datetime'): void {
  const current = dateValue.value
  if (!current) return
  draft.date = toDateString(current, next)
}

const maxDay = computed(() => new Date(new Date().getFullYear(), draft.month, 0).getDate())

/**
 * 单次模式必须有一个具体日期。
 *
 * 每年重复只存月/日，date 可能一直是空串；切到单次后若留着空日期，
 * 保存出去只能兜底成 1/1。这里用当前月日补上今年那天，用户再改时刻即可。
 */
function seedOnceDate(): void {
  if (draft.mode !== 'once' || draft.date) return
  const year = new Date().getFullYear()
  const month = String(draft.month).padStart(2, '0')
  const day = String(draft.day).padStart(2, '0')
  draft.date = `${year}-${month}-${day}`
}

watch(() => draft.mode, seedOnceDate)

/** placeholder：显示该字段「实际会生效的值」及其来源 */
function followPlaceholder(key: 'hint' | 'futureText' | 'todayText' | 'pastText'): string {
  const resolved = globalText.value[key]
  if (!resolved.value) return t('common.followGlobalEmpty')
  const sourceLabel =
    resolved.source === 'global' ? t('common.followGlobal') : t('common.followGlobalEmpty')
  return `${resolved.value}（${sourceLabel}）`
}

/**
 * 这一项真正会渲染的分段。
 * 用草稿里的精度而不是全局：单位字就排在精度下面，标灰的应该是「刚选中的那个」
 * 模式下不存在的分段，否则改完精度还要回头对一遍全局是什么。
 * 它**只**决定单位字输入框要不要标灰提示，不决定能否编辑：四项永远可编辑。
 */
const activeSlots = computed(() =>
  modeSlots(
    draft.displayMode || props.config.behavior.displayMode,
    props.config.behavior.showDaysInPrecise
  )
)

function setUnit(key: 'day' | 'hour' | 'minute' | 'second', value: string): void {
  draft.units = { ...draft.units, [key]: value.slice(0, 8) }
}

/**
 * 打开「单独覆盖单位字」时，用全局当前值作为起点，
 * 这样用户是从现在看到的样子开始改，而不是从空白开始。
 */
function toggleUnitsOverride(value: boolean): void {
  draft.unitsCustom = value
  if (value) {
    draft.units = { ...draft.units, ...props.config.behavior.units, enabled: true }
    return
  }
  draft.units = { ...draft.units, enabled: false }
}
</script>

<template>
  <!--
    操作栏吸顶：.el-card 自带 overflow: hidden，卡内 position: sticky 不会生效，
    所以把「返回 / 标题 / 状态 / 保存」搬到卡片外面吸顶，滚到下面的外观设置时依然能直接保存。
    预览不画在窗口里 —— 桌面那张卡片会实时渲染这一项，而且不允许被关掉。
  -->
  <!-- 吸顶判定锚点：零高度、不可见，只用来提供「未吸顶时栏体应在的位置」 -->
  <div ref="stickyAnchor" class="editor-anchor" aria-hidden="true"></div>
  <div ref="stickyBar" class="editor-sticky" :class="{ 'is-stuck': stuck }">
    <div class="editor-head">
      <el-button size="small" text @click="requestClose">
        <el-icon><ArrowLeft /></el-icon>
        <span style="margin-left: 4px">{{ t('common.back') }}</span>
      </el-button>
      <span class="editor-head__title">{{ t('editor.editTitle') }}</span>
      <el-tag v-if="dirty" size="small" type="warning" effect="plain">
        {{ t('common.discardTitle') }}
      </el-tag>
      <el-tag v-else-if="savedFlash" size="small" type="success" effect="plain">
        {{ t('common.savedOk') }}
      </el-tag>
      <el-button type="primary" size="small" class="editor-head__save" @click="save">
        <el-icon><Check /></el-icon>
        <span style="margin-left: 6px">{{ t('common.save') }}</span>
      </el-button>
    </div>
  </div>

  <div class="editor-body">
    <div class="editor-form">
      <SettingSection :title="t('editor.basic')" persist-key="editor.basic">
        <FieldRow :label="t('editor.name')" :hint="t('editor.nameHint')">
          <el-input
            v-model="draft.name"
            :placeholder="t('editor.namePlaceholder')"
            maxlength="30"
            show-word-limit
          />
        </FieldRow>
        <FieldRow :label="t('editor.enabled')" :hint="t('editor.enabledHint')">
          <el-switch v-model="draft.enabled" />
        </FieldRow>
        <FieldRow :label="t('editor.notifyOnToday')" :hint="t('editor.notifyOnTodayHint')">
          <el-switch v-model="draft.notifyOnToday" />
        </FieldRow>
      </SettingSection>

      <!--
        日期与显示合成一块：显示格式本来就是「这个日期怎么显示」，
        从前单开一个分区，只有一行控件却占掉一个标题位。
      -->
      <SettingSection
        :title="t('editor.dateAndDisplay')"
        persist-key="editor.target"
      >
        <FieldRow :label="t('target.mode')">
          <el-radio-group v-model="draft.mode">
            <el-radio-button value="annual">{{ t('target.modeAnnual') }}</el-radio-button>
            <el-radio-button value="once">{{ t('target.modeOnce') }}</el-radio-button>
          </el-radio-group>
        </FieldRow>
        <FieldRow v-if="draft.mode === 'annual'" :label="t('target.monthDay')">
          <div class="inline-group">
            <el-select v-model="draft.month" style="width: 108px">
              <el-option v-for="m in 12" :key="m" :label="`${m} ${t('target.month')}`" :value="m" />
            </el-select>
            <el-select v-model="draft.day" style="width: 108px">
              <el-option v-for="d in maxDay" :key="d" :label="`${d} ${t('target.day')}`" :value="d" />
            </el-select>
          </div>
        </FieldRow>
        <FieldRow v-else :label="t('target.date')" :hint="t('target.datetimeHint')">
          <div class="inline-group">
            <el-radio-group
              :model-value="dateType"
              @update:model-value="(v: string | number | boolean | undefined) => onDateTypeChange(v as 'date' | 'datetime')"
            >
              <el-radio-button value="date">{{ t('target.date') }}</el-radio-button>
              <el-radio-button value="datetime">{{ t('target.dateTime') }}</el-radio-button>
            </el-radio-group>
            <el-date-picker
              :model-value="dateValue"
              :type="dateType"
              :format="dateType === 'datetime' ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD'"
              :clearable="false"
              @update:model-value="(v: unknown) => onDateChange(v as Date | null)"
            />
          </div>
        </FieldRow>
        <FieldRow :label="t('behavior.displayMode')" :hint="t('editor.displayModeHint')">
          <el-radio-group v-model="draft.displayMode" class="is-compact">
            <el-radio-button value="">{{ t('editor.followMode', { value: globalModeLabel }) }}</el-radio-button>
            <el-radio-button value="days">{{ t('behavior.days') }}</el-radio-button>
            <el-radio-button value="days-hours">{{ t('behavior.daysHours') }}</el-radio-button>
            <el-radio-button value="days-hours-minutes">{{ t('behavior.daysHoursMinutes') }}</el-radio-button>
            <el-radio-button value="precise">{{ t('behavior.precise') }}</el-radio-button>
          </el-radio-group>
        </FieldRow>

        <!-- 单位字和显示精度是同一件事的两半：精度决定有哪几段，单位字决定每段跟什么字 -->
        <FieldRow :label="t('target.overrideUnits')" :hint="t('target.overrideUnitsHint')">
          <el-switch
            :model-value="draft.unitsCustom"
            @update:model-value="(v: string | number | boolean) => toggleUnitsOverride(Boolean(v))"
          />
        </FieldRow>
        <FieldRow v-if="draft.unitsCustom" stacked>
          <UnitLabelField
            :day="draft.units.day"
            :hour="draft.units.hour"
            :minute="draft.units.minute"
            :second="draft.units.second"
            :day-on="activeSlots.days"
            :hour-on="activeSlots.hours"
            :minute-on="activeSlots.minutes"
            :second-on="activeSlots.seconds"
            @update:day="(v: string) => setUnit('day', v)"
            @update:hour="(v: string) => setUnit('hour', v)"
            @update:minute="(v: string) => setUnit('minute', v)"
            @update:second="(v: string) => setUnit('second', v)"
          />
        </FieldRow>
      </SettingSection>

      <!--
        文案：默认收起。副标题、三行状态文案和两个显示开关都在这里。
        单位字已经搬到「日期与显示」，和决定它是否生效的显示精度放在一起。
      -->
      <SettingSection
        :title="t('editor.textSection')"
        :help="t('editor.textSectionHint')"
        persist-key="editor.text"
      >
        <FieldRow :label="t('editor.textOverride')" :hint="t('editor.textOverrideHint')">
          <el-switch
            :model-value="draft.useText"
            @update:model-value="(v: string | number | boolean) => toggleTextOverride(Boolean(v))"
          />
        </FieldRow>

        <!--
          先决定「显示不显示」，再决定「写什么」。
          反过来的话，用户会先填满一屏输入框，再发现其中一行本来就不显示。
        -->
        <FieldRow :label="t('target.showHint')">
          <el-radio-group v-model="draft.text.showHint">
            <el-radio-button value="inherit">{{ t('target.followGlobal') }}</el-radio-button>
            <el-radio-button value="show">{{ t('target.show') }}</el-radio-button>
            <el-radio-button value="hide">{{ t('target.hide') }}</el-radio-button>
          </el-radio-group>
        </FieldRow>
        <FieldRow :label="t('target.showStatus')">
          <el-radio-group v-model="draft.text.showStatus">
            <el-radio-button value="inherit">{{ t('target.followGlobal') }}</el-radio-button>
            <el-radio-button value="show">{{ t('target.show') }}</el-radio-button>
            <el-radio-button value="hide">{{ t('target.hide') }}</el-radio-button>
          </el-radio-group>
        </FieldRow>

        <template v-if="draft.useText">
          <FieldRow :label="t('target.hintLabel')" :hint="t('target.hintHint')">
            <el-input v-model="draft.text.hint" :placeholder="followPlaceholder('hint')" maxlength="60" />
            <template #note>
              <TextVariables v-model="draft.text.hint" field="hint" />
            </template>
          </FieldRow>

          <!-- 虚线分隔：上面是固定副标题，下面三行是随日期切换的状态文案 -->
          <div class="text-sep" aria-hidden="true"></div>

          <FieldRow :label="t('target.futureText')" :hint="t('target.futureHint')">
            <el-input
              v-model="draft.text.futureText"
              :placeholder="followPlaceholder('futureText')"
              maxlength="40"
            />
            <template #note>
              <TextVariables v-model="draft.text.futureText" field="future" />
            </template>
          </FieldRow>
          <FieldRow :label="t('target.todayText')" :hint="t('target.todayTextHint')">
            <el-input
              v-model="draft.text.todayText"
              :placeholder="followPlaceholder('todayText')"
              maxlength="40"
            />
            <template #note>
              <TextVariables v-model="draft.text.todayText" field="today" />
            </template>
          </FieldRow>
          <!-- 每年重复的项不存在「过期」状态，这一行永远用不上，直接不渲染 -->
          <FieldRow
            v-if="draft.mode !== 'annual'"
            :label="t('target.pastText')"
            :hint="t('target.pastTextHint')"
          >
            <el-input
              v-model="draft.text.pastText"
              :placeholder="followPlaceholder('pastText')"
              maxlength="40"
            />
            <template #note>
              <TextVariables v-model="draft.text.pastText" field="past" />
            </template>
          </FieldRow>
        </template>
      </SettingSection>

      <!--
        外观覆盖：编辑页只留一个开关 + 一行摘要 + 一个入口。
        20 多个控件搬进弹窗 —— 这一块是「偶尔才碰一次」的那一层，
        平铺在这里等于让每个改名字的人都先滚过两屏滑条。
      -->
      <SettingSection
        :title="t('editor.appearanceSection')"
        :help="t('editor.appearanceOverrideHint')"
        :default-open="useAppearance"
        persist-key="editor.appearance"
      >
        <!-- 总开关留在正文里：它控制的是这一块要不要启用，不是这一块里的某一项 -->
        <FieldRow :label="t('editor.appearanceOverride')">
          <el-switch v-model="useAppearance" />
        </FieldRow>

        <div v-if="useAppearance" class="appearance-entry">
          <span class="appearance-entry__text">
            {{
              appearanceCount
                ? t('editor.appearanceCovered', { count: appearanceCount })
                : t('editor.appearanceEmpty')
            }}
          </span>
          <el-button size="small" plain type="primary" @click="appearanceDialog = true">
            <el-icon><Setting /></el-icon>
            <span style="margin-left: 6px">{{ t('editor.appearanceAdjust') }}</span>
          </el-button>
        </div>
      </SettingSection>
    </div>
  </div>

  <ItemAppearanceDialog
    v-model:visible="appearanceDialog"
    v-model:appearance="appearance"
    :config="config"
    :item="previewItem"
  />
</template>

<style scoped>
/*
 * 吸顶操作栏。
 *
 * 关键点：sticky 的定位基准是滚动容器的 **padding box**，而 .settings-content 有
 * 18px 的 padding-top —— 也就是说 `top: 0` 时栏体其实停在滚动视口顶端下方 18px 处，
 * 上方那条缝会让下面的内容（首屏时是预览卡片的下边框）露出来。
 * 所以这里直接把栏体上提一个 padding-top 的高度，让它真正贴住滚动视口顶端。
 *
 * 以前是靠一个 ::before 假元素去盖住那条缝，但那个假元素自身也会被当成滚动内容
 * 推到容器外面，结果就是标题栏上方多出一块遮住边框的色块 —— 换成负偏移后不再需要它。
 */
.editor-sticky {
  position: sticky;
  /* 与 .settings-content 的 padding-top 保持一致；它变了这里也要跟着变 */
  top: -18px;
  z-index: 5;
  margin-bottom: 16px;
  padding: 10px 16px 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--cd-radius, 12px);
  background: var(--el-bg-color);
}

/*
 * 吸顶后：只去掉**上方**的圆角与**上边**的边框，左右下三边与下方两个圆角原样保留。
 *
 * 吸顶时栏体贴住滚动视口顶端，顶上那道 1px 边框与两个圆角会变成「贴边又带一道横线」的怪样子；
 * 去掉之后它就是一条贴顶、左右有竖边、下方仍收口的栏。离顶后 class 摘掉，全部原样恢复。
 *
 * 用 border-top-color: transparent 而不是 border-top: none —— 边框盒尺寸保持不变，
 * 切换时不会因为少了 1px 边框让下面的内容上下跳一下。
 */
.editor-sticky.is-stuck {
  border-top-color: transparent;
  border-radius: 0 0 var(--cd-radius, 12px) var(--cd-radius, 12px);
}

/*
 * 吸顶判定锚点：必须留在普通流里（不能用 display: none，那样量不到位置），
 * 高度为 0，不占版面、不接收事件。
 */
.editor-anchor {
  flex: none;
  height: 0;
  margin: 0;
  pointer-events: none;
}

/* 表单单列：预览交给桌面卡片本身，窗口里不再留预览栏 */
.editor-body {
  display: block;
}

/* 分区之间的间距由 SettingSection 自带，这里不再加 gap */
.editor-form {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* 外观覆盖的入口行：左边是已覆盖摘要，右边是进弹窗的按钮 */
.appearance-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0 2px;
}

.appearance-entry__text {
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}



.editor-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
}

/* 保存按钮推到最右，与原来的卡片头布局保持一致 */
.editor-head__save {
  margin-left: auto;
}

.editor-head__title {
  font-weight: 600;
}

.inline-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* 副标题与状态文案之间的虚线：两组性质不同，但不需要一行小标题 */
.text-sep {
  margin: 10px 0 2px;
  border-top: 1px dashed var(--el-border-color-light);
}
</style>
