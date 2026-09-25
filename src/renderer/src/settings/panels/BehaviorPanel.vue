<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AppConfig } from '@shared/types'
import FieldRow from '@/components/FieldRow.vue'

defineProps<{ config: AppConfig }>()
const emit = defineEmits<{ (event: 'patch', patch: unknown): void }>()

const { t } = useI18n()
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
        @update:model-value="(v: string | number | boolean | undefined) => emit('patch', { behavior: { displayMode: v } })"
      >
        <el-radio-button value="days">{{ t('behavior.days') }}</el-radio-button>
        <el-radio-button value="precise">{{ t('behavior.precise') }}</el-radio-button>
      </el-radio-group>
    </FieldRow>

    <FieldRow
      v-if="config.behavior.displayMode === 'precise'"
      :label="t('behavior.showDaysInPrecise')"
    >
      <el-switch
        :model-value="config.behavior.showDaysInPrecise"
        @update:model-value="(v: string | number | boolean) => emit('patch', { behavior: { showDaysInPrecise: Boolean(v) } })"
      />
    </FieldRow>

    <FieldRow :label="t('behavior.alwaysOnTop')" :hint="t('behavior.alwaysOnTopHint')">
      <el-switch
        :model-value="config.behavior.alwaysOnTop"
        @update:model-value="(v: string | number | boolean) => emit('patch', { behavior: { alwaysOnTop: Boolean(v) } })"
      />
    </FieldRow>
  </el-card>
</template>
