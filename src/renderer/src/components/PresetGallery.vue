<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import type { AppConfig, CountdownItem, CustomPreset } from '@shared/types'
import { THEME_PRESETS, mergeAppearance } from '@shared/defaults'
import { cardStyleFor, textStyle } from '@/utils/style'
import PresetDetailDialog from '@/components/PresetDetailDialog.vue'

const props = defineProps<{
  appearance: AppConfig['appearance']
  text: AppConfig['text']
  customPresets: CustomPreset[]
  countdowns: CountdownItem[]
}>()

/** 保存预设的来源：全局外观 / 某个倒数日的外观覆盖 */
export type PresetSaveTarget = 'global' | 'item'

const emit = defineEmits<{
  (event: 'apply', appearance: AppConfig['appearance'], id: string, name: string): void
  (event: 'remove', id: string): void
  /** 保存预设：name = 名称，target = 来源，然后跳到外观页继续手动微调 */
  (
    event: 'save',
    payload: {
      name: string
      appearance: AppConfig['appearance']
      target: PresetSaveTarget
      itemId: string
      tune: boolean
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
 * 保存预设：先弹出模态框问清楚「要保存的是哪一份设置」
 * ------------------------------------------------------------------ */

const saveOpen = ref(false)
const saveName = ref('')
const saveMode = ref<'global' | 'item' | 'manual'>('global')
const saveItemId = ref('')

const saveItems = computed(() => props.countdowns ?? [])

function openSave(): void {
  saveName.value = ''
  saveMode.value = 'global'
  saveItemId.value = saveItems.value[0]?.id ?? ''
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
  const trimmed = saveName.value.trim()
  saveNameError.value = trimmed.length === 0
  if (!trimmed) return
  emit('save', {
    name: trimmed,
    appearance: JSON.parse(JSON.stringify(resolvedSaveAppearance.value)) as AppConfig['appearance'],
    target: saveMode.value === 'item' ? 'item' : 'global',
    itemId: saveMode.value === 'item' ? saveItemId.value : '',
    tune: saveMode.value === 'manual'
  })
  saveOpen.value = false
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

  <!-- 保存预设：先问清楚存哪一份设置，再让用户起名 -->
  <el-dialog v-model="saveOpen" :title="t('preset.saveModeTitle')" width="560px">
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

      <el-form-item :label="t('preset.nameLabel')">
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
      <el-button @click="saveOpen = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" @click="submitSave">{{ t('common.confirm') }}</el-button>
    </template>
  </el-dialog>

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
