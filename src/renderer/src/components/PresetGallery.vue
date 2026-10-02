<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import type { AppConfig, CountdownItem, CustomPreset } from '@shared/types'
import { THEME_PRESETS, mergeAppearance } from '@shared/defaults'
import { cardStyleFor, textStyle } from '@/utils/style'
import PresetDetailDialog from '@/components/PresetDetailDialog.vue'
import PresetTuneDialog from '@/components/PresetTuneDialog.vue'

const props = defineProps<{
  appearance: AppConfig['appearance']
  text: AppConfig['text']
  customPresets: CustomPreset[]
  countdowns: CountdownItem[]
  /** 「手动调整」模态框里的实时预览需要完整配置上下文 */
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
  /** 保存预设：name = 名称，saveMode = 来源；manual 时 appearance 来自模态框里的草稿 */
  (
    event: 'save',
    payload: {
      name: string
      appearance: AppConfig['appearance']
      saveMode: PresetSaveMode
      itemId: string
    }
  ): void
}>()

const { t, locale } = useI18n()

function presetName(nameZh: string, nameEn: string): string {
  return locale.value === 'en-US' ? nameEn : nameZh
}

function previewStyle(appearance: AppConfig['appearance']): Record<string, string> {
  return cardStyleFor(appearance)
}

function numberStyle(appearance: AppConfig['appearance']): Record<string, string> {
  return {
    ...textStyle(appearance.count, appearance.textAlpha),
    fontSize: `${Math.min(appearance.count.fontSize, 42)}px`
  }
}

function labelStyle(appearance: AppConfig['appearance']): Record<string, string> {
  return textStyle(appearance.hint, appearance.textAlpha)
}

/* ------------------------------------------------------------------ *
 * 保存预设
 *   global / item：弹窗收「名称 + 来源」，确定即保存（global 会覆盖全局外观）
 *   manual：弹窗只收名称，确定后进外观模态框，在模态框里点保存才落盘
 * ------------------------------------------------------------------ */

const saveOpen = ref(false)
const saveName = ref('')
const saveMode = ref<PresetSaveMode>('global')
const saveItemId = ref('')

const saveItems = computed(() => props.countdowns ?? [])

function openSave(): void {
  saveName.value = ''
  saveMode.value = 'global'
  saveItemId.value = saveItems.value[0]?.id ?? ''
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

const saveNameError = ref(false)

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
    itemId: saveMode.value === 'item' ? saveItemId.value : ''
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

async function confirmRemove(preset: CustomPreset): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('preset.removeConfirm', { name: preset.name }),
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
  emit('remove', preset.id)
}

/* ------------------------------------------------------------------ *
 * 查看参数：不套用也能看清一个预设到底改了什么
 * ------------------------------------------------------------------ */

const detailOpen = ref(false)
const detailName = ref('')
const detailAppearance = ref<AppConfig['appearance'] | null>(null)

function viewDetail(name: string, appearance: AppConfig['appearance']): void {
  detailName.value = name
  detailAppearance.value = appearance
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

    <div v-if="!customPresets.length" class="preset-empty">
      {{ t('preset.empty') }}
    </div>
    <div v-else class="preset-grid">
      <div v-for="preset in customPresets" :key="preset.id" class="preset-item">
        <div class="preset-canvas">
          <div class="preset-card" :style="previewStyle(preset.appearance)">
            <span class="preset-title" :style="textStyle(preset.appearance.title, preset.appearance.textAlpha)">
              {{ preset.name }}
            </span>
            <span class="preset-number" :style="numberStyle(preset.appearance)">128</span>
            <span class="preset-label" :style="labelStyle(preset.appearance)">5 月 20 日</span>
          </div>
        </div>
        <div class="preset-footer">
          <span class="preset-footer__name">{{ preset.name }}</span>
          <div class="preset-footer__actions">
            <el-button
              size="small"
              text
              @click="viewDetail(preset.name, preset.appearance)"
            >
              {{ t('preset.viewDetail') }}
            </el-button>
            <el-button
              size="small"
              type="primary"
              plain
              @click="emit('apply', preset.appearance, preset.id, preset.name)"
            >
              {{ t('preset.apply') }}
            </el-button>
            <el-button size="small" text type="danger" @click="confirmRemove(preset)">
              {{ t('preset.remove') }}
            </el-button>
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
      <div v-for="preset in THEME_PRESETS" :key="preset.id" class="preset-item">
        <div class="preset-canvas">
          <div class="preset-card" :style="previewStyle(preset.appearance)">
            <span class="preset-title" :style="textStyle(preset.appearance.title, preset.appearance.textAlpha)">
              {{ presetName(preset.nameZh, preset.nameEn) }}
            </span>
            <span class="preset-number" :style="numberStyle(preset.appearance)">128</span>
            <span class="preset-label" :style="labelStyle(preset.appearance)">5 月 20 日</span>
          </div>
        </div>
        <div class="preset-footer">
          <span class="preset-footer__name">{{ presetName(preset.nameZh, preset.nameEn) }}</span>
          <div class="preset-footer__actions">
            <el-button
              size="small"
              text
              @click="viewDetail(presetName(preset.nameZh, preset.nameEn), preset.appearance)"
            >
              {{ t('preset.viewDetail') }}
            </el-button>
            <el-button
              size="small"
              type="primary"
              plain
              @click="
                emit('apply', preset.appearance, preset.id, presetName(preset.nameZh, preset.nameEn))
              "
            >
              {{ t('preset.apply') }}
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </el-card>

  <!-- 新建预设：这里只问「存哪一份设置」；手动调整的名称留到调完参数之后再问 -->
  <el-dialog v-model="saveOpen" :title="t('preset.saveTitle')" width="560px">
    <el-form label-position="top">
      <el-form-item :label="t('preset.saveModeTarget')">
        <el-radio-group v-model="saveMode" class="save-mode">
          <el-radio value="global">{{ t('preset.saveModeGlobal') }}</el-radio>
          <el-radio value="item" :disabled="!saveItems.length">
            {{ t('preset.saveModeItem') }}
          </el-radio>
          <el-radio value="manual">{{ t('preset.saveModeManual') }}</el-radio>
        </el-radio-group>
      </el-form-item>

      <p class="save-hint">
        <template v-if="saveMode === 'global'">{{ t('preset.saveModeGlobalHint') }}</template>
        <template v-else-if="saveMode === 'item'">{{ t('preset.saveModeItemHint') }}</template>
        <template v-else>{{ t('preset.saveModeManualHint') }}</template>
      </p>

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
      <p v-if="saveNameError" class="save-error">{{ t('preset.nameRequired') }}</p>
    </el-form>

    <template #footer>
      <el-button @click="closeSave">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" @click="submitSave">
        {{ saveMode === 'manual' ? t('preset.tuneOpen') : t('common.confirm') }}
      </el-button>
    </template>
  </el-dialog>

  <PresetTuneDialog v-model="tuneOpen" :config="config" @confirm="onTuned" />

  <PresetDetailDialog
    v-model="detailOpen"
    :name="detailName"
    :appearance="detailAppearance"
    :text="text"
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
}

.preset-canvas {
  height: 118px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--el-fill-color-darker), var(--el-fill-color-light));
  overflow: hidden;
}

.preset-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  transform: scale(0.86);
  min-width: 132px;
}

.preset-title,
.preset-number,
.preset-label {
  line-height: 1.2;
}

.preset-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  flex-wrap: wrap;
}

.preset-footer__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.preset-footer__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.save-mode {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.save-hint {
  margin: -6px 0 14px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.save-error {
  margin: -8px 0 10px;
  font-size: 12.5px;
  color: var(--el-color-danger);
}
</style>
