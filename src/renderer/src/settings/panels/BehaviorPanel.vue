<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, DisplayMode, SeparatorConfig } from '@shared/types'
import { SEPARATOR_PRESETS } from '@shared/defaults'
import FieldRow from '@/components/FieldRow.vue'
import { modePreviewLabel } from '@/utils/preview'

const props = defineProps<{ config: AppConfig }>()
const emit = defineEmits<{ (event: 'patch', patch: unknown): void }>()

const { t } = useI18n()

interface ModeOption {
  value: DisplayMode
  label: string
}

const separator = computed<SeparatorConfig>(() => ({
  hm: props.config.behavior.separatorHM,
  ms: props.config.behavior.separatorMS
}))

/** 选项文案直接显示真实渲染结果，回车换行前也能看出分隔符是什么 */
const modes = computed<ModeOption[]>(() => [
  { value: 'days', label: t('behavior.days') },
  {
    value: 'days-hours',
    label: modePreviewLabel('days-hours', true, separator.value)
  },
  {
    value: 'days-hours-minutes',
    label: modePreviewLabel('days-hours-minutes', true, separator.value)
  },
  {
    value: 'precise',
    label: modePreviewLabel('precise', props.config.behavior.showDaysInPrecise, separator.value)
  }
])

function patchBehavior(patch: Record<string, unknown>): void {
  emit('patch', { behavior: patch })
}

function setSeparator(key: 'separatorHM' | 'separatorMS', value: string): void {
  patchBehavior({ [key]: value.slice(0, 6) })
}

/** 分隔符当前显示成什么；空串要有明确的「不显示」提示 */
function separatorText(value: string): string {
  return value === '' ? t('behavior.separatorPlaceholder') : value
}
</script>

<template>
  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span>{{ t('behavior.title') }}</span>
      </div>
    </template>

    <FieldRow :label="t('behavior.displayMode')">
      <el-radio-group
        :model-value="config.behavior.displayMode"
        @update:model-value="(v: string | number | boolean | undefined) => patchBehavior({ displayMode: v })"
      >
        <el-radio-button v-for="mode in modes" :key="mode.value" :value="mode.value">
          {{ mode.label }}
        </el-radio-button>
      </el-radio-group>
    </FieldRow>

    <FieldRow
      v-if="config.behavior.displayMode === 'precise'"
      :label="t('behavior.showDaysInPrecise')"
    >
      <el-switch
        :model-value="config.behavior.showDaysInPrecise"
        @update:model-value="(v: string | number | boolean) => patchBehavior({ showDaysInPrecise: Boolean(v) })"
      />
    </FieldRow>

    <el-divider content-position="left">
      <span class="divider-title">
        {{ t('behavior.separatorTitle') }}
        <el-tooltip :content="t('behavior.separatorHint')" placement="top" :show-after="150">
          <span class="panel-card__help" tabindex="0">
            <el-icon :size="13"><QuestionFilled /></el-icon>
          </span>
        </el-tooltip>
      </span>
    </el-divider>

    <div class="panel-grid-2">
      <FieldRow
        :label="t('behavior.separatorHM')"
        :hint="t('behavior.separatorPreview', { value: separatorText(config.behavior.separatorHM) })"
      >
        <el-select
          :model-value="config.behavior.separatorHM"
          class="separator-select"
          filterable
          allow-create
          default-first-option
          @update:model-value="(v: string) => setSeparator('separatorHM', v)"
        >
          <el-option :label="t('behavior.separatorPlaceholder')" value="" />
          <el-option v-for="preset in SEPARATOR_PRESETS" :key="preset" :label="preset" :value="preset" />
        </el-select>
      </FieldRow>

      <FieldRow
        :label="t('behavior.separatorMS')"
        :hint="t('behavior.separatorPreview', { value: separatorText(config.behavior.separatorMS) })"
      >
        <el-select
          :model-value="config.behavior.separatorMS"
          class="separator-select"
          filterable
          allow-create
          default-first-option
          @update:model-value="(v: string) => setSeparator('separatorMS', v)"
        >
          <el-option :label="t('behavior.separatorPlaceholder')" value="" />
          <el-option v-for="preset in SEPARATOR_PRESETS" :key="preset" :label="preset" :value="preset" />
        </el-select>
      </FieldRow>
    </div>

    <FieldRow :label="t('behavior.alwaysOnTop')" :hint="t('behavior.alwaysOnTopHint')">
      <el-switch
        :model-value="config.behavior.alwaysOnTop"
        @update:model-value="(v: string | number | boolean) => patchBehavior({ alwaysOnTop: Boolean(v) })"
      />
    </FieldRow>
  </el-card>
</template>

<style scoped>
.divider-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.separator-select {
  width: 100%;
  max-width: 220px;
}
</style>
