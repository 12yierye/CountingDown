<script setup lang="ts">
/**
 * 「文案与显示」页 —— 卡片上写什么，全在这里。
 *
 * 全局默认日期已经取消（日期是每一项自己的字段），这一页现在是三块：
 * 默认文案（展开）、显示精度/单位字（展开）、显示项开关（收起）。
 * 显示精度原属「行为」页，搬过来是因为它和文案、单位字一样只影响文字本身，
 * 跟窗口位置无关；「行为」页因此改名为「窗口」。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, DisplayMode, UnitLabelConfig } from '@shared/types'
import FieldRow from '@/components/FieldRow.vue'
import UnitLabelField from '@/components/UnitLabelField.vue'
import TextVariables from '@/components/TextVariables.vue'
import SettingSection from '@/components/SettingSection.vue'
import { modeSlots } from '@/utils/preview'

const props = defineProps<{ config: AppConfig }>()
const emit = defineEmits<{ (event: 'patch', patch: unknown): void }>()

const { t } = useI18n()

function patchText(patch: Record<string, unknown>): void {
  emit('patch', { text: patch })
}

/* --------------------------- 显示精度（原「行为」页） --------------------------- */

interface ModeOption {
  value: DisplayMode
  label: string
}

/**
 * 四个选项统一按「最小精度单位」命名：天 / 时 / 分 / 秒。
 * 概览由右侧实时预览卡负责，选项里不再重复「天 + 时」这种累进写法。
 */
const modes = computed<ModeOption[]>(() => [
  { value: 'days', label: t('behavior.days') },
  { value: 'days-hours', label: t('behavior.daysHours') },
  { value: 'days-hours-minutes', label: t('behavior.daysHoursMinutes') },
  { value: 'precise', label: t('behavior.precise') }
])

function patchBehavior(patch: Record<string, unknown>): void {
  emit('patch', { behavior: patch })
}

/* --------------------------- 单位字（全局默认） --------------------------- */

const units = computed<UnitLabelConfig>(() => props.config.behavior.units)

/** 当前显示模式下真正会渲染的分段；只用于标灰提示，不决定能否编辑 */
const slots = computed(() =>
  modeSlots(props.config.behavior.displayMode, props.config.behavior.showDaysInPrecise)
)

function patchUnits(patch: Partial<UnitLabelConfig>): void {
  emit('patch', { behavior: { units: patch } })
}
</script>

<template>
  <SettingSection
    :title="t('target.statusGroup')"
    :help="t('target.statusHint')"
    persist-key="target.text"
  >
    <FieldRow :label="t('target.hintText')" :hint="t('target.hintHint')">
      <el-input
        :model-value="config.text.hint"
        :placeholder="t('target.hintPlaceholder')"
        maxlength="60"
        show-word-limit
        @update:model-value="(v: string) => patchText({ hint: v })"
      />
      <template #note>
        <TextVariables
          field="hint"
          :model-value="config.text.hint"
          @update:model-value="(v: string) => patchText({ hint: v })"
        />
      </template>

    </FieldRow>

    <!-- 虚线分隔：上面是固定副标题，下面三行是随日期切换的状态文案 -->
    <div class="text-sep" aria-hidden="true"></div>

    <FieldRow :label="t('target.futureText')" :hint="t('target.futureHint')">
      <el-input
        :model-value="config.text.futureText"
        maxlength="40"
        @update:model-value="(v: string) => patchText({ futureText: v })"
      />
      <template #note>
        <TextVariables
          field="future"
          :model-value="config.text.futureText"
          @update:model-value="(v: string) => patchText({ futureText: v })"
        />
      </template>
    </FieldRow>

    <FieldRow :label="t('target.todayText')" :hint="t('target.todayTextHint')">
      <el-input
        :model-value="config.text.todayText"
        maxlength="40"
        @update:model-value="(v: string) => patchText({ todayText: v })"
      />
      <template #note>
        <TextVariables
          field="today"
          :model-value="config.text.todayText"
          @update:model-value="(v: string) => patchText({ todayText: v })"
        />
      </template>
    </FieldRow>

    <FieldRow :label="t('target.pastText')" :hint="t('target.pastTextHint')">
      <el-input
        :model-value="config.text.pastText"
        maxlength="40"
        @update:model-value="(v: string) => patchText({ pastText: v })"
      />
      <template #note>
        <TextVariables
          field="past"
          :model-value="config.text.pastText"
          @update:model-value="(v: string) => patchText({ pastText: v })"
        />
      </template>
    </FieldRow>
  </SettingSection>

  <!--
    显示精度从「行为」页搬过来：它决定的是「数字显示到哪一级」，
    和文案、单位字一样属于「卡片上写什么」，跟窗口/位置没有关系。
  -->
  <SettingSection
    :title="`${t('behavior.displayTitle')} / ${t('behavior.unitsTitle')}`"
    :help="t('behavior.unitsHint')"
    persist-key="target.precision"
  >
    <FieldRow>
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

    <!--
      单位字跟着精度放：精度决定「有哪几段」，单位字决定「每段后面跟什么字」，
      两者是一件事的两半。精度切走的分段在这里只淡一档，照样能改。
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
  </SettingSection>

  <SettingSection
    :title="t('target.visibilityGroup')"
    :help="t('target.visibilityHint')"
    :default-open="false"
    persist-key="target.visibility"
  >
    <FieldRow :label="t('target.showHint')">
      <el-radio-group
        :model-value="config.text.showHint"
        @update:model-value="(v: string | number | boolean | undefined) => patchText({ showHint: v === true || v === 'true' })"
      >
        <el-radio-button :value="true">{{ t('target.show') }}</el-radio-button>
        <el-radio-button :value="false">{{ t('target.hide') }}</el-radio-button>
      </el-radio-group>
    </FieldRow>

    <FieldRow :label="t('target.showStatus')">
      <el-radio-group
        :model-value="config.text.showStatus"
        @update:model-value="(v: string | number | boolean | undefined) => patchText({ showStatus: v === true || v === 'true' })"
      >
        <el-radio-button :value="true">{{ t('target.show') }}</el-radio-button>
        <el-radio-button :value="false">{{ t('target.hide') }}</el-radio-button>
      </el-radio-group>
    </FieldRow>
  </SettingSection>
</template>

<style scoped>
/* 副标题与状态文案之间的虚线：两组性质不同，但不需要一行小标题 */
.text-sep {
  margin: 10px 0 2px;
  border-top: 1px dashed var(--el-border-color-light);
}
</style>
