<script setup lang="ts">
/**
 * 行为页 —— 只负责「显示的默认格式」。
 *
 * 单位字已经移到「日期与文案」（那里本来就是文案与格式的地盘）；
 * 置顶 / 拖动 / 穿透 / 透明跟着 LayoutPanel 一起进了窗口卡片；
 * 于是这一页只剩显示模式本身。每一项都能在编辑页里单独覆盖。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, DisplayMode, UnitLabelConfig } from '@shared/types'
import FieldRow from '@/components/FieldRow.vue'
import { modePreviewLabel } from '@/utils/preview'

const props = defineProps<{ config: AppConfig }>()
const emit = defineEmits<{ (event: 'patch', patch: unknown): void }>()

const { t } = useI18n()

interface ModeOption {
  value: DisplayMode
  label: string
}

const units = computed<UnitLabelConfig>(() => props.config.behavior.units)

/** 选项文案直接显示真实渲染结果，因此换单位字时选项也会跟着变 */
const modes = computed<ModeOption[]>(() => [
  { value: 'days', label: t('behavior.days') },
  { value: 'days-hours', label: modePreviewLabel('days-hours', true, units.value) },
  {
    value: 'days-hours-minutes',
    label: modePreviewLabel('days-hours-minutes', true, units.value)
  },
  {
    value: 'precise',
    label: modePreviewLabel('precise', props.config.behavior.showDaysInPrecise, units.value)
  }
])

function patchBehavior(patch: Record<string, unknown>): void {
  emit('patch', { behavior: patch })
}
</script>

<template>
  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span class="panel-card__title">
          {{ t('behavior.displayTitle') }}
          <el-tooltip :content="t('editor.displayModeHint')" placement="top" :show-after="150">
            <span class="panel-card__help" tabindex="0">
              <el-icon :size="13"><QuestionFilled /></el-icon>
            </span>
          </el-tooltip>
        </span>
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
  </el-card>
</template>
