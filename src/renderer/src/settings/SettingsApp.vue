<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import type { AppConfig, Corner, CustomPreset } from '@shared/types'
import { THEME_PRESETS } from '@shared/defaults'
import { config, loadConfig, patchConfig, resetConfig } from '@/composables/useConfig'
import { onSaved } from '@/utils/misc'
import CountdownPreview from '@/components/CountdownPreview.vue'
import PresetGallery from '@/components/PresetGallery.vue'
import type { PresetSaveTarget } from '@/components/PresetGallery.vue'
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
  | 'layout'
  | 'behavior'
  | 'integration'
  | 'preset'
  | 'about'

const section = ref<SectionId>('list')

/**
 * 实时预览：全局样式页展示「元旦 1 月 1 日」这一份样板，
 * 因此标题与日期都固定，只有外观与文案跟随全局设置。
 * 倒数日列表页有自己的逐项预览，系统集成与关于页没有可预览的东西，都不显示。
 */
const showPreview = computed(
  () => section.value !== 'list' && section.value !== 'integration' && section.value !== 'about'
)

interface NavGroup {
  id: string
  label: string
  items: Array<{ id: SectionId; icon: string; label: string }>
}

const groups = computed<NavGroup[]>(() => [
  {
    id: 'primary',
    label: '',
    items: [{ id: 'list', icon: 'List', label: t('nav.list') }]
  },
  {
    id: 'global',
    label: t('nav.settings'),
    items: [
      { id: 'target', icon: 'Calendar', label: t('nav.target') },
      { id: 'appearance', icon: 'Brush', label: t('nav.appearance') },
      { id: 'layout', icon: 'Grid', label: t('nav.layout') },
      { id: 'behavior', icon: 'SetUp', label: t('nav.behavior') },
      { id: 'preset', icon: 'MagicStick', label: t('nav.preset') },
      { id: 'integration', icon: 'Monitor', label: t('nav.integration') },
      { id: 'about', icon: 'InfoFilled', label: t('nav.about') }
    ]
  }
])

const currentLabel = computed(() => {
  for (const group of groups.value) {
    const found = group.items.find((item) => item.id === section.value)
    if (found) return found.label
  }
  return ''
})

async function patch(patchBody: unknown): Promise<void> {
  await patchConfig(patchBody)
}

async function applyPreset(
  appearance: AppConfig['appearance'],
  id: string,
  displayName?: string
): Promise<void> {
  await patchConfig({ appearance })
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

/** 把当前全局外观存成自定义预设 */
async function savePreset(payload: {
  name: string
  appearance: AppConfig['appearance']
  target: PresetSaveTarget
  itemId: string
  tune: boolean
}): Promise<void> {
  const preset: CustomPreset = {
    id: `cp_${Date.now().toString(36)}`,
    name: payload.name,
    createdAt: Date.now(),
    appearance: JSON.parse(JSON.stringify(payload.appearance)) as AppConfig['appearance']
  }
  // 顺序很重要：先把外观写进去，再追加预设，避免第二次 patch 覆盖掉第一次的结果
  if (payload.target === 'global') {
    await patchConfig({ appearance: payload.appearance })
  } else if (payload.itemId) {
    const countdowns = config.value.countdowns.map((item) =>
      item.id === payload.itemId
        ? { ...item, appearance: { ...item.appearance, ...payload.appearance } }
        : item
    )
    await patchConfig({ countdowns })
  }
  await patchConfig({ customPresets: [preset, ...config.value.customPresets] })
  ElMessage.success(t('preset.saved', { name: payload.name }))
  // 「手动调整所有参数」直接带到外观设置页，方便继续微调
  if (payload.tune) section.value = 'appearance'
}

async function removePreset(id: string): Promise<void> {
  const target = config.value.customPresets.find((item) => item.id === id)
  await patchConfig({ customPresets: config.value.customPresets.filter((item) => item.id !== id) })
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
    location.reload()
  } catch {
    /* 用户取消 */
  }
}

function closeWindow(): void {
  void window.cd.closeSettings()
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
})

onBeforeUnmount(() => {
  unhookSaved?.()
  if (savedTimer) window.clearTimeout(savedTimer)
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

        <nav class="settings-nav">
          <template v-for="group in groups" :key="group.id">
            <div v-if="group.label" class="settings-nav__group">{{ group.label }}</div>
            <button
              v-for="item in group.items"
              :key="item.id"
              class="settings-nav__item"
              :class="{ 'is-active': section === item.id, 'is-primary': group.id === 'primary' }"
              @click="section = item.id"
            >
              <el-icon :size="15">
                <component :is="item.icon" />
              </el-icon>
              <span>{{ item.label }}</span>
            </button>
          </template>
        </nav>

        <div class="settings-side__footer">
          <el-button size="small" plain @click="restoreDefaults">
            <el-icon><RefreshLeft /></el-icon>
            <span style="margin-left: 6px">{{ t('common.resetAll') }}</span>
          </el-button>
          <el-button size="small" @click="closeWindow">
            <el-icon><Close /></el-icon>
            <span style="margin-left: 6px">{{ t('common.close') }}</span>
          </el-button>
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
            <el-button size="small" @click="showWidget">
              <el-icon><View /></el-icon>
              <span style="margin-left: 6px">{{ t('tray.show') }}</span>
            </el-button>
          </div>
        </header>

        <div v-if="showPreview" class="settings-preview">
          <div class="preview-wrap">
            <div class="preview-wrap__label">{{ t('common.preview') }}</div>
            <CountdownPreview :config="config" sample />
          </div>
        </div>

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
            v-else-if="section === 'layout'"
            :config="config"
            @patch="(p: unknown) => patch(p)"
            @snap="snapCorner"
          />
          <BehaviorPanel
            v-else-if="section === 'behavior'"
            :config="config"
            @patch="(p: unknown) => patch(p)"
          />
          <IntegrationPanel
            v-else-if="section === 'integration'"
            :config="config"
            @patch="(p: unknown) => patch(p)"
          />
          <PresetGallery
            v-else-if="section === 'preset'"
            :appearance="config.appearance"
            :text="config.text"
            :countdowns="config.countdowns"
            :custom-presets="config.customPresets"
            @apply="applyPreset"
            @save="savePreset"
            @remove="removePreset"
          />
          <AboutPanel v-else :config="config" @patch="(p: unknown) => patch(p)" />
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
