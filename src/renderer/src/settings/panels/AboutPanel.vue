<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import type { AppConfig, AppLanguage, HostInfo, UpdateState } from '@shared/types'
import { formatBytes, presetIdOf, UPDATE_FEED_PRESETS } from '@shared/update'
import FieldRow from '@/components/FieldRow.vue'

const props = defineProps<{ config: AppConfig }>()
const emit = defineEmits<{
  (event: 'patch', patch: unknown): void
  /** 恢复默认设置：真正的重置逻辑在 SettingsApp（要一并清空撤销栈） */
  (event: 'reset'): void
}>()

const { t } = useI18n()
const host = ref<HostInfo | null>(null)

/* ------------------------------ 在线更新 ------------------------------ */

/**
 * 更新状态全部由主进程持有，这里只镜像一份：
 * 关掉设置窗口再打开，看到的仍然是「上次检查的结果」，不会退回「还没检查过」。
 */
const update = ref<UpdateState>({ phase: 'idle', current: '', feedUrl: '' })
let stopUpdate: (() => void) | null = null

const statusText = computed(() => {
  const state = update.value
  switch (state.phase) {
    case 'disabled':
      return t('about.updateDisabled')
    case 'checking':
      return t('about.updateChecking')
    case 'latest':
      return t('about.updateLatest', { version: state.latest ?? state.current })
    case 'available':
      return t('about.updateAvailable', { version: state.latest ?? '' })
    case 'downloading':
      return t('about.updateDownloading', {
        percent: Math.round((state.progress ?? 0) * 100)
      })
    case 'ready':
      return t('about.updateReady', { version: state.latest ?? '' })
    case 'error':
      return t('about.updateFailed', { error: state.error ?? '' })
    default:
      // 静默检查失败不会把 phase 推进 error，这里补一句软提示
      return state.error
        ? t('about.updateIdleFailed', { error: state.error })
        : t('about.updateIdle')
  }
})

/** 「2026-10-17 发布 · 82.6 MB」，两段都可能缺，缺了就不显示 */
const metaText = computed(() => {
  const state = update.value
  const date = state.releaseDate ? String(state.releaseDate).slice(0, 10) : ''
  const size = formatBytes(state.size)
  if (!date && !size) return ''
  if (date && size) return t('about.updateMeta', { date, size })
  return date || size
})

const percent = computed(() => Math.round((update.value.progress ?? 0) * 100))

async function checkUpdate(): Promise<void> {
  update.value = await window.cd.checkForUpdate()
}

/* ------------------------------ 更新源 ------------------------------ */

/**
 * 更新源直接写 `runtime.update.feedUrl`，主进程监听到变化会把上一次的检查结果清空，
 * 所以换源之后不需要（也不应该）自动开查 —— 用户自己点「检查更新」再走一遍。
 */
const feedUrl = computed(() => String(props.config.runtime.update?.feedUrl ?? '').trim())
const feedChoice = computed(() => presetIdOf(feedUrl.value))
/** 输入框的草稿值：只在失焦 / 回车时落盘，否则每敲一个字符都会重置一次更新状态 */
const feedDraft = ref(feedUrl.value)
const feedInput = ref<{ focus: () => void } | null>(null)

/** 下拉项由预设表生成：以后加镜像只改 shared/update.ts，不用再动模板 */
const feedOptions = computed(() => [
  ...UPDATE_FEED_PRESETS.map((preset) => ({
    value: preset.id as string,
    label: t(`about.feedPresets.${preset.id}`)
  })),
  { value: 'custom', label: t('about.feedCustom') },
  { value: 'off', label: t('about.feedOff') }
])

/** 除官方源以外，预设里的每一项都是第三方转发 */
const mirrorSelected = computed(
  () => feedChoice.value !== 'github' && feedChoice.value !== 'custom' && feedChoice.value !== 'off'
)

watch(feedUrl, (value) => {
  feedDraft.value = value
})

function applyFeed(value: string): void {
  const next = String(value ?? '').trim()
  if (next === feedUrl.value) return
  emit('patch', { runtime: { update: { feedUrl: next } } })
}

function chooseFeed(id: string): void {
  if (id === 'custom') {
    // 「自定义」不是一种源，只是让你接着编辑输入框里那一行
    feedInput.value?.focus()
    return
  }
  const preset = UPDATE_FEED_PRESETS.find((item) => item.id === id)
  if (preset) {
    applyFeed(preset.url)
    return
  }
  applyFeed('')
}

async function downloadUpdate(): Promise<void> {
  update.value = await window.cd.downloadUpdate()
}

async function installUpdate(): Promise<void> {
  await window.cd.installUpdate()
}

/** 检查/下载都不通时的兜底：打开发布页，用户自己下 */
async function openReleasePage(): Promise<void> {
  await window.cd.openUpdatePage()
}

onMounted(async () => {
  host.value = await window.cd.getHostInfo()
  update.value = await window.cd.getUpdateState()
  stopUpdate = window.cd.onUpdateState((state) => {
    update.value = state
  })
})

onBeforeUnmount(() => {
  stopUpdate?.()
  stopUpdate = null
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
  <!--
    软件更新放在第一张卡：进来「关于」的人，除了看版本号，最可能就是想更新。
    文案按 phase 一条条改，不用弹窗 —— 更新是「看着它走完」的过程，不是一次性提示。
  -->
  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span class="panel-card__title">{{ t('about.updateGroup') }}</span>
        <el-tag v-if="update.phase === 'available'" size="small" type="warning" effect="plain">
          {{ t('about.updateBadge') }}
        </el-tag>
        <el-tag v-else-if="update.phase === 'ready'" size="small" type="success" effect="plain">
          {{ t('about.updateBadgeReady') }}
        </el-tag>
      </div>
    </template>

    <div class="update-row">
      <div class="update-row__main">
        <div class="update-row__version">
          <span>{{ t('about.currentVersion') }}</span>
          <span class="mono">{{ update.current || host?.appVersion || '—' }}</span>
        </div>
        <p class="update-row__status" :class="{ 'is-error': update.phase === 'error' }">
          {{ statusText }}
        </p>
        <p v-if="metaText" class="update-row__meta">{{ metaText }}</p>
        <el-progress
          v-if="update.phase === 'downloading'"
          class="update-row__progress"
          :percentage="percent"
          :stroke-width="6"
          :show-text="false"
        />
        <p v-if="update.notes" class="update-row__notes">{{ update.notes }}</p>
        <p v-if="update.phase === 'error'" class="update-row__hint">
          {{ t('about.updateFailHint') }}
        </p>
      </div>

      <div class="update-row__actions">
        <el-button
          size="small"
          plain
          :loading="update.phase === 'checking'"
          :disabled="update.phase === 'downloading'"
          @click="checkUpdate"
        >
          {{ t('about.checkUpdate') }}
        </el-button>
        <el-button
          v-if="update.phase === 'available'"
          size="small"
          type="primary"
          @click="downloadUpdate"
        >
          {{ t('about.downloadUpdate') }}
        </el-button>
        <el-button
          v-else-if="update.phase === 'ready'"
          size="small"
          type="success"
          @click="installUpdate"
        >
          {{ t('about.installUpdate') }}
        </el-button>
        <!-- 检查不通时的兜底出口：让用户自己去发布页下，而不是卡在错误提示上 -->
        <el-button v-else-if="update.phase === 'error'" size="small" @click="openReleasePage">
          {{ t('about.openReleasePage') }}
        </el-button>
      </div>
    </div>

    <!--
      更新源放在状态下面：它是「检查不通时才需要动」的东西，不该跟主按钮抢注意力。
      写死的地址在错误提示里露出来不够用 —— 用户没法自己换一条路。
    -->
    <div class="update-source">
      <div class="update-source__head">
        <span class="update-source__label">{{ t('about.feedLabel') }}</span>
        <el-select
          :model-value="feedChoice"
          size="small"
          class="update-source__select"
          @update:model-value="(v: string | number | boolean | undefined) => chooseFeed(String(v))"
        >
          <el-option
            v-for="option in feedOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>

      <el-input
        v-if="feedChoice !== 'off'"
        ref="feedInput"
        v-model="feedDraft"
        size="small"
        class="update-source__url"
        :placeholder="t('about.feedPlaceholder')"
        @change="applyFeed(feedDraft)"
        @keyup.enter="applyFeed(feedDraft)"
      />

      <p v-if="mirrorSelected" class="update-source__warn">
        {{ t('about.feedMirrorWarning') }}
      </p>
      <p v-else-if="feedChoice === 'custom'" class="update-source__note">
        {{ t('about.feedCustomHint') }}
      </p>
      <p v-else-if="feedChoice === 'off'" class="update-source__note">
        {{ t('about.feedOffHint') }}
      </p>
      <p v-else class="update-source__note">{{ t('about.feedHint') }}</p>
    </div>
  </el-card>

  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span class="panel-card__title">{{ t('about.title') }}</span>
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
/*
 * 更新卡片：左边说明、右边按钮，进度条铺在说明下面。
 * 不用弹窗是因为「检查 → 下载 → 安装」是一条有中间态的链，弹窗一关就看不到进度了。
 */
.update-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.update-row__main {
  min-width: 0;
  flex: 1;
}

.update-row__version {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.update-row__status {
  margin: 4px 0 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
  word-break: break-word;
}

.update-row__status.is-error {
  color: var(--el-color-danger);
}

.update-row__meta {
  margin: 2px 0 0;
  font-size: 11.5px;
  color: var(--el-text-color-secondary);
  opacity: 0.8;
}

.update-row__progress {
  margin-top: 8px;
  max-width: 360px;
}

/* 发布说明最多露三行，长了给省略号：这里不是阅读器 */
.update-row__notes {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
  white-space: pre-line;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 失败时给一条「怎么自救」的提示，比只报错有用 */
.update-row__hint {
  margin: 6px 0 0;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.update-row__actions {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}

.update-row__actions .el-button + .el-button {
  margin-left: 0;
}

/* 更新源：主行下面的一条，用分隔线压住，别和状态文字混成一片 */
.update-source {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.update-source__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.update-source__label {
  flex: none;
  font-size: 12.5px;
  color: var(--el-text-color-regular);
}

.update-source__select {
  width: 190px;
}

.update-source__url {
  margin-top: 8px;
  max-width: 520px;
}

.update-source__url :deep(.el-input__inner) {
  font-family: var(--cd-font-mono, ui-monospace, 'Cascadia Mono', Consolas, monospace);
  font-size: 11.5px;
}

.update-source__note {
  margin: 6px 0 0;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

/* 第三方镜像不是「更快的官方源」，它拿得到你的全部信任，得说清楚 */
.update-source__warn {
  margin: 6px 0 0;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--el-color-warning-dark-2);
}

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
