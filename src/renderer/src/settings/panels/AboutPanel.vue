<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, AppLanguage, HostInfo } from '@shared/types'
import FieldRow from '@/components/FieldRow.vue'

defineProps<{ config: AppConfig }>()
const emit = defineEmits<{ (event: 'patch', patch: unknown): void }>()

const { t } = useI18n()
const host = ref<HostInfo | null>(null)

onMounted(async () => {
  host.value = await window.cd.getHostInfo()
})

function setLanguage(language: AppLanguage): void {
  emit('patch', { runtime: { language } })
}
</script>

<template>
  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span>{{ t('about.title') }}</span>
      </div>
    </template>

    <FieldRow :label="t('about.version')">
      <span class="mono">{{ host?.appVersion ?? '—' }}</span>
    </FieldRow>

    <FieldRow :label="t('about.electron')">
      <span class="mono">{{ host?.electron ?? '—' }}</span>
    </FieldRow>

    <FieldRow :label="t('about.platform')">
      <span class="mono">{{ host?.platform ?? '—' }}</span>
    </FieldRow>

    <FieldRow :label="t('about.language')">
      <el-radio-group
        :model-value="config.runtime.language"
        @update:model-value="(v: string | number | boolean | undefined) => setLanguage(v as AppLanguage)"
      >
        <el-radio-button value="zh-CN">简体中文</el-radio-button>
        <el-radio-button value="en-US">English</el-radio-button>
      </el-radio-group>
    </FieldRow>

    <FieldRow :label="t('about.theme')">
      <el-radio-group
        :model-value="config.runtime.theme"
        @update:model-value="(v: string | number | boolean | undefined) => emit('patch', { runtime: { theme: v } })"
      >
        <el-radio-button value="dark">{{ t('about.dark') }}</el-radio-button>
        <el-radio-button value="light">{{ t('about.light') }}</el-radio-button>
      </el-radio-group>
    </FieldRow>

    <FieldRow :label="t('about.screens')">
      <div class="screens">
        <div v-for="screen in host?.screens ?? []" :key="screen.id" class="screens__item">
          <el-tag size="small" :type="screen.primary ? 'primary' : 'info'" effect="plain">
            {{ screen.label }}
          </el-tag>
          <span class="mono">
            {{ screen.workArea.width }}×{{ screen.workArea.height }} @ {{ screen.scaleFactor }}x
          </span>
        </div>
      </div>
    </FieldRow>
  </el-card>
</template>

<style scoped>
.screens {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.screens__item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
}
</style>
