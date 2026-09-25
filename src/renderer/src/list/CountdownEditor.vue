<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
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
  mergeAppearance,
  resolveTarget,
  resolveText
} from '@shared/defaults'
import { fontLabel } from '@/utils/style'
import FieldRow from '@/components/FieldRow.vue'
import ColorField from '@/components/ColorField.vue'
import TextStyleEditor from '@/components/TextStyleEditor.vue'
import SliderField from '@/components/SliderField.vue'
import CountdownPreview from '@/components/CountdownPreview.vue'

const props = defineProps<{ config: AppConfig; item: CountdownItem }>()
const emit = defineEmits<{
  (event: 'save', item: CountdownItem): void
  (event: 'close'): void
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
  text: createCountdownItem().text
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
    ['hint', 'futureText', 'todayText', 'pastText', 'unit'] as const
  ).some((key) => String(draft.text[key] ?? '').trim().length > 0)

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
    appearance: useAppearance.value ? compact(appearance.value) : {}
  }
}

/** 空白字段不写进配置，保持「留空即跟随全局」 */
function visibilityPatch(): Pick<CountdownItem['text'], 'showHint' | 'showStatus'> {
  return { showHint: draft.text.showHint, showStatus: draft.text.showStatus }
}

function currentSnapshot(): string {
  return snapshotOf(computeItem())
}

const dirty = computed(() => currentSnapshot() !== baseline.value)

/** 只有外部真的改了配置才重载草稿 */
watch(
  () => props.item,
  (item) => {
    if (currentSnapshot() === snapshotOf(item)) return
    syncFromItem(item)
    baseline.value = snapshotOf(item)
  }
)

function cleanText(source: CountdownItem['text']): Partial<CountdownItem['text']> {
  const out: Partial<CountdownItem['text']> = {}
  for (const [key, value] of Object.entries(source)) {
    if (String(value ?? '').trim()) (out as Record<string, string>)[key] = String(value)
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
  emit('close')
}

async function requestClose(): Promise<void> {
  if (!dirty.value) {
    emit('close')
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
    if (action === 'cancel') emit('close')
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

function patchStyle(key: 'title' | 'count' | 'hint' | 'status', value: TextStyle): void {
  appearance.value = { ...appearance.value, [key]: value }
}

type StyleKey = 'title' | 'count' | 'hint' | 'status'
type OverrideKey = 'fontFamily' | 'background' | StyleKey

/** 勾选/取消某个外观覆盖项：勾选时以当前全局值作为起点，取消时直接删掉 */
function setOverride(key: OverrideKey, enabled: boolean): void {
  const next: AppearanceOverride = { ...appearance.value }
  if (!enabled) {
    delete next[key]
  } else if (key === 'fontFamily') {
    next.fontFamily = props.config.appearance.fontFamily
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

/** 预览用配置：把当前草稿当作唯一列表项 */
const previewConfig = computed<AppConfig>(() => {
  const built = computeItem()
  return {
    ...props.config,
    countdowns: [built],
    activeId: built.id,
    appearance: mergeAppearance(props.config.appearance, built.appearance)
  }
})

const fontOptions = [
  '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
  '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif',
  '"Segoe UI", system-ui, sans-serif',
  '"Cascadia Mono", Consolas, monospace',
  '"KaiTi", "STKaiti", serif',
  '"SimSun", "Songti SC", serif',
  'system-ui, sans-serif'
]

const backgroundFields = computed(() => appearance.value.background ?? {})

/** placeholder：显示该字段「实际会生效的值」及其来源 */
function followPlaceholder(key: 'hint' | 'futureText' | 'todayText' | 'pastText' | 'unit'): string {
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
</script>

<template>
  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <div class="editor-head">
          <el-button size="small" text @click="requestClose">
            <el-icon><ArrowLeft /></el-icon>
            <span style="margin-left: 4px">{{ t('common.back') }}</span>
          </el-button>
          <span class="editor-head__title">{{ t('editor.editTitle') }}</span>
          <el-tag v-if="appearanceActive" size="small" type="danger" effect="plain">
            {{ t('editor.appearanceActive') }}
          </el-tag>
          <el-tag v-if="dirty" size="small" type="warning" effect="plain">
            {{ t('common.discardTitle') }}
          </el-tag>
          <el-tag v-else-if="savedFlash" size="small" type="success" effect="plain">
            {{ t('common.savedOk') }}
          </el-tag>
        </div>
        <el-button type="primary" size="small" @click="saveAndBack">
          <el-icon><Check /></el-icon>
          <span style="margin-left: 6px">{{ t('common.save') }}</span>
        </el-button>
      </div>
    </template>

    <div class="editor-preview">
      <CountdownPreview :config="previewConfig" />
    </div>

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
    <FieldRow :label="t('target.unit')">
      <el-input
        v-model="draft.text.unit"
        :placeholder="followPlaceholder('unit')"
        style="max-width: 200px"
        maxlength="6"
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
      <FieldRow :label="t('appearance.fontFamily')">
        <div class="override-row">
          <el-checkbox
            :model-value="Boolean(appearance.fontFamily)"
            @update:model-value="(v: string | number | boolean) => setOverride('fontFamily', Boolean(v))"
          />
          <el-select
            v-if="appearance.fontFamily"
            :model-value="appearance.fontFamily"
            filterable
            allow-create
            default-first-option
            style="flex: 1; min-width: 200px"
            @update:model-value="(v: string) => (appearance.fontFamily = v)"
          >
            <el-option v-for="font in fontOptions" :key="font" :label="fontLabel(font)" :value="font" />
          </el-select>
          <span v-else class="override-row__empty">{{ t('common.followGlobal') }}</span>
        </div>
      </FieldRow>

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

      <FieldRow v-if="appearance.background" :label="`${t('appearance.radius')} / ${t('appearance.padding')}`">
        <div class="inline-group">
          <SliderField
            :model-value="backgroundFields.radius ?? config.appearance.background.radius"
            :min="0"
            :max="60"
            unit="px"
            @update:model-value="(v: number) => patchBackground({ radius: v })"
          />
          <SliderField
            :model-value="backgroundFields.padding ?? config.appearance.background.padding"
            :min="0"
            :max="64"
            unit="px"
            @update:model-value="(v: number) => patchBackground({ padding: v })"
          />
        </div>
      </FieldRow>

      <FieldRow v-if="appearance.background" :label="t('appearance.borderWidth')">
        <SliderField
          :model-value="backgroundFields.borderWidth ?? config.appearance.background.borderWidth"
          :min="0"
          :max="8"
          :step="0.5"
          unit="px"
          @update:model-value="(v: number) => patchBackground({ borderWidth: v })"
        />
      </FieldRow>

      <FieldRow v-if="appearance.background" :label="t('appearance.borderColor')">
        <ColorField
          :model-value="backgroundFields.borderColor ?? config.appearance.background.borderColor"
          @update:model-value="(v: string) => patchBackground({ borderColor: v })"
        />
      </FieldRow>

      <FieldRow v-if="appearance.background" :label="t('appearance.shadowStrength')">
        <SliderField
          :model-value="backgroundFields.shadow ?? config.appearance.background.shadow"
          :min="0"
          :max="100"
          @update:model-value="(v: number) => patchBackground({ shadow: v })"
        />
      </FieldRow>

      <FieldRow v-if="appearance.background" :label="t('appearance.shadowColor')">
        <ColorField
          :model-value="backgroundFields.shadowColor ?? config.appearance.background.shadowColor"
          @update:model-value="(v: string) => patchBackground({ shadowColor: v })"
        />
      </FieldRow>

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
          :sample="entry.sample"
          :model-value="appearance[entry.key] as TextStyle"
          @update:model-value="(v: TextStyle) => patchStyle(entry.key, v)"
        />
      </div>
    </template>
  </el-card>
</template>

<style scoped>
.editor-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
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

.editor-preview {
  margin-bottom: 6px;
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
