<script setup lang="ts">
/**
 * 预设主题页。
 *
 * 这一版把「潦草」的三处收掉了：
 *   1. 缩略图不再手搓假卡片，直接用真正的 CountdownPreview（静止模式），
 *      所以背景透明度、边框、阴影、字体、单位字、状态文案全都和桌面一致；
 *      也顺手干掉了硬编码的「128 / 5 月 20 日」。
 *   2. 当前外观与某套预设完全一致时打「使用中」，套用后立刻有反馈。
 *   3. 每张卡片只留「套用 / 查看参数 / 更多」，重命名、用当前外观更新、复制、删除都收进「更多」。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { AppConfig, AppearanceConfig, CountdownItem, CustomPreset } from '@shared/types'
import { THEME_PRESETS, mergeAppearance } from '@shared/defaults'
import CountdownPreview from '@/components/CountdownPreview.vue'
import PresetDetailDialog from '@/components/PresetDetailDialog.vue'
import PresetTuneDialog from '@/components/PresetTuneDialog.vue'

const props = defineProps<{
  appearance: AppConfig['appearance']
  customPresets: CustomPreset[]
  countdowns: CountdownItem[]
  /** 缩略图与「手动调整」模态框都需要完整配置上下文 */
  config: AppConfig
}>()

/**
 * 保存预设的来源，与保存弹窗里三选一的取值一一对应。
 * 之前是 target + tune 两个字段，但「手动调整」和「当前全局外观」都会发 target='global'，
 * 接收端分不出来（只有一个布尔量能区分），所以换成显式枚举。
 */
export type PresetSaveMode = 'global' | 'item' | 'manual'

const emit = defineEmits<{
  (event: 'apply', appearance: AppConfig['appearance'], id: string, name: string): void
  (event: 'remove', id: string): void
  (event: 'rename', id: string, name: string): void
  (event: 'overwrite', id: string, appearance: AppConfig['appearance']): void
  /** 保存预设：name = 名称，saveMode = 来源；manual 时 appearance 来自模态框里的草稿 */
  (
    event: 'save',
    payload: {
      name: string
      appearance: AppConfig['appearance']
      saveMode: PresetSaveMode
      itemId: string
      /** 保存后是否立刻把这份外观套到全局（默认否） */
      applyAfter?: boolean
    }
  ): void
}>()

const { t, locale } = useI18n()

interface PresetEntry {
  key: string
  id: string
  name: string
  appearance: AppearanceConfig
  custom: boolean
}

function builtinName(nameZh: string, nameEn: string): string {
  return locale.value === 'en-US' ? nameEn : nameZh
}

const presetList = computed<PresetEntry[]>(() => [
  ...(props.customPresets ?? []).map((preset) => ({
    key: `c:${preset.id}`,
    id: preset.id,
    name: preset.name,
    appearance: preset.appearance,
    custom: true
  })),
  ...THEME_PRESETS.map((preset) => ({
    key: `b:${preset.id}`,
    id: preset.id,
    name: builtinName(preset.nameZh, preset.nameEn),
    appearance: preset.appearance,
    custom: false
  }))
])

const customEntries = computed(() => presetList.value.filter((entry) => entry.custom))
const builtinEntries = computed(() => presetList.value.filter((entry) => !entry.custom))

/**
 * 缩略图配置：只替换 appearance，文案 / 显示模式 / 语言沿用真实配置。
 * 用 computed 建表而不是每次渲染都新建对象 —— 否则父组件任何一次重渲染都会让
 * 十几个预览全部重算一遍。
 */
const previewConfigs = computed(() => {
  const map = new Map<string, AppConfig>()
  for (const entry of presetList.value) {
    map.set(entry.key, { ...props.config, appearance: entry.appearance })
  }
  return map
})

function previewConfigOf(entry: PresetEntry): AppConfig {
  return previewConfigs.value.get(entry.key) ?? { ...props.config, appearance: entry.appearance }
}

/** 缩略图缩放：以「大数字不超过 44px」为准，同时不超过 0.52，避免超大字号撑破画布 */
function thumbScale(appearance: AppearanceConfig): number {
  const size = Math.max(20, appearance.count.fontSize)
  return Math.min(0.52, 44 / size)
}

/* ------------------------------- 当前使用中 ------------------------------- */

function sameStyle(a: AppearanceConfig['title'], b: AppearanceConfig['title']): boolean {
  return (
    a.fontSize === b.fontSize &&
    a.color === b.color &&
    a.weight === b.weight &&
    a.letterSpacing === b.letterSpacing &&
    a.opacity === b.opacity
  )
}

function sameBackground(
  a: AppearanceConfig['background'],
  b: AppearanceConfig['background']
): boolean {
  return (
    a.color === b.color &&
    a.alpha === b.alpha &&
    a.radius === b.radius &&
    a.padding === b.padding &&
    a.shadow === b.shadow &&
    a.shadowColor === b.shadowColor &&
    a.borderWidth === b.borderWidth &&
    a.borderColor === b.borderColor &&
    a.width === b.width
  )
}

function sameAppearance(a: AppearanceConfig, b: AppearanceConfig): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.textAlpha === b.textAlpha &&
    sameBackground(a.background, b.background) &&
    sameStyle(a.title, b.title) &&
    sameStyle(a.count, b.count) &&
    sameStyle(a.hint, b.hint) &&
    sameStyle(a.status, b.status)
  )
}

function isActive(entry: PresetEntry): boolean {
  return sameAppearance(props.appearance, entry.appearance)
}

/* ------------------------------------------------------------------ *
 * 保存预设
 *   global / item：弹窗收「名称 + 来源」，确定即保存
 *   manual：弹窗只收来源，确定后进外观模态框，在模态框里点保存才落盘
 * ------------------------------------------------------------------ */

const saveOpen = ref(false)
const saveName = ref('')
const saveMode = ref<PresetSaveMode>('global')
const saveItemId = ref('')
const applyAfter = ref(false)
const saveNameError = ref(false)

const saveItems = computed(() => props.countdowns ?? [])

const sourceOptions = computed(() =>
  (
    [
      {
        value: 'global' as PresetSaveMode,
        label: t('preset.saveModeGlobal'),
        hint: t('preset.saveModeGlobalHint'),
        disabled: false
      },
      {
        value: 'item' as PresetSaveMode,
        label: t('preset.saveModeItem'),
        hint: t('preset.saveModeItemHint'),
        disabled: !saveItems.value.length
      },
      {
        value: 'manual' as PresetSaveMode,
        label: t('preset.saveModeManual'),
        hint: t('preset.saveModeManualHint'),
        disabled: false
      }
    ] as const
  ).map((option) => ({ ...option }))
)

function openSave(): void {
  saveName.value = ''
  saveMode.value = 'global'
  saveItemId.value = saveItems.value[0]?.id ?? ''
  applyAfter.value = false
  saveNameError.value = false
  saveOpen.value = true
}

/** 按选择解析出真正要保存的外观：倒数日那一份是「全局 + 它的覆盖」 */
const resolvedSaveAppearance = computed<AppConfig['appearance']>(() => {
  if (saveMode.value !== 'item') return props.appearance
  const item = saveItems.value.find((entry) => entry.id === saveItemId.value)
  if (!item) return props.appearance
  return mergeAppearance(props.appearance, item.appearance)
})

function submitSave(): void {
  // 手动调整：这个弹窗只管「来源」，名字留到调完参数之后再问（见 PresetTuneDialog）
  if (saveMode.value === 'manual') {
    saveOpen.value = false
    tuneOpen.value = true
    return
  }
  const trimmed = saveName.value.trim()
  saveNameError.value = trimmed.length === 0
  if (!trimmed) return
  emit('save', {
    name: trimmed,
    appearance: JSON.parse(JSON.stringify(resolvedSaveAppearance.value)) as AppConfig['appearance'],
    saveMode: saveMode.value,
    itemId: saveMode.value === 'item' ? saveItemId.value : '',
    applyAfter: applyAfter.value
  })
  saveOpen.value = false
}

/** 取消：顺手清掉上一次的名称报错，避免下次打开弹窗还挂着红字 */
function closeSave(): void {
  saveOpen.value = false
  saveNameError.value = false
}

/* ------------------------------------------------------------------ *
 * 手动调整所有参数：模态框里改外观，只存预设、不动全局
 * ------------------------------------------------------------------ */

const tuneOpen = ref(false)

/** 模态框把「调好的外观 + 用户起的名字」一起交回来，这里只负责转发 */
function onTuned(payload: { name: string; appearance: AppConfig['appearance'] }): void {
  emit('save', {
    name: payload.name,
    appearance: payload.appearance,
    saveMode: 'manual',
    itemId: ''
  })
}

/* ------------------------------- 单卡操作 ------------------------------- */

function applyPreset(entry: PresetEntry): void {
  emit('apply', entry.appearance, entry.id, entry.name)
}

async function confirmRemove(entry: PresetEntry): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('preset.removeConfirm', { name: entry.name }),
      t('preset.removeTitle'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
  } catch {
    return
  }
  emit('remove', entry.id)
}

async function renamePreset(entry: PresetEntry): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      t('preset.renamePlaceholder'),
      t('preset.renameTitle'),
      {
        inputValue: entry.name,
        inputValidator: (input: string) =>
          String(input ?? '').trim().length > 0 ? true : t('preset.nameRequired'),
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel')
      }
    )
    const name = String(value ?? '').trim()
    if (!name || name === entry.name) return
    emit('rename', entry.id, name)
    ElMessage.success(t('preset.renamed', { name }))
  } catch {
    /* 取消 */
  }
}

async function overwritePreset(entry: PresetEntry): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('preset.overwriteConfirm', { name: entry.name }),
      t('preset.overwrite'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
  } catch {
    return
  }
  emit(
    'overwrite',
    entry.id,
    JSON.parse(JSON.stringify(props.appearance)) as AppConfig['appearance']
  )
  ElMessage.success(t('preset.overwritten', { name: entry.name }))
}

/** 复制一份到「我的预设」：内置预设因此也能成为可编辑的起点 */
function duplicatePreset(entry: PresetEntry): void {
  const name = `${entry.name}${t('preset.copySuffix')}`
  emit('save', {
    name,
    appearance: JSON.parse(JSON.stringify(entry.appearance)) as AppConfig['appearance'],
    saveMode: 'manual',
    itemId: ''
  })
}

function onCommand(command: string, entry: PresetEntry): void {
  if (command === 'copy') duplicatePreset(entry)
  else if (command === 'rename') void renamePreset(entry)
  else if (command === 'overwrite') void overwritePreset(entry)
  else if (command === 'remove') void confirmRemove(entry)
}

/* ------------------------------------------------------------------ *
 * 查看参数：不套用也能看清一个预设到底改了什么
 * ------------------------------------------------------------------ */

const detailOpen = ref(false)
const detailName = ref('')
const detailAppearance = ref<AppConfig['appearance'] | null>(null)

function viewDetail(entry: PresetEntry): void {
  detailName.value = entry.name
  detailAppearance.value = entry.appearance
  detailOpen.value = true
}
</script>

<template>
  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span class="panel-card__title">
          {{ t('preset.custom') }}
          <el-tooltip :content="t('preset.customHint')" placement="top" :show-after="150">
            <span class="panel-card__help" tabindex="0">
              <el-icon :size="13"><QuestionFilled /></el-icon>
            </span>
          </el-tooltip>
        </span>
        <el-button size="small" type="primary" @click="openSave">
          <el-icon><Plus /></el-icon>
          <span style="margin-left: 6px">{{ t('preset.saveCurrent') }}</span>
        </el-button>
      </div>
    </template>

    <div v-if="!customEntries.length" class="preset-empty">
      {{ t('preset.empty') }}
    </div>
    <div v-else class="preset-grid">
      <div
        v-for="entry in customEntries"
        :key="entry.key"
        class="preset-item"
        :class="{ 'is-active': isActive(entry) }"
      >
        <div class="preset-canvas">
          <CountdownPreview
            :config="previewConfigOf(entry)"
            :scale="thumbScale(entry.appearance)"
            sample
            still
          />
        </div>
        <div class="preset-footer">
          <div class="preset-footer__head">
            <span class="preset-footer__name" :title="entry.name">{{ entry.name }}</span>
            <el-tag v-if="isActive(entry)" size="small" type="success" effect="plain">
              {{ t('preset.active') }}
            </el-tag>
          </div>
          <div class="preset-footer__actions">
            <el-button size="small" type="primary" plain @click="applyPreset(entry)">
              {{ t('preset.apply') }}
            </el-button>
            <el-button size="small" text @click="viewDetail(entry)">
              {{ t('preset.viewDetail') }}
            </el-button>
            <el-dropdown trigger="click" @command="(cmd: string) => onCommand(cmd, entry)">
              <el-button size="small" text class="preset-more" :title="t('preset.more')">
                <el-icon><MoreFilled /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="copy">{{ t('preset.copy') }}</el-dropdown-item>
                  <el-dropdown-item command="rename">{{ t('preset.rename') }}</el-dropdown-item>
                  <el-dropdown-item command="overwrite">{{ t('preset.overwrite') }}</el-dropdown-item>
                  <el-dropdown-item command="remove" divided>
                    {{ t('preset.remove') }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </div>
    </div>
  </el-card>

  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span class="panel-card__title">
          {{ t('preset.title') }}
          <el-tooltip :content="t('preset.hint')" placement="top" :show-after="150">
            <span class="panel-card__help" tabindex="0">
              <el-icon :size="13"><QuestionFilled /></el-icon>
            </span>
          </el-tooltip>
        </span>
        <el-tag size="small" effect="plain" type="info">{{ t('preset.builtin') }}</el-tag>
      </div>
    </template>

    <div class="preset-grid">
      <div
        v-for="entry in builtinEntries"
        :key="entry.key"
        class="preset-item"
        :class="{ 'is-active': isActive(entry) }"
      >
        <div class="preset-canvas">
          <CountdownPreview
            :config="previewConfigOf(entry)"
            :scale="thumbScale(entry.appearance)"
            sample
            still
          />
        </div>
        <div class="preset-footer">
          <div class="preset-footer__head">
            <span class="preset-footer__name" :title="entry.name">{{ entry.name }}</span>
            <el-tag v-if="isActive(entry)" size="small" type="success" effect="plain">
              {{ t('preset.active') }}
            </el-tag>
          </div>
          <div class="preset-footer__actions">
            <el-button size="small" type="primary" plain @click="applyPreset(entry)">
              {{ t('preset.apply') }}
            </el-button>
            <el-button size="small" text @click="viewDetail(entry)">
              {{ t('preset.viewDetail') }}
            </el-button>
            <el-dropdown trigger="click" @command="(cmd: string) => onCommand(cmd, entry)">
              <el-button size="small" text class="preset-more" :title="t('preset.more')">
                <el-icon><MoreFilled /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="copy">{{ t('preset.copy') }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </div>
    </div>

    <p class="preset-note">{{ t('preset.onlyAppearance') }}</p>
  </el-card>

  <!-- 新建预设：先选「从哪一份外观开始」，名称与「是否立即套用」在同一屏里解决 -->
  <el-dialog v-model="saveOpen" :title="t('preset.saveTitle')" width="620px">
    <div class="save-dialog">
      <span class="save-dialog__label">{{ t('preset.saveModeTarget') }}</span>
      <el-radio-group v-model="saveMode" class="source-list">
        <div
          v-for="option in sourceOptions"
          :key="option.value"
          class="source-item"
          :class="{ 'is-active': saveMode === option.value, 'is-disabled': option.disabled }"
          @click="option.disabled ? undefined : (saveMode = option.value)"
        >
          <el-radio :value="option.value" :disabled="option.disabled">
            <span class="source-item__title">{{ option.label }}</span>
          </el-radio>
          <p class="source-item__hint">{{ option.hint }}</p>
        </div>
      </el-radio-group>

      <el-form label-position="top">
        <el-form-item v-if="saveMode === 'item'" :label="t('preset.saveModeItemPick')">
          <el-select v-model="saveItemId" style="width: 100%">
            <el-option
              v-for="item in saveItems"
              :key="item.id"
              :label="item.name || t('editor.unnamed')"
              :value="item.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item v-if="saveMode !== 'manual'" :label="t('preset.nameLabel')">
          <el-input
            v-model="saveName"
            :placeholder="t('preset.namePlaceholder')"
            maxlength="20"
            show-word-limit
            @keydown.enter="submitSave"
          />
        </el-form-item>
      </el-form>

      <p v-if="saveNameError" class="save-error">{{ t('preset.nameRequired') }}</p>

      <!-- 只有「从某个倒数日复制」时才需要问：global 本来就是当前外观，manual 存的是草稿 -->
      <div v-if="saveMode === 'item'" class="apply-after">
        <el-checkbox v-model="applyAfter">{{ t('preset.applyAfter') }}</el-checkbox>
        <span class="apply-after__hint">{{ t('preset.applyAfterHint') }}</span>
      </div>
    </div>

    <template #footer>
      <el-button @click="closeSave">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" @click="submitSave">
        {{ saveMode === 'manual' ? t('preset.nextStep') : t('common.confirm') }}
      </el-button>
    </template>
  </el-dialog>

  <PresetTuneDialog v-model="tuneOpen" :config="config" @confirm="onTuned" />

  <PresetDetailDialog
    v-model="detailOpen"
    :name="detailName"
    :appearance="detailAppearance"
    :config="config"
  />
</template>

<style scoped>
.preset-empty {
  padding: 18px 0;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 14px;
}

.preset-item {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  overflow: hidden;
  background: var(--el-bg-color);
  transition: border-color 0.15s ease;
}

.preset-item:hover {
  border-color: var(--el-border-color);
}

/* 当前正在使用的那一套：边框用主色，扫一眼就能找到 */
.preset-item.is-active {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary-light-7) inset;
}

.preset-canvas {
  height: 118px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-light);
  overflow: hidden;
}

.preset-footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 9px;
  border-top: 1px solid var(--el-border-color-extra-light);
}

.preset-footer__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.preset-footer__name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-footer__actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.preset-footer__actions .el-button {
  margin-left: 0;
}

.preset-more {
  padding: 0 5px;
}

.preset-note {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.save-dialog__label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.source-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
  width: 100%;
}

/* 三选一做成可点击的整块卡片：说明文字跟着选项走，比「三个单选 + 一段会变的灰字」好读 */
.source-item {
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  padding: 9px 12px 10px;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.source-item.is-active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.source-item.is-disabled {
  opacity: 0.55;
}

.source-item :deep(.el-radio) {
  height: auto;
  margin-right: 0;
}

.source-item :deep(.el-radio__label) {
  font-size: 13px;
  font-weight: 600;
}

.source-item__hint {
  margin: 2px 0 0 24px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.save-error {
  margin: -8px 0 10px;
  font-size: 12.5px;
  color: var(--el-color-danger);
}

.apply-after {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding-top: 4px;
}

.apply-after__hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
