<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, DisplayMode, UnitLabelConfig } from '@shared/types'
import FieldRow from '@/components/FieldRow.vue'
import UnitLabelField from '@/components/UnitLabelField.vue'
import { modePreviewLabel, modeSlots } from '@/utils/preview'

const props = defineProps<{ config: AppConfig }>()
const emit = defineEmits<{ (event: 'patch', patch: unknown): void }>()

const { t } = useI18n()

interface ModeOption {
  value: DisplayMode
  label: string
}

const units = computed<UnitLabelConfig>(() => props.config.behavior.units)

/**
 * 当前显示模式下真正会渲染出来的分段。
 * 它**只**决定单位字输入框要不要标灰提示，不决定能否编辑：四项永远可编辑。
 */
const slots = computed(() =>
  modeSlots(props.config.behavior.displayMode, props.config.behavior.showDaysInPrecise)
)

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

/** 四个单位字独立更新，互不影响 */
function patchUnits(patch: Partial<UnitLabelConfig>): void {
  patchBehavior({ units: patch })
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
        {{ t('behavior.unitsTitle') }}
        <el-tooltip :content="t('behavior.unitsHint')" placement="top" :show-after="150">
          <span class="panel-card__help" tabindex="0">
            <el-icon :size="13"><QuestionFilled /></el-icon>
          </span>
        </el-tooltip>
      </span>
    </el-divider>

    <!--
      这里换的是每一段后面的那个字本身：`92天` 的「天」换成 `D` 就是 `92D`。
      单位字同时起了分隔作用，所以没有单独的「分隔符」设置；留空即这一段不带单位。
      下面的 xx-on 只用来给「当前模式用不到」的分段标灰，**不会**禁用输入框。
    -->
    <FieldRow stacked>
      <UnitLabelField
        :day="units.day"
        :hour="units.hour"
        :minute="units.minute"
        :second="units.second"
        :day-on="slots.days || config.behavior.displayMode === 'days'"
        :hour-on="slots.hours"
        :minute-on="slots.minutes"
        :second-on="slots.seconds"
        @update:day="(v: string) => patchUnits({ day: v })"
        @update:hour="(v: string) => patchUnits({ hour: v })"
        @update:minute="(v: string) => patchUnits({ minute: v })"
        @update:second="(v: string) => patchUnits({ second: v })"
      />
    </FieldRow>

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
</style>
