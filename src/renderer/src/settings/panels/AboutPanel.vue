<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import type { AppConfig, AppLanguage, HostInfo } from '@shared/types'
import FieldRow from '@/components/FieldRow.vue'

defineProps<{ config: AppConfig }>()
const emit = defineEmits<{
  (event: 'patch', patch: unknown): void
  /** 恢复默认设置：真正的重置逻辑在 SettingsApp（要一并清空撤销栈） */
  (event: 'reset'): void
}>()

const { t } = useI18n()
const host = ref<HostInfo | null>(null)

onMounted(async () => {
  host.value = await window.cd.getHostInfo()
})

function setLanguage(language: AppLanguage): void {
  emit('patch', { runtime: { language } })
}

/**
 * 彻底退出。
 * 从「系统」搬到这里：那是配置类开关，这是「结束整个进程」——
 * 语义上属于「关于这个程序」，而且放远处才不容易手滑点到。
 */
async function quitApp(): Promise<void> {
  try {
    await ElMessageBox.confirm(t('about.quitHint'), t('about.quit'), {
      confirmButtonText: t('about.quit'),
      cancelButtonText: t('common.cancel'),
      type: 'warning'
    })
    await window.cd.quitApp()
  } catch {
    /* 用户取消 */
  }
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

  <!-- 恢复默认设置：低频重操作，收在「关于」里，别在导航栏上天天晾着 -->
  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span class="panel-card__title">{{ t('about.resetGroup') }}</span>
      </div>
    </template>

    <div class="danger-row">
      <p class="danger-row__text">{{ t('about.resetHint') }}</p>
      <el-button size="small" type="danger" plain @click="emit('reset')">
        {{ t('common.resetAll') }}
      </el-button>
    </div>
  </el-card>

  <!-- 彻底退出：结束进程，不倒计时、不留托盘；放在「关于」里，离日常设置远一点 -->
  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span class="panel-card__title">{{ t('about.quitGroup') }}</span>
      </div>
    </template>

    <div class="danger-row">
      <p class="danger-row__text">{{ t('about.quitHint') }}</p>
      <el-button size="small" type="danger" plain @click="quitApp">
        {{ t('about.quit') }}
      </el-button>
    </div>
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

/*
 * 危险操作行：左边一句后果说明、右边一个按钮。
 * 比 FieldRow 的「标签 + 问号 tooltip」更适合这种必须让人看清后果的操作 ——
 * 说明直接摆出来，不用悬停才看见。
 */
.danger-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.danger-row__text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.danger-row .el-button {
  flex: none;
}
</style>
