<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import type { AppConfig, Corner, CountdownItem, CustomPreset } from '@shared/types'
import { BUILTIN_TEXT, THEME_PRESETS, createCountdownItem, createDefaultConfig, findActiveItem } from '@shared/defaults'
import {
  config,
  loadConfig,
  patchConfig,
  replaceConfig,
  resetConfig,
  toPlain
} from '@/composables/useConfig'
import PresetGallery from '@/components/PresetGallery.vue'
import type { PresetSaveMode } from '@/components/PresetGallery.vue'
import CountdownList from '@/list/CountdownList.vue'
import appIconUrl from '../../../../resources/icon.png'
import TargetPanel from '@/settings/panels/TargetPanel.vue'
import AppearancePanel from '@/settings/panels/AppearancePanel.vue'
import LayoutPanel from '@/settings/panels/LayoutPanel.vue'
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
 * 实时预览不画在设置窗口里 —— 真正在预览的就是桌面那张卡片本身。
 *
 *   外观页：卡片切成固定样例（元旦 + 内置文案），判断颜色字号时不被自己的文案干扰；
 *   文案与显示页：同样用元旦当标题，但文案留空跟随全局，正好实时反映正在改的内容；
 *   其余页面不覆盖，桌面卡片保持用户自己那一项。
 */
function buildPreviewItem(): CountdownItem | null {
  if (section.value !== 'appearance' && section.value !== 'target') return null
  const active = findActiveItem(config.value)
  // main/preview.ts 只把草稿套给「当前显示项」，没有可显示的项就无从预览
  if (!active) return null
  const empty = createCountdownItem()
  return {
    ...empty,
    id: active.id,
    name: t('sample.title'),
    target: { mode: 'annual', date: '', month: 1, day: 1 },
    text:
      section.value === 'target'
        ? empty.text
        : {
            ...empty.text,
            hint: BUILTIN_TEXT.hint,
            futureText: BUILTIN_TEXT.futureText,
            todayText: BUILTIN_TEXT.todayText,
            pastText: BUILTIN_TEXT.pastText
          }
  }
}

/**
 * 只在「换了页面 / 换了显示项 / 换了语言」时重推一次。
 * 不要 watch 整个 config：拖一次滑条会 patch 十几次，每次都发一条 IPC 属于浪费，
 * 而配置本身的变化桌面卡片本来就会跟着重渲染。
 */
function syncPreview(): void {
  const item = buildPreviewItem()
  void window.cd.setPreviewItem(item ? toPlain(item) : null)
}

watch(
  [() => section.value, () => config.value.activeId, () => locale.value],
  syncPreview,
  { immediate: true }
)

/*
 * 设置窗口隐藏时主进程会丢掉覆盖层（避免桌面卡片停在未保存的草稿上），
 * 重新显示时它会发一条 preview:sync —— 这里补发一次，否则回到外观页看不到预览。
 * 编辑页也订阅同一个事件并在之后补发自己的草稿，所以列表页不会被打断。
 */
const unsubscribePreviewSync = window.cd.onPreviewSync(() => syncPreview())

onBeforeUnmount(() => {
  unsubscribePreviewSync()
  void window.cd.setPreviewItem(null)
})

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
        /* 日期归每一项自己管，这一页改的是「卡片上写什么」 */
        id: 'target',
        icon: 'Calendar',
        label: t('nav.target'),
        keywords: '文案 副标题 状态 过期 显示 单位 星期 text hint status weekday unit'
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
          '窗口 位置 角落 偏移 拖动 穿透 透明 置顶 桌面 layout position corner offset drag transparent always-on-top window'
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

/* ------------------------------ 侧栏搜索 ------------------------------ */

const search = ref('')

/** 当前页面属于哪一组：只用来给组标题加一点对比度，不做折叠 */
function groupHasSection(group: NavGroup): boolean {
  return group.items.some((item) => item.id === section.value)
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
      body = { text: defaults.text }
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

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
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
          <!--
            用真实的应用图标，不再是一块写着「CD」的色块：
            任务栏、开始菜单、安装包和设置界面里的标识必须是同一个。
          -->
          <img class="settings-brand__logo" :src="appIconUrl" alt="" draggable="false" />
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
            <p
              class="settings-nav__head"
              :class="{ 'is-current': groupHasSection(group) }"
            >
              {{ group.label }}
            </p>

            <div class="settings-nav__items">
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
            <!-- 当前页没有可撤销的改动就不显示，而不是摆一颗灰按钮占位 -->
            <el-button v-if="undoStack.length" size="small" plain @click="undo">
              <el-icon><RefreshLeft /></el-icon>
              <span style="margin-left: 6px">{{ t('common.undo') }}</span>
            </el-button>
            <el-button v-if="resettable" size="small" plain @click="resetPage">
              <el-icon><Refresh /></el-icon>
              <span style="margin-left: 6px">{{ t('common.resetPage') }}</span>
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
            <LayoutPanel
              v-else-if="section === 'behavior'"
              :config="config"
              @patch="(p: unknown) => patch(p)"
              @snap="snapCorner"
            />
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

        </div>
      </section>
    </div>
  </el-config-provider>
</template>
