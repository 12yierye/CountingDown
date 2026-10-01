<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { AppConfig, TrayMenuConfig } from '@shared/types'
import FieldRow from '@/components/FieldRow.vue'

const props = defineProps<{ config: AppConfig }>()
const emit = defineEmits<{ (event: 'patch', patch: unknown): void }>()

const { t } = useI18n()
const recording = ref(false)

/** 托盘右键菜单里可开关的条目，「设置」与「退出」始终保留，所以不在这里 */
const trayItems = computed<Array<{ key: keyof TrayMenuConfig; label: string }>>(() => [
  { key: 'toggleVisible', label: t('integration.trayToggleVisible') },
  { key: 'resetPosition', label: t('integration.trayResetPosition') },
  { key: 'allowDrag', label: t('integration.trayAllowDrag') },
  { key: 'alwaysOnTop', label: t('integration.trayAlwaysOnTop') },
  { key: 'startAtLogin', label: t('integration.trayStartup') },
  { key: 'hotkey', label: t('integration.trayHotkey') }
])

function trayChecked(key: keyof TrayMenuConfig): boolean {
  return props.config.runtime.trayMenu?.[key] !== false
}

function setTrayItem(key: keyof TrayMenuConfig, value: boolean): void {
  emit('patch', { runtime: { trayMenu: { [key]: value } } })
  // 配置变了主进程会重建菜单，这里再显式喊一次，保证切换后立刻能看到效果
  void window.cd.refreshTray()
}

const modifierKeys = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'])

const keyAliases: Record<string, string> = {
  ' ': 'Space',
  Escape: 'Esc',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  '+': 'Plus',
  Scroll_Lock: 'ScrollLock',
  OS: 'Super'
}

function toAccelerator(event: KeyboardEvent): string | null {
  if (modifierKeys.has(event.key)) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Super')

  let key = event.key
  if (keyAliases[key]) key = keyAliases[key]
  if (key.length === 1) key = key.toUpperCase()
  else if (/^F\d{1,2}$/i.test(key)) key = key.toUpperCase()
  else if (key.startsWith('Arrow')) key = key.slice(5)
  else if (key === 'ScrollLock') key = 'ScrollLock'
  parts.push(key)
  return parts.join('+')
}

async function applyHotkey(accelerator: string): Promise<void> {
  const result = await window.cd.setHotkey(accelerator)
  emit('patch', { runtime: { toggleHotkey: result.hotkey } })
  if (!accelerator) return
  if (result.ok) ElMessage.success(t('integration.hotkeyOk', { key: accelerator }))
  else ElMessage.error(t('integration.hotkeyFailed', { key: accelerator }))
}

async function onKeydown(event: KeyboardEvent): Promise<void> {
  if (!recording.value) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') {
    recording.value = false
    return
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    recording.value = false
    await applyHotkey('')
    return
  }
  const accelerator = toAccelerator(event)
  if (!accelerator) return
  recording.value = false
  await applyHotkey(accelerator)
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
})

async function clearHotkey(): Promise<void> {
  await applyHotkey('')
}

async function onStartupChange(value: boolean): Promise<void> {
  const actual = await window.cd.setStartAtLogin(value)
  emit('patch', { runtime: { startAtLogin: actual } })
  if (value && actual !== value) {
    ElMessage.warning(t('integration.startupHint'))
  }
}

async function quitApp(): Promise<void> {
  try {
    await ElMessageBox.confirm(t('integration.quitHint'), t('integration.quit'), {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      type: 'warning'
    })
    await window.cd.quitApp()
  } catch {
    /* 用户取消 */
  }
}

async function openConfigFolder(): Promise<void> {
  const path = await window.cd.openConfigFile()
  if (path) ElMessage.warning(path)
}
</script>

<template>
  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span class="panel-card__title">
          {{ t('integration.tray') }}
          <el-tooltip :content="t('integration.trayHint')" placement="top" :show-after="150">
            <span class="panel-card__help" tabindex="0">
              <el-icon :size="13"><QuestionFilled /></el-icon>
            </span>
          </el-tooltip>
        </span>
      </div>
    </template>
    <p class="tray-info">
      <span class="tray-info__dot"></span>
      <span>{{ t('integration.trayHint') }}</span>
    </p>

    <el-divider content-position="left">
      <span class="divider-title">
        {{ t('integration.trayMenu') }}
        <el-tooltip :content="t('integration.trayMenuHint')" placement="top" :show-after="150">
          <span class="panel-card__help" tabindex="0">
            <el-icon :size="13"><QuestionFilled /></el-icon>
          </span>
        </el-tooltip>
      </span>
    </el-divider>

    <div class="tray-menu-grid">
      <div v-for="item in trayItems" :key="item.key" class="tray-menu-item">
        <el-checkbox
          :model-value="trayChecked(item.key)"
          @update:model-value="(v: string | number | boolean) => setTrayItem(item.key, Boolean(v))"
        >
          {{ item.label }}
        </el-checkbox>
      </div>
    </div>
  </el-card>

  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span class="panel-card__title">
          {{ t('integration.hotkey') }}
          <el-tooltip :content="t('integration.hotkeyHint')" placement="top" :show-after="150">
            <span class="panel-card__help" tabindex="0">
              <el-icon :size="13"><QuestionFilled /></el-icon>
            </span>
          </el-tooltip>
        </span>
      </div>
    </template>

    <FieldRow :label="t('integration.hotkey')" :hint="t('integration.hotkeyHint')">
      <div class="hotkey">        <div
          class="hotkey__display"
          :class="{ 'is-recording': recording }"
          tabindex="0"
          @click="recording = !recording"
        >
          <template v-if="recording">{{ t('integration.hotkeyRecording') }}</template>
          <template v-else-if="config.runtime.toggleHotkey">
            <span class="hotkey__keys">
              <kbd v-for="part in config.runtime.toggleHotkey.split('+')" :key="part">{{ part }}</kbd>
            </span>
          </template>
          <template v-else>{{ t('integration.hotkeyEmpty') }}</template>
        </div>
        <el-button size="small" :type="recording ? 'danger' : 'primary'" plain @click="recording = !recording">
          {{ recording ? t('common.cancel') : t('integration.hotkeyRecord') }}
        </el-button>
        <el-button size="small" plain @click="clearHotkey">{{ t('integration.hotkeyClear') }}</el-button>
      </div>
    </FieldRow>
  </el-card>

  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span>{{ t('nav.integration') }}</span>
      </div>
    </template>

    <FieldRow :label="t('integration.startup')" :hint="t('integration.startupHint')">
      <el-switch
        :model-value="config.runtime.startAtLogin"
        @update:model-value="(v: string | number | boolean) => onStartupChange(Boolean(v))"
      />
    </FieldRow>

    <FieldRow :label="t('integration.configFile')">
      <el-button size="small" plain @click="openConfigFolder">
        {{ t('integration.configFile') }}
      </el-button>
    </FieldRow>

    <FieldRow :label="t('integration.quit')" :hint="t('integration.quitHint')">
      <el-button size="small" type="danger" plain @click="quitApp">
        {{ t('integration.quit') }}
      </el-button>
    </FieldRow>
  </el-card>
</template>

<style scoped>
.divider-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.tray-menu-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 2px 20px;
}

.tray-menu-item {
  min-height: 32px;
  display: flex;
  align-items: center;
}

.tray-info {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.tray-info__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-success);
  margin-top: 5px;
  flex: none;
}

.hotkey {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.hotkey__display {
  min-width: 220px;
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px dashed var(--el-border-color);
  background: var(--el-fill-color-lighter);
  font-size: 13px;
  color: var(--el-text-color-regular);
  cursor: pointer;
  outline: none;
}

.hotkey__display.is-recording {
  border-color: var(--el-color-primary);
  border-style: solid;
  color: var(--el-color-primary);
}

.hotkey__keys {
  display: inline-flex;
  gap: 6px;
}

.hotkey__keys kbd {
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 12px;
  box-shadow: 0 1px 0 var(--el-border-color);
}
</style>
