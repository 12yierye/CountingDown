<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig } from '@shared/types'
import FieldRow from '@/components/FieldRow.vue'

const props = defineProps<{ config: AppConfig }>()
const emit = defineEmits<{ (event: 'patch', patch: unknown): void }>()

const { t } = useI18n()

const targetRef = computed(() => props.config.target)

function patchTarget(patch: Record<string, unknown>): void {
  emit('patch', { target: patch })
}

function patchText(patch: Record<string, unknown>): void {
  emit('patch', { text: patch })
}

const dateValue = computed<Date | null>(() => {
  const raw = targetRef.value.date
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
})

const dateType = computed<'date' | 'datetime'>(() =>
  targetRef.value.date.includes('T') ? 'datetime' : 'date'
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
  patchTarget({ date: toDateString(value, dateType.value) })
}

function onDateTypeChange(next: 'date' | 'datetime'): void {
  const current = dateValue.value
  if (!current) return
  patchTarget({ date: toDateString(current, next) })
}

const maxDay = computed(() => new Date(new Date().getFullYear(), targetRef.value.month, 0).getDate())
</script>

<template>
  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span class="panel-card__title">
          {{ t('target.title') }}
          <el-tooltip :content="t('target.inheritHint')" placement="top" :show-after="150">
            <span class="panel-card__help" tabindex="0">
              <el-icon :size="13"><QuestionFilled /></el-icon>
            </span>
          </el-tooltip>
        </span>
        <el-tag size="small" type="info" effect="plain">{{ t('common.followGlobal') }}</el-tag>
      </div>
    </template>

    <FieldRow :label="t('target.mode')">
      <el-radio-group
        :model-value="targetRef.mode"
        @update:model-value="(v: string | number | boolean | undefined) => patchTarget({ mode: v })"
      >
        <el-radio-button value="annual">{{ t('target.modeAnnual') }}</el-radio-button>
        <el-radio-button value="once">{{ t('target.modeOnce') }}</el-radio-button>
      </el-radio-group>
    </FieldRow>

    <FieldRow v-if="targetRef.mode === 'annual'" :label="t('target.monthDay')">
      <div class="inline-group">
        <el-select
          :model-value="targetRef.month"
          style="width: 110px"
          @update:model-value="(v: number) => patchTarget({ month: v })"
        >
          <el-option v-for="m in 12" :key="m" :label="`${m} ${t('target.month')}`" :value="m" />
        </el-select>
        <el-select
          :model-value="targetRef.day"
          style="width: 110px"
          @update:model-value="(v: number) => patchTarget({ day: v })"
        >
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
  </el-card>

  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span class="panel-card__title">
          {{ t('target.visibilityGroup') }}
          <el-tooltip :content="t('target.visibilityHint')" placement="top" :show-after="150">
            <span class="panel-card__help" tabindex="0">
              <el-icon :size="13"><QuestionFilled /></el-icon>
            </span>
          </el-tooltip>
        </span>
      </div>
    </template>

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

    <FieldRow :label="t('target.showUnit')" :hint="t('target.showUnitHint')">
      <el-radio-group
        :model-value="config.text.showUnit !== false"
        @update:model-value="(v: string | number | boolean | undefined) => patchText({ showUnit: v === true || v === 'true' })"
      >
        <el-radio-button :value="true">{{ t('target.show') }}</el-radio-button>
        <el-radio-button :value="false">{{ t('target.hide') }}</el-radio-button>
      </el-radio-group>
    </FieldRow>
  </el-card>

  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span class="panel-card__title">
          {{ t('target.statusGroup') }}
          <el-tooltip :content="t('target.statusHint')" placement="top" :show-after="150">
            <span class="panel-card__help" tabindex="0">
              <el-icon :size="13"><QuestionFilled /></el-icon>
            </span>
          </el-tooltip>
        </span>
      </div>
    </template>

    <FieldRow :label="t('target.hintText')">
      <el-input
        :model-value="config.text.hint"
        :placeholder="t('target.hintPlaceholder')"
        maxlength="60"
        show-word-limit
        @update:model-value="(v: string) => patchText({ hint: v })"
      />
    </FieldRow>

    <FieldRow :label="t('target.futureText')">
      <el-input
        :model-value="config.text.futureText"
        maxlength="40"
        @update:model-value="(v: string) => patchText({ futureText: v })"
      />
    </FieldRow>

    <FieldRow :label="t('target.todayText')">
      <el-input
        :model-value="config.text.todayText"
        maxlength="40"
        @update:model-value="(v: string) => patchText({ todayText: v })"
      />
    </FieldRow>

    <FieldRow :label="t('target.pastText')">
      <el-input
        :model-value="config.text.pastText"
        maxlength="40"
        @update:model-value="(v: string) => patchText({ pastText: v })"
      />
    </FieldRow>

    <FieldRow :label="t('target.unit')">
      <el-input
        :model-value="config.text.unit"
        :placeholder="t('target.unitPlaceholder')"
        style="max-width: 160px"
        maxlength="6"
        @update:model-value="(v: string) => patchText({ unit: v })"
      />
    </FieldRow>

    <FieldRow :label="t('target.showPastDays')" :hint="t('target.showPastDaysHint')">
      <el-switch
        :model-value="config.behavior.showPastDays"
        @update:model-value="(v: string | number | boolean) => emit('patch', { behavior: { showPastDays: Boolean(v) } })"
      />
    </FieldRow>
  </el-card>
</template>

<style scoped>
.inline-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
</style>
