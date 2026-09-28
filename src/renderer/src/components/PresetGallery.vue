<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import type { AppConfig, CustomPreset } from '@shared/types'
import { THEME_PRESETS } from '@shared/defaults'
import { cardStyle, textStyle } from '@/utils/style'

const props = defineProps<{
  appearance: AppConfig['appearance']
  customPresets: CustomPreset[]
}>()

const emit = defineEmits<{
  (event: 'apply', appearance: AppConfig['appearance'], id: string, name: string): void
  (event: 'saveCurrent', name: string): void
  (event: 'remove', id: string): void
}>()

const { t, locale } = useI18n()

const saving = defineModel<boolean>('saving', { default: false })
const newName = defineModel<string>('newName', { default: '' })

void props

function presetName(nameZh: string, nameEn: string): string {
  return locale.value === 'en-US' ? nameEn : nameZh
}

function previewStyle(appearance: AppConfig['appearance']): Record<string, string> {
  return {
    ...cardStyle({} as AppConfig, appearance),
    opacity: String(appearance.opacity ?? 1)
  }
}

function numberStyle(appearance: AppConfig['appearance']): Record<string, string> {
  return {
    ...textStyle(appearance.count),
    fontSize: `${Math.min(appearance.count.fontSize, 42)}px`
  }
}

function submitSave(): void {
  const name = newName.value.trim()
  if (!name) return
  emit('saveCurrent', name)
  newName.value = ''
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
        <el-button size="small" type="primary" @click="saving = !saving">
          <el-icon><Plus /></el-icon>
          <span style="margin-left: 6px">{{ t('preset.saveCurrent') }}</span>
        </el-button>
      </div>
    </template>

    <div v-if="saving" class="preset-save">
      <el-input
        v-model="newName"
        :placeholder="t('preset.namePlaceholder')"
        maxlength="20"
        style="max-width: 260px"
        @keydown.enter="submitSave"
      />
      <el-button type="primary" size="small" @click="submitSave">
        {{ t('common.confirm') }}
      </el-button>
      <el-button size="small" plain @click="saving = false">{{ t('common.cancel') }}</el-button>
    </div>

    <div v-if="!customPresets.length" class="preset-empty">
      {{ t('preset.empty') }}
    </div>
    <div v-else class="preset-grid">
      <div v-for="preset in customPresets" :key="preset.id" class="preset-item">
        <div class="preset-canvas">
          <div class="preset-card" :style="previewStyle(preset.appearance)">
            <span class="preset-title" :style="textStyle(preset.appearance.title)">
              {{ preset.name }}
            </span>
            <span class="preset-number" :style="numberStyle(preset.appearance)">128</span>
            <span class="preset-label" :style="textStyle(preset.appearance.hint)">5 月 20 日</span>
          </div>
        </div>
        <div class="preset-footer">
          <span class="preset-footer__name">{{ preset.name }}</span>
          <div>
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
            <span class="preset-title" :style="textStyle(preset.appearance.title)">
              {{ presetName(preset.nameZh, preset.nameEn) }}
            </span>
            <span class="preset-number" :style="numberStyle(preset.appearance)">128</span>
            <span class="preset-label" :style="textStyle(preset.appearance.hint)">5 月 20 日</span>
          </div>
        </div>
        <div class="preset-footer">
          <span class="preset-footer__name">{{ presetName(preset.nameZh, preset.nameEn) }}</span>
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
  </el-card>
</template>

<style scoped>
.preset-save {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px dashed var(--el-border-color);
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
}

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
}

.preset-footer__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
