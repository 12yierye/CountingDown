<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import type {
  AppConfig,
  AppearanceOverride,
  BackgroundConfig,
  CountdownItem,
  DateMode,
  TextStyle
} from '@shared/types'
import {
  createCountdownItem,
  isTargetBlank,
  resolveTarget,
  resolveText
} from '@shared/defaults'
import { toPlain } from '@/composables/useConfig'
import { FONT_STACKS } from '@/utils/style'
import { modeSlots } from '@/utils/preview'
import FieldRow from '@/components/FieldRow.vue'
import ColorField from '@/components/ColorField.vue'
import UnitLabelField from '@/components/UnitLabelField.vue'
import TextStyleEditor from '@/components/TextStyleEditor.vue'
import SliderField from '@/components/SliderField.vue'

const props = defineProps<{ config: AppConfig; item: CountdownItem }>()
const emit = defineEmits<{
  (event: 'save', item: CountdownItem): void
  (event: 'close', payload: { saved: boolean }): void
}>()

const { t } = useI18n()

/**
 * 全局解析结果：留空字段的显示值与初值都来自这里。
 * 注意：不能在 setup 阶段就用它初始化草稿 —— 那时 store 里还是默认配置，
 * 而 computed 之后才更新，reactive 草稿不会跟着变（这曾导致目标日期永远是 1/1）。
 */
const globalTarget = computed(() => resolveTarget(null, props.config.target))
const globalText = computed(() => resolveText(undefined, props.config.text))

/** 单项日期留空时用于展示/编辑的取值：单项 -> 全局 -> 内置默认 */

interface Draft {
  name: string
  enabled: boolean
  mode: DateMode
  date: string
  month: number
  day: number
  targetCustom: boolean
  /** 用户是否动过日期控件；没动过就不写入 target，保持「留空跟随全局」 */
  dateTouched: boolean
  useText: boolean
  text: CountdownItem['text']
  /** 是否单独覆盖四个单位字 */
  unitsCustom: boolean
  units: CountdownItem['units']
}

const draft = reactive<Draft>({
  name: '',
  enabled: true,
  mode: 'annual',
  date: '',
  month: 1,
  day: 1,
  targetCustom: false,
  dateTouched: false,
  useText: false,
  text: createCountdownItem().text,
  unitsCustom: false,
  units: createCountdownItem().units
})

const appearance = ref<AppearanceOverride>({})
const useAppearance = ref(false)

/** 同步期间不要把手动标记当成用户编辑 */
let syncing = false

/** 把 props.item 的当前值同步进草稿（初始化与外部改动都用这一条路径） */
function syncFromItem(item: CountdownItem): void {
  syncing = true
  draft.name = item.name
  draft.enabled = item.enabled
  // 单项日期为空时，展示「实际上生效的值」（全局或内置默认），编辑后即写入单项
  const effective = resolveTarget(item.target, props.config.target) ?? props.config.target
  draft.targetCustom = !isTargetBlank(item.target)
  draft.dateTouched = Boolean(item.target) && !isTargetBlank(item.target)
  draft.mode = effective.mode
  draft.date = effective.date
  draft.month = effective.month
  draft.day = effective.day

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
  queueMicrotask(() => {
    syncing = false
  })
}

syncFromItem(props.item)

/** 用户改动日期控件：标记为「已自定义」，保存时会写入具体日期 */
watch(
  () => [draft.mode, draft.date, draft.month, draft.day] as const,
  () => {
    if (syncing) return
    draft.dateTouched = true
    draft.targetCustom = true
  }
)

/** 已保存状态的快照字符串，用来判断是否有未保存修改 */
function snapshotOf(item: CountdownItem): string {
  return JSON.stringify({
    name: item.name,
    enabled: item.enabled,
    targetBlank: isTargetBlank(item.target),
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
    // 没动过日期就保持原样（留空即继续跟随全局），动过才写入具体日期
    target: draft.dateTouched
      ? { mode: draft.mode, date: draft.date, month: draft.month, day: draft.day }
      : props.item.target,
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

/** 正在编辑的就是桌面显示项：此时才需要提示「桌面卡片实时预览」 */
const liveOnDesktop = computed(
  () => Boolean(props.item.id) && props.item.id === props.config.activeId
)

/* ------------------------------------------------------------------ *
 * 桌面实时预览：把草稿发给主进程（纯内存，不落盘），由主进程决定是否套给组件
 * 窗口 —— 只有「编辑项 == 当前显示项」时才会套。离开编辑页即清空覆盖层，
 * 桌面卡片于是回到编辑前的样子。
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
  if (typeof source.textAlpha === 'number' && Number.isFinite(source.textAlpha)) {
    out.textAlpha = source.textAlpha
  }
  if (source.background && Object.keys(source.background).length) {
    out.background = { ...source.background }
  }
  for (const key of ['title', 'count', 'hint', 'status'] as const) {
    const style = source[key]
    if (style && Object.keys(style).length) out[key] = { ...style }
  }
  return out
}

function save(): void {
  const item = computeItem()
  if (!item.name) item.name = t('editor.unnamed')
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
    emit('close', { saved: false })
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
    if (action === 'cancel') emit('close', { saved: false })
  }
}

/** 清空单项日期，恢复为跟随全局 */
function resetTargetToGlobal(): void {
  syncing = true
  draft.targetCustom = false
  draft.dateTouched = false
  const resolved = globalTarget.value
  draft.mode = resolved.mode
  draft.date = resolved.date
  draft.month = resolved.month
  draft.day = resolved.day
  queueMicrotask(() => {
    syncing = false
  })
}

function patchBackground(patch: Partial<BackgroundConfig>): void {
  appearance.value = {
    ...appearance.value,
    background: { ...(appearance.value.background ?? {}), ...patch }
  }
}

function patchTextAlpha(value: number): void {
  appearance.value = { ...appearance.value, textAlpha: value }
}

function patchStyle(key: 'title' | 'count' | 'hint' | 'status', value: TextStyle): void {
  appearance.value = { ...appearance.value, [key]: value }
}

type StyleKey = 'title' | 'count' | 'hint' | 'status'
type OverrideKey = 'fontFamily' | 'textAlpha' | 'background' | StyleKey

/** 勾选/取消某个外观覆盖项：勾选时以当前全局值作为起点，取消时直接删掉 */
function setOverride(key: OverrideKey, enabled: boolean): void {
  const next: AppearanceOverride = { ...appearance.value }
  if (!enabled) {
    delete next[key]
  } else if (key === 'fontFamily') {
    next.fontFamily = props.config.appearance.fontFamily
  } else if (key === 'textAlpha') {
    next.textAlpha = props.config.appearance.textAlpha ?? 1
  } else if (key === 'background') {
    next.background = { ...props.config.appearance.background }
  } else {
    next[key] = { ...props.config.appearance[key] }
  }
  appearance.value = next
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
  draft.targetCustom = true
  draft.date = toDateString(value, dateType.value)
}

function onDateTypeChange(next: 'date' | 'datetime'): void {
  const current = dateValue.value
  draft.targetCustom = true
  if (!current) {
    draft.date = globalTarget.value.date
    return
  }
  draft.date = toDateString(current, next)
}

const maxDay = computed(() => new Date(new Date().getFullYear(), draft.month, 0).getDate())

/** 与全局外观面板共用同一份字体栈预设 */
const fontOptions = FONT_STACKS

const backgroundFields = computed(() => appearance.value.background ?? {})

/** placeholder：显示该字段「实际会生效的值」及其来源 */
function followPlaceholder(key: 'hint' | 'futureText' | 'todayText' | 'pastText'): string {
  const resolved = globalText.value[key]
  if (!resolved.value) return t('common.followGlobalEmpty')
  const sourceLabel =
    resolved.source === 'global' ? t('common.followGlobal') : t('common.followGlobalEmpty')
  return `${resolved.value}（${sourceLabel}）`
}

const targetFollowNote = computed(() => {
  const resolved = globalTarget.value
  if (resolved.mode === 'annual') {
    return `${resolved.month} / ${resolved.day}`
  }
  return resolved.date || t('list.noDate')
})

const appearanceActive = computed(() => Object.keys(props.item.appearance ?? {}).length > 0)

/**
 * 全局显示模式下真正渲染的分段。
 * 它**只**决定编辑页里单位字输入框要不要标灰提示，不决定能否编辑：四项永远可编辑。
 */
const globalSlots = computed(() =>
  modeSlots(props.config.behavior.displayMode, props.config.behavior.showDaysInPrecise)
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
    这里不再放实时预览 —— 全局设置页已经有一份统一的预览样板，
    而编辑页滚动时预览会一直占着屏幕上方，反而挡住了要改的字段。
  -->
  <div class="editor-sticky">
    <div class="editor-head">
      <el-button size="small" text @click="requestClose">
        <el-icon><ArrowLeft /></el-icon>
        <span style="margin-left: 4px">{{ t('common.back') }}</span>
      </el-button>
      <span class="editor-head__title">{{ t('editor.editTitle') }}</span>
      <el-tag v-if="liveOnDesktop" size="small" type="primary" effect="plain">
        {{ t('editor.liveOnDesktop') }}
      </el-tag>
      <el-tag v-if="appearanceActive" size="small" type="danger" effect="plain">
        {{ t('editor.appearanceActive') }}
      </el-tag>
      <el-tag v-if="dirty" size="small" type="warning" effect="plain">
        {{ t('common.discardTitle') }}
      </el-tag>
      <el-tag v-else-if="savedFlash" size="small" type="success" effect="plain">
        {{ t('common.savedOk') }}
      </el-tag>
      <el-button type="primary" size="small" class="editor-head__save" @click="saveAndBack">
        <el-icon><Check /></el-icon>
        <span style="margin-left: 6px">{{ t('common.save') }}</span>
      </el-button>
    </div>
  </div>

  <el-card shadow="never" class="panel-card">
    <el-divider content-position="left">{{ t('editor.basic') }}</el-divider>
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

    <el-divider content-position="left">
      <span class="divider-title">
        {{ t('editor.targetSection') }}
        <el-tooltip
          :content="`${t('common.followWith', { value: targetFollowNote })}；${t('common.followGlobalHint')}`"
          placement="top"
          :show-after="150"
        >
          <span class="panel-card__help" tabindex="0">
            <el-icon :size="13"><QuestionFilled /></el-icon>
          </span>
        </el-tooltip>
      </span>
    </el-divider>
    <FieldRow :label="t('target.mode')">
      <div class="inline-group">
        <el-radio-group v-model="draft.mode">
          <el-radio-button value="annual">{{ t('target.modeAnnual') }}</el-radio-button>
          <el-radio-button value="once">{{ t('target.modeOnce') }}</el-radio-button>
        </el-radio-group>
        <el-button
          v-if="draft.targetCustom"
          link
          type="primary"
          size="small"
          @click="resetTargetToGlobal"
        >
          {{ t('common.followGlobal') }}
        </el-button>
      </div>
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

    <el-divider content-position="left">
      <span class="divider-title">
        {{ t('editor.textSection') }}
        <el-tooltip :content="t('common.followGlobalHint')" placement="top" :show-after="150">
          <span class="panel-card__help" tabindex="0">
            <el-icon :size="13"><QuestionFilled /></el-icon>
          </span>
        </el-tooltip>
      </span>
    </el-divider>
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
    <FieldRow :label="t('target.hintText')">
      <el-input v-model="draft.text.hint" :placeholder="followPlaceholder('hint')" maxlength="60" />
    </FieldRow>
    <FieldRow :label="t('target.futureText')" :hint="t('target.statusHint')">
      <el-input
        v-model="draft.text.futureText"
        :placeholder="followPlaceholder('futureText')"
        maxlength="40"
      />
    </FieldRow>
    <FieldRow :label="t('target.todayText')">
      <el-input
        v-model="draft.text.todayText"
        :placeholder="followPlaceholder('todayText')"
        maxlength="40"
      />
    </FieldRow>
    <FieldRow :label="t('target.pastText')">
      <el-input
        v-model="draft.text.pastText"
        :placeholder="followPlaceholder('pastText')"
        maxlength="40"
      />
    </FieldRow>

    <!-- 单位字：默认跟随全局，开启后这一项可以把天/时/分/秒换成别的字 -->
    <el-divider content-position="left">
      <span class="divider-title">
        {{ t('behavior.unitsTitle') }}
        <el-tooltip
          :content="`${t('behavior.unitsHint')}；${t('target.overrideUnitsHint')}`"
          placement="top"
          :show-after="150"
        >
          <span class="panel-card__help" tabindex="0">
            <el-icon :size="13"><QuestionFilled /></el-icon>
          </span>
        </el-tooltip>
      </span>
    </el-divider>
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
        :day-on="globalSlots.days"
        :hour-on="globalSlots.hours"
        :minute-on="globalSlots.minutes"
        :second-on="globalSlots.seconds"
        @update:day="(v: string) => setUnit('day', v)"
        @update:hour="(v: string) => setUnit('hour', v)"
        @update:minute="(v: string) => setUnit('minute', v)"
        @update:second="(v: string) => setUnit('second', v)"
      />
    </FieldRow>

    <el-divider content-position="left">
      <span class="divider-title">
        {{ t('editor.appearanceSection') }}
        <el-tooltip :content="t('appearance.overrideTip')" placement="top" :show-after="150">
          <span class="panel-card__help" tabindex="0">
            <el-icon :size="13"><QuestionFilled /></el-icon>
          </span>
        </el-tooltip>
      </span>
    </el-divider>

    <FieldRow :label="t('editor.appearanceOverride')">
      <el-switch v-model="useAppearance" />
    </FieldRow>

    <template v-if="useAppearance">
      <div class="override-group">
        <div class="override-group__title">{{ t('appearance.font') }}</div>
        <FieldRow :label="t('appearance.fontFamily')">
          <div class="override-row">
            <el-checkbox
              :model-value="Boolean(appearance.fontFamily)"
              @update:model-value="(v: string | number | boolean) => setOverride('fontFamily', Boolean(v))"
            />
            <el-select
              v-if="appearance.fontFamily"
              :model-value="appearance.fontFamily"
              class="font-select"
              popper-class="cd-font-select"
              filterable
              allow-create
              default-first-option
              style="flex: 1; min-width: 200px"
              @update:model-value="(v: string) => (appearance.fontFamily = v)"
            >
              <el-option v-for="font in fontOptions" :key="font" :label="font" :value="font" />
            </el-select>
            <span v-else class="override-row__empty">{{ t('common.followGlobal') }}</span>
          </div>
        </FieldRow>
      </div>

      <div class="override-group">
        <div class="override-group__title">{{ t('appearance.background') }}</div>
        <FieldRow :label="t('appearance.bgColor')">
          <div class="override-row">
            <el-checkbox
              :model-value="Boolean(appearance.background)"
              @update:model-value="(v: string | number | boolean) => setOverride('background', Boolean(v))"
            />
            <ColorField
              v-if="appearance.background"
              :model-value="backgroundFields.color ?? config.appearance.background.color"
              :alpha="backgroundFields.alpha ?? config.appearance.background.alpha"
              show-alpha
              @update:model-value="(v: string) => patchBackground({ color: v })"
              @update:alpha="(v: number) => patchBackground({ alpha: v })"
            />
            <span v-else class="override-row__empty">{{ t('common.followGlobal') }}</span>
          </div>
        </FieldRow>

        <!-- 圆角与内边距是两个独立设置项，不再挤在同一行用一个斜杠隔开 -->
        <FieldRow v-if="appearance.background" :label="t('appearance.radius')">
          <SliderField
            :model-value="backgroundFields.radius ?? config.appearance.background.radius"
            :min="0"
            :max="60"
            unit="px"
            @update:model-value="(v: number) => patchBackground({ radius: v })"
          />
        </FieldRow>
        <FieldRow v-if="appearance.background" :label="t('appearance.padding')">
          <SliderField
            :model-value="backgroundFields.padding ?? config.appearance.background.padding"
            :min="0"
            :max="64"
            unit="px"
            @update:model-value="(v: number) => patchBackground({ padding: v })"
          />
        </FieldRow>
      </div>

      <div class="override-group">
        <div class="override-group__title">
          {{ t('appearance.border') }} / {{ t('appearance.shadow') }}
        </div>
        <p v-if="!appearance.background" class="override-group__empty">
          {{ t('appearance.overrideNeedBackground') }}
        </p>
        <template v-else>
          <FieldRow :label="t('appearance.borderWidth')">
            <SliderField
              :model-value="backgroundFields.borderWidth ?? config.appearance.background.borderWidth"
              :min="0"
              :max="8"
              :step="0.5"
              unit="px"
              @update:model-value="(v: number) => patchBackground({ borderWidth: v })"
            />
          </FieldRow>

          <FieldRow :label="t('appearance.borderColor')">
            <ColorField
              :model-value="backgroundFields.borderColor ?? config.appearance.background.borderColor"
              @update:model-value="(v: string) => patchBackground({ borderColor: v })"
            />
          </FieldRow>

          <FieldRow :label="t('appearance.shadowStrength')">
            <SliderField
              :model-value="backgroundFields.shadow ?? config.appearance.background.shadow"
              :min="0"
              :max="100"
              @update:model-value="(v: number) => patchBackground({ shadow: v })"
            />
          </FieldRow>

          <FieldRow :label="t('appearance.shadowColor')">
            <ColorField
              :model-value="backgroundFields.shadowColor ?? config.appearance.background.shadowColor"
              @update:model-value="(v: string) => patchBackground({ shadowColor: v })"
            />
          </FieldRow>
        </template>
      </div>

      <div class="override-group">
        <div class="override-group__title">{{ t('appearance.textGroup') }}</div>

        <!--
          文字透明度总开关：与背景透明度无关，只影响四行文字。
          勾选后下面每个文字样式还能再调各自的透明度，两者相乘。
        -->
        <FieldRow :label="t('appearance.textAlpha')" :hint="t('appearance.textAlphaHint')">
          <div class="override-row">
            <el-checkbox
              :model-value="typeof appearance.textAlpha === 'number'"
              @update:model-value="(v: string | number | boolean) => setOverride('textAlpha', Boolean(v))"
            />
            <SliderField
              v-if="typeof appearance.textAlpha === 'number'"
              :model-value="appearance.textAlpha"
              :min="0"
              :max="1"
              :step="0.01"
              @update:model-value="patchTextAlpha"
            />
            <span v-else class="override-row__empty">{{ t('common.followGlobal') }}</span>
          </div>
        </FieldRow>

        <!--
          每个文字样式：容器标题已经写在复选框上，勾选后展开的编辑器里不再重复一次标题
          （重复标题只会白占高度、增加阅读负担）。
        -->
        <div
          v-for="entry in ([
            { key: 'title', label: t('appearance.titleStyle'), sample: draft.name || '元旦' },
            { key: 'count', label: t('appearance.countStyle'), sample: '128 天' },
            { key: 'hint', label: t('appearance.hintStyle'), sample: '2026 年 1 月 1 日 · 周四' },
            { key: 'status', label: t('appearance.statusStyle'), sample: '还有 128 天' }
          ] as const)"
          :key="entry.key"
          class="editor-style"
        >
          <div class="editor-style__head">
            <el-checkbox
              :model-value="Boolean(appearance[entry.key])"
              @update:model-value="(v: string | number | boolean) => setOverride(entry.key, Boolean(v))"
            >
              {{ entry.label }}
            </el-checkbox>
          </div>
          <TextStyleEditor
            v-if="appearance[entry.key]"
            :title="entry.label"
            :show-title="false"
            :sample="entry.sample"
            :model-value="appearance[entry.key] as TextStyle"
            @update:model-value="(v: TextStyle) => patchStyle(entry.key, v)"
          />
        </div>
      </div>
    </template>
  </el-card>
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

/* 分区标题右侧的「?」：补充说明收进 tooltip，不再另起一行 */
.divider-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.editor-head__title {
  font-weight: 600;
}

.editor-style {
  margin-bottom: 10px;
}

.editor-style__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

/* 复选框在左侧，勾选后才显示具体控件 */
.override-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  width: 100%;
}

.override-row__empty {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.inline-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
</style>
