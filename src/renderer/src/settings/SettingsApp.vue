<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import type { AppConfig, Corner, CustomPreset } from '@shared/types'
import { THEME_PRESETS, createDefaultConfig } from '@shared/defaults'
import {
  config,
  loadConfig,
  patchConfig,
  replaceConfig,
  resetConfig
} from '@/composables/useConfig'
import { onSaved } from '@/utils/misc'
import CountdownPreview from '@/components/CountdownPreview.vue'
import PresetGallery from '@/components/PresetGallery.vue'
import type { PresetSaveMode } from '@/components/PresetGallery.vue'
import CountdownList from '@/list/CountdownList.vue'
import TargetPanel from '@/settings/panels/TargetPanel.vue'
import AppearancePanel from '@/settings/panels/AppearancePanel.vue'
import LayoutPanel from '@/settings/panels/LayoutPanel.vue'
import BehaviorPanel from '@/settings/panels/BehaviorPanel.vue'
import IntegrationPanel from '@/settings/panels/IntegrationPanel.vue'
import AboutPanel from '@/settings/panels/AboutPanel.vue'

void loadConfig()

const { t, locale } = useI18n()

const elLocale = computed(() => (config.value.runtime.language === 'en-US' ? en : zhCn))

type SectionId =
  | 'list'
  | 'target'
  | 'appearance'
  | 'behavior'
  | 'integration'
  | 'preset'
  | 'about'

const section = ref<SectionId>('list')

/**
 * 实时预览只对「有外观可看」的页面有意义：
 * 列表页自带逐项信息、预设页本身就是一组预览卡片、系统集成与关于没有可预览的东西。
 */
const showPreview = computed(() =>
  ['target', 'appearance', 'behavior'].includes(section.value)
)

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return raw === '1'
  } catch {
    return fallback
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* 隐私模式下写不进去，不影响使用 */
  }
}

/** 预览侧栏：宽屏默认开，窄屏由 CSS 隐藏；状态只存本地，不写进配置 */
const previewOpen = ref(readBool('cd.settings.preview', true))
watch(previewOpen, (value) => writeBool('cd.settings.preview', value))

interface NavItem {
  id: SectionId
  icon: string
  label: string
  /** 搜索用的同义词，覆盖中文口语与英文关键词 */
  keywords: string
}

interface NavGroup {
  id: string
  label: string
  items: NavItem[]
}

/**
 * 侧栏按「用户要改什么」分四组，而不是按代码模块平铺八项。
 * 折叠后静止状态只占 4 行 + 当前组的两三个子项，比原来一长串更好扫。
 */
const groups = computed<NavGroup[]>(() => [
  {
    id: 'countdown',
    label: t('nav.groupCountdown'),
    items: [
      {
        id: 'list',
        icon: 'List',
        label: t('nav.list'),
        keywords: '列表 倒数日 新建 删除 复制 启用 list countdown new delete copy'
      }
    ]
  },
  {
    id: 'look',
    label: t('nav.groupLook'),
    items: [
      {
        id: 'appearance',
        icon: 'Brush',
        label: t('nav.appearance'),
        keywords: '外观 颜色 字体 背景 阴影 边框 字号 透明度 圆角 appearance color font background shadow'
      },
      {
        /* 日期与文案改的是「卡片上写什么」，和外观同属看得见的那一层 */
        id: 'target',
        icon: 'Calendar',
        label: t('nav.target'),
        keywords: '日期 文案 副标题 状态 过期 显示 星期 target date text hint status weekday'
      },
      {
        id: 'preset',
        icon: 'MagicStick',
        label: t('nav.preset'),
        keywords: '预设 主题 模板 配色 preset theme template'
      }
    ]
  },
  {
    id: 'system',
    label: t('nav.groupSystem'),
    items: [
      {
        id: 'behavior',
        icon: 'SetUp',
        label: t('nav.behavior'),
        keywords:
          '行为 显示模式 单位 置顶 位置 角落 偏移 拖动 穿透 透明 窗口 layout position corner offset drag transparent behavior mode unit top'
      },
      {
        id: 'integration',
        icon: 'Monitor',
        label: t('nav.integration'),
        keywords: '系统 托盘 快捷键 开机 启动 退出 备份 导入 导出 通知 integration tray hotkey startup backup export import notify'
      }
    ]
  }
])

const currentLabel = computed(() => {
  // 「关于」不挂在导航组里（它住在左下角），标题得单独给一个
  if (section.value === 'about') return t('nav.about')
  for (const group of groups.value) {
    const found = group.items.find((item) => item.id === section.value)
    if (found) return found.label
  }
  return ''
})

/* ------------------------------ 侧栏折叠与搜索 ------------------------------ */

const search = ref('')
const searching = computed(() => search.value.trim().length > 0)

/** 展开的组；当前页面所在的组永远展开，避免「选中项看不见」 */
const expanded = reactive(new Set<string>(['countdown']))

function groupHasSection(group: NavGroup): boolean {
  return group.items.some((item) => item.id === section.value)
}

function isExpanded(group: NavGroup): boolean {
  return searching.value || expanded.has(group.id)
}

/**
 * 点组标题 = 展开/收起。
 * 不再强制「当前组永远展开」：那样点自己所在的组会毫无反应，像个坏按钮。
 * 切页面时会自动把目标组加进 expanded（见下面的 watch）。
 */
function toggleGroup(group: NavGroup): void {
  if (expanded.has(group.id)) expanded.delete(group.id)
  else expanded.add(group.id)
}

const filteredGroups = computed<NavGroup[]>(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return groups.value
  return groups.value
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${item.label} ${item.keywords}`.toLowerCase().includes(query)
      )
    }))
    .filter((group) => group.items.length > 0)
})

watch(section, (id) => {
  const group = groups.value.find((entry) => entry.items.some((item) => item.id === id))
  if (group) expanded.add(group.id)
})

/* --------------------------------- 写入与撤销 --------------------------------- */

/**
 * 撤销栈。
 *
 * 全局设置是「改一下立刻落盘」，没有草稿这一步，所以必须能退回去。
 * 快照用整份配置（不是 patch）：patch 是深合并，删掉的字段退不回来。
 *
 * 500ms 内的连续改动合并成一步 —— 拖一次滑块会触发几十次 patch，
 * 否则按一次 Ctrl+Z 只退一个像素，等于没撤销。
 */
const undoStack = ref<string[]>([])
const redoStack = ref<string[]>([])
let lastPushAt = 0

function snapshot(): string {
  return JSON.stringify(config.value)
}

async function patch(patchBody: unknown): Promise<void> {
  const now = Date.now()
  if (now - lastPushAt > 500) {
    undoStack.value.push(snapshot())
    if (undoStack.value.length > 80) undoStack.value.shift()
    redoStack.value = []
  }
  lastPushAt = now
  await patchConfig(patchBody)
}

async function undo(): Promise<void> {
  const previous = undoStack.value.pop()
  if (!previous) {
    ElMessage.info(t('common.undoEmpty'))
    return
  }
  redoStack.value.push(snapshot())
  lastPushAt = 0
  await replaceConfig(JSON.parse(previous) as AppConfig)
  ElMessage.info(t('common.undoDone'))
}

async function redo(): Promise<void> {
  const next = redoStack.value.pop()
  if (!next) return
  undoStack.value.push(snapshot())
  lastPushAt = 0
  await replaceConfig(JSON.parse(next) as AppConfig)
  ElMessage.info(t('common.redoDone'))
}

function isTextTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function onKeydown(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey)) return
  // 输入框里的 Ctrl+Z 交给浏览器处理原生文本撤销，别抢
  if (isTextTarget(event.target)) return
  const key = event.key.toLowerCase()
  if (key === 'z') {
    event.preventDefault()
    void (event.shiftKey ? redo() : undo())
  } else if (key === 'y') {
    event.preventDefault()
    void redo()
  }
}

/** 只恢复当前页面对应的配置片段；比「恢复默认设置」那颗核弹温和得多 */
const resettable = computed(() =>
  ['target', 'appearance', 'behavior', 'integration'].includes(section.value)
)

async function resetPage(): Promise<void> {
  const defaults = createDefaultConfig()
  let body: unknown = null
  let transparencyChanged = false

  switch (section.value) {
    case 'target':
      body = { target: defaults.target, text: defaults.text }
      break
    case 'appearance':
      body = { appearance: defaults.appearance }
      break
    case 'behavior':
      // 这一页现在同时管显示格式与窗口行为，重置也一起收
      transparencyChanged =
        config.value.runtime.window.transparent !== defaults.runtime.window.transparent
      body = { behavior: defaults.behavior, runtime: { window: defaults.runtime.window } }
      break
    case 'integration':
      body = {
        runtime: {
          trayMenu: defaults.runtime.trayMenu,
          notifications: defaults.runtime.notifications
        }
      }
      break
    default:
      return
  }

  await patch(body)
  if (transparencyChanged) {
    await window.cd.setTransparency(defaults.runtime.window.transparent)
  }
  ElMessage.success(t('common.resetPageDone'))
}

/* ---------------------------------- 其余动作 ---------------------------------- */

async function applyPreset(
  appearance: AppConfig['appearance'],
  id: string,
  displayName?: string
): Promise<void> {
  await patch({ appearance })
  const preset = THEME_PRESETS.find((item) => item.id === id)
  const name =
    displayName ||
    (preset
      ? config.value.runtime.language === 'en-US'
        ? preset.nameEn
        : preset.nameZh
      : id)
  ElMessage.success(t('preset.applied', { name }))
}

/**
 * 保存预设。
 *   global：存预设 + 把全局外观覆盖成这一份（这个来源的字面语义就是如此）
 *   item  ：存预设 + 把该倒数日的覆盖改成这一份
 *   manual：**只**存预设。手动调整是在模态框里对着草稿改的，全程不碰全局外观
 */
async function savePreset(payload: {
  name: string
  appearance: AppConfig['appearance']
  saveMode: PresetSaveMode
  itemId: string
  applyAfter?: boolean
}): Promise<void> {
  const preset: CustomPreset = {
    id: `cp_${Date.now().toString(36)}`,
    name: payload.name,
    createdAt: Date.now(),
    appearance: JSON.parse(JSON.stringify(payload.appearance)) as AppConfig['appearance']
  }
  // 顺序很重要：先把外观写进去，再追加预设，避免第二次 patch 覆盖掉第一次的结果
  if (payload.saveMode === 'global') {
    await patch({ appearance: payload.appearance })
  } else if (payload.saveMode === 'item' && payload.itemId) {
    const countdowns = config.value.countdowns.map((item) =>
      item.id === payload.itemId
        ? { ...item, appearance: { ...item.appearance, ...payload.appearance } }
        : item
    )
    await patch({ countdowns })
  }
  // 「保存后立即套用」是显式勾选的，不再让保存动作偷偷改全局
  if (payload.applyAfter && payload.saveMode !== 'global') {
    await patch({ appearance: payload.appearance })
  }
  await patch({ customPresets: [preset, ...config.value.customPresets] })
  ElMessage.success(t('preset.saved', { name: payload.name }))
}

async function renamePreset(id: string, name: string): Promise<void> {
  const customPresets = config.value.customPresets.map((preset) =>
    preset.id === id ? { ...preset, name } : preset
  )
  await patch({ customPresets })
}

async function overwritePreset(id: string, appearance: AppConfig['appearance']): Promise<void> {
  const customPresets = config.value.customPresets.map((preset) =>
    preset.id === id
      ? { ...preset, appearance: JSON.parse(JSON.stringify(appearance)) as AppConfig['appearance'] }
      : preset
  )
  await patch({ customPresets })
}

async function removePreset(id: string): Promise<void> {
  const target = config.value.customPresets.find((item) => item.id === id)
  await patch({ customPresets: config.value.customPresets.filter((item) => item.id !== id) })
  if (target) ElMessage.success(t('preset.removed', { name: target.name }))
}

async function snapCorner(corner: Corner): Promise<void> {
  await window.cd.snapCorner(corner)
}

async function showWidget(): Promise<void> {
  const visible = await window.cd.setWidgetVisible(true)
  if (visible) ElMessage.success(t('tray.show'))
}

async function restoreDefaults(): Promise<void> {
  try {
    await ElMessageBox.confirm(t('common.resetAll'), t('common.reset'), {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      type: 'warning'
    })
    await resetConfig()
    // 恢复默认之后旧的撤销快照已经没有意义（会把用户带回「重置前」的半成品）
    undoStack.value = []
    redoStack.value = []
    lastPushAt = 0
    ElMessage.success(t('common.resetAllDone'))
  } catch {
    /* 用户取消 */
  }
}

/** 「已保存」只在真的写入后短暂出现，不再常驻占位 */
const savedFlash = ref(false)
let savedTimer: number | undefined
let unhookSaved: (() => void) | null = null

onMounted(() => {
  unhookSaved = onSaved(() => {
    savedFlash.value = true
    if (savedTimer) window.clearTimeout(savedTimer)
    savedTimer = window.setTimeout(() => {
      savedFlash.value = false
    }, 1400)
  })
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  unhookSaved?.()
  if (savedTimer) window.clearTimeout(savedTimer)
  window.removeEventListener('keydown', onKeydown)
})

// 主进程可能通过托盘菜单切换语言，这里保持 i18n 同步
watch(
  () => config.value.runtime.language,
  (next) => {
    if (locale.value !== next) locale.value = next
  },
  { immediate: true }
)
</script>

<template>
  <el-config-provider :locale="elLocale" :z-index="3000">
    <div class="settings-shell">
      <aside class="settings-side">
        <div class="settings-brand">
          <span class="settings-brand__logo">CD</span>
          <span class="settings-brand__text">
            <span class="settings-brand__name">{{ t('app.name') }}</span>
            <span class="settings-brand__sub">{{ t('app.subtitle') }}</span>
          </span>
        </div>

        <div class="settings-search">
          <el-input
            v-model="search"
            size="small"
            clearable
            :placeholder="t('nav.searchPlaceholder')"
          >
            <template #prefix>
              <el-icon :size="13"><Search /></el-icon>
            </template>
          </el-input>
        </div>

        <nav class="settings-nav">
          <div v-for="group in filteredGroups" :key="group.id" class="settings-nav__section">
            <button
              class="settings-nav__head"
              :class="{ 'is-open': isExpanded(group), 'is-current': groupHasSection(group) }"
              @click="toggleGroup(group)"
            >
              <span class="settings-nav__head-label">{{ group.label }}</span>
              <el-icon :size="11" class="settings-nav__chevron"><ArrowRight /></el-icon>
            </button>

            <!--
              用 v-show 而不是 v-if：折叠时子项仍留在 DOM 里，
              「按导航文字定位」的自动化脚本不会因为折叠而找不到入口。
            -->
            <div v-show="isExpanded(group)" class="settings-nav__items">
              <button
                v-for="item in group.items"
                :key="item.id"
                class="settings-nav__item"
                :class="{ 'is-active': section === item.id }"
                @click="section = item.id"
              >
                <el-icon :size="15">
                  <component :is="item.icon" />
                </el-icon>
                <span>{{ item.label }}</span>
              </button>
            </div>
          </div>

          <p v-if="!filteredGroups.length" class="settings-nav__empty">{{ t('nav.searchEmpty') }}</p>
        </nav>

        <div class="settings-side__footer">
          <!--
            左下角只放「关于」。
            关闭按钮删掉了（窗口右上角和 Esc 都能关，再摆一个纯占位）；
            恢复默认设置搬进「关于」页 —— 它是低频的重操作，不该在导航栏上天天晾着。
          -->
          <button
            class="settings-nav__item settings-side__about"
            :class="{ 'is-active': section === 'about' }"
            @click="section = 'about'"
          >
            <el-icon :size="15"><InfoFilled /></el-icon>
            <span>{{ t('nav.about') }}</span>
          </button>
        </div>
      </aside>

      <section class="settings-main">
        <header class="settings-topbar">
          <span class="settings-topbar__title">{{ currentLabel }}</span>
          <div class="settings-topbar__actions">
            <transition name="saved-fade">
              <el-tag v-if="savedFlash" size="small" effect="plain" type="success">
                <el-icon><Select /></el-icon>
                <span style="margin-left: 4px">{{ t('common.saved') }}</span>
              </el-tag>
            </transition>
            <el-button size="small" plain :disabled="!undoStack.length" @click="undo">
              <el-icon><RefreshLeft /></el-icon>
              <span style="margin-left: 6px">{{ t('common.undo') }}</span>
            </el-button>
            <el-button size="small" plain :disabled="!resettable" @click="resetPage">
              <el-icon><Refresh /></el-icon>
              <span style="margin-left: 6px">{{ t('common.resetPage') }}</span>
            </el-button>
            <el-button
              size="small"
              plain
              class="settings-topbar__preview"
              :disabled="!showPreview"
              :type="showPreview && previewOpen ? 'primary' : ''"
              @click="previewOpen = !previewOpen"
            >
              <el-icon><View /></el-icon>
              <span style="margin-left: 6px">{{ t('common.previewToggle') }}</span>
            </el-button>
            <el-button size="small" plain @click="showWidget">
              <el-icon><Monitor /></el-icon>
              <span style="margin-left: 6px">{{ t('tray.show') }}</span>
            </el-button>
          </div>
        </header>

        <div class="settings-body">
          <div class="settings-content">
            <CountdownList
              v-if="section === 'list'"
              :config="config"
              @patch="(p: unknown) => patch(p)"
            />
            <TargetPanel
              v-else-if="section === 'target'"
              :config="config"
              @patch="(p: unknown) => patch(p)"
            />
            <AppearancePanel
              v-else-if="section === 'appearance'"
              :config="config"
              @patch="(p: unknown) => patch(p)"
            />
            <div v-else-if="section === 'behavior'" class="panel-stack">
              <BehaviorPanel :config="config" @patch="(p: unknown) => patch(p)" />
              <LayoutPanel
                :config="config"
                @patch="(p: unknown) => patch(p)"
                @snap="snapCorner"
              />
            </div>
            <IntegrationPanel
              v-else-if="section === 'integration'"
              :config="config"
              @patch="(p: unknown) => patch(p)"
            />
            <PresetGallery
              v-else-if="section === 'preset'"
              :config="config"
              :appearance="config.appearance"
              :countdowns="config.countdowns"
              :custom-presets="config.customPresets"
              @apply="applyPreset"
              @save="savePreset"
              @rename="renamePreset"
              @overwrite="overwritePreset"
              @remove="removePreset"
            />
            <AboutPanel
              v-else
              :config="config"
              @patch="(p: unknown) => patch(p)"
              @reset="restoreDefaults"
            />
          </div>

          <aside v-if="showPreview && previewOpen" class="settings-rail">
            <div class="preview-wrap">
              <div class="preview-wrap__label">{{ t('common.preview') }}</div>
              <CountdownPreview :config="config" sample />
            </div>
          </aside>
        </div>
      </section>
    </div>
  </el-config-provider>
</template>

<style scoped>
.preview-wrap {
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  background: var(--el-bg-color);
  overflow: hidden;
}

.preview-wrap__label {
  /* 「实时预览」四个字不能贴着预览容器：留出一行文字的呼吸空间 */
  padding: 10px 14px 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.preview-wrap :deep(.preview) {
  padding: 14px 14px 16px;
}

.saved-fade-enter-active,
.saved-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.saved-fade-enter-from,
.saved-fade-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
</style>
