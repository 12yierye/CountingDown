<script setup lang="ts">
/**
 * 首次启动引导。
 *
 * 设计上有两条硬要求：
 *   1. 每一步都直接写配置 —— 没有「最后统一保存」，中途关窗口也不会白填；
 *   2. 挑外观时看到的是**真实卡片**（复用桌面组件那一份模板），不是画出来的示意图。
 *
 * 窗口是无边框的，标题栏的拖动区域靠 CSS 的 -webkit-app-region 声明。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import type { AppLanguage, Corner, TargetConfig } from '@shared/types'
import { THEME_PRESETS, createDefaultConfig, pad2 } from '@shared/defaults'
import { config, loadConfig, patchConfig } from '@/composables/useConfig'
import CardPreview from '@/onboarding/components/CardPreview.vue'
import SidebarTourVideo from '@/onboarding/components/SidebarTourVideo.vue'
import appIconUrl from '../../../../resources/icon.png'

void loadConfig()

const { t, locale } = useI18n()

const elLocale = computed(() => (config.value.runtime.language === 'en-US' ? en : zhCn))

/* -------------------------------- 步骤 -------------------------------- */

const steps = [
  { id: 'welcome', label: 'onboarding.steps.welcome' },
  { id: 'countdown', label: 'onboarding.steps.countdown' },
  { id: 'look', label: 'onboarding.steps.look' },
  { id: 'place', label: 'onboarding.steps.place' },
  { id: 'tour', label: 'onboarding.steps.tour' },
  { id: 'done', label: 'onboarding.steps.done' }
] as const

type StepId = (typeof steps)[number]['id']

const stepIndex = ref(0)
const step = computed<StepId>(() => steps[stepIndex.value].id)
const isLast = computed(() => stepIndex.value === steps.length - 1)
const primaryText = computed(() => {
  if (isLast.value) return t('onboarding.finish')
  return stepIndex.value === 0 ? t('onboarding.start') : t('onboarding.next')
})

async function next(): Promise<void> {
  if (step.value === 'countdown') await commitDraft()
  if (isLast.value) {
    await finish(false)
    return
  }
  stepIndex.value = Math.min(steps.length - 1, stepIndex.value + 1)
}

function back(): void {
  stepIndex.value = Math.max(0, stepIndex.value - 1)
}

async function finish(openSettings: boolean): Promise<void> {
  await window.cd.finishOnboarding({ openSettings })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') void finish(false)
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

/* -------------------------------- 语言 -------------------------------- */

function setLanguage(language: AppLanguage): void {
  // 点的是当前语言就什么都不做：少一次无意义的写盘与广播
  if (config.value.runtime.language === language) return
  // 先切本地 locale，标题即时变；落盘随后就到，不落盘下次启动会回到旧语言
  locale.value = language
  void patchConfig({ runtime: { language } })
}

/* ------------------------------ 第一个倒数日 ------------------------------ */

const activeItem = computed(
  () =>
    config.value.countdowns.find((item) => item.id === config.value.activeId) ??
    config.value.countdowns[0] ??
    null
)

const draftName = ref('')
const draftDate = ref('')
const draftAnnual = ref(true)
let draftItemId = ''
let commitTimer: number | undefined

/**
 * 进入这一步时草稿的原值。
 *
 * 「一直点下一步、什么都没改」必须一个字节都不写盘。只比对归一化后的配置不够
 * （名称为空会被兜底成「未命名倒数日」，那也算一次改动），所以这里记下原始草稿，
 * 三项全等就直接 return。
 */
let draftBase = { name: '', date: '', annual: true }

/** annual 模式只用月/日，但日期选择器需要一个完整日期；年份填当年即可 */
function targetDateInput(target: TargetConfig | undefined): string {
  if (!target) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(target.date ?? '')) return target.date.slice(0, 10)
  const year = new Date().getFullYear()
  return `${year}-${pad2(target.month)}-${pad2(target.day)}`
}

/*
 * 只在「换了一项」时回填草稿。
 * 不能跟着 config 一起刷新 —— 每次 patch 都会广播新配置，那样会把正在输入的字覆盖掉。
 */
watch(
  activeItem,
  (item) => {
    if (!item || item.id === draftItemId) return
    draftItemId = item.id
    draftName.value = item.name
    draftDate.value = targetDateInput(item.target)
    draftAnnual.value = item.target.mode === 'annual'
    draftBase = {
      name: draftName.value,
      date: draftDate.value,
      annual: draftAnnual.value
    }
  },
  { immediate: true }
)

async function commitDraft(): Promise<void> {
  if (commitTimer) {
    window.clearTimeout(commitTimer)
    commitTimer = undefined
  }
  const item = activeItem.value
  if (!item) return

  // 草稿跟进来时一模一样：用户没做过选择，不要写盘
  const untouched =
    draftName.value === draftBase.name &&
    draftDate.value === draftBase.date &&
    draftAnnual.value === draftBase.annual
  if (untouched) return

  const value = draftDate.value
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return

  const [year, month, day] = value.split('-').map(Number)
  const target: TargetConfig = {
    mode: draftAnnual.value ? 'annual' : 'once',
    // 每年重复时年份没有意义，但保留完整日期能让「关掉每年重复」立刻回到同一天
    date: draftAnnual.value ? `${year}-${pad2(month)}-${pad2(day)}` : value,
    month,
    day
  }
  const name = draftName.value.trim() || t('editor.unnamed')
  const countdowns = config.value.countdowns.map((entry) =>
    entry.id === item.id ? { ...entry, name, target } : entry
  )
  await patchConfig({ countdowns })
  // 写完之后把基线挪到刚写进去的值，避免下一次「下一步」再写一遍
  draftBase = { name: draftName.value, date: value, annual: draftAnnual.value }
}

/** 输入名称时不要每敲一个字就写一次盘 */
function scheduleCommit(): void {
  if (commitTimer) window.clearTimeout(commitTimer)
  commitTimer = window.setTimeout(() => {
    commitTimer = undefined
    void commitDraft()
  }, 320)
}

/* -------------------------------- 外观 -------------------------------- */

const presetTiles = computed(() =>
  THEME_PRESETS.map((preset) => ({
    id: preset.id,
    name: locale.value === 'en-US' ? preset.nameEn : preset.nameZh,
    appearance: preset.appearance
  }))
)

/** 与「出厂默认外观」完全一致时用 default 这个虚拟 id */
const DEFAULT_LOOK = 'default'
/** 既不是默认、也对不上任何预设：用户自己调过的外观 */
const CUSTOM_LOOK = 'custom'

const defaultAppearance = computed(() => createDefaultConfig().appearance)

function sameAppearance(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const activeLook = computed(() => {
  if (sameAppearance(config.value.appearance, defaultAppearance.value)) return DEFAULT_LOOK
  const hit = presetTiles.value.find((tile) => sameAppearance(tile.appearance, config.value.appearance))
  return hit ? hit.id : CUSTOM_LOOK
})

/**
 * 只在用户真的点了某一块时才写外观。
 * CUSTOM_LOOK 没有对应的外观对象，走不到 patch —— 也就是说「自定义」只是一个状态显示，
 * 点它不会把用户自己调的那套覆盖掉。
 */
async function applyLook(id: string): Promise<void> {
  const appearance =
    id === DEFAULT_LOOK
      ? defaultAppearance.value
      : presetTiles.value.find((tile) => tile.id === id)?.appearance
  if (!appearance) return
  if (sameAppearance(appearance, config.value.appearance)) return
  await patchConfig({ appearance })
}

const lookName = computed(() => {
  if (activeLook.value === DEFAULT_LOOK) return t('onboarding.look.defaultLook')
  if (activeLook.value === CUSTOM_LOOK) return t('onboarding.look.customLook')
  return presetTiles.value.find((tile) => tile.id === activeLook.value)?.name ?? t('onboarding.look.customLook')
})

/* -------------------------------- 位置 -------------------------------- */

const corners: Array<{ value: Corner; label: string }> = [
  { value: 'top-left', label: 'layout.topLeft' },
  { value: 'top-right', label: 'layout.topRight' },
  { value: 'bottom-left', label: 'layout.bottomLeft' },
  { value: 'bottom-right', label: 'layout.bottomRight' }
]

const corner = computed(() =>
  config.value.runtime.window.corner === 'custom'
    ? config.value.runtime.window.cornerPreset
    : config.value.runtime.window.corner
)

async function pickCorner(value: Corner): Promise<void> {
  // 点的是已经选中的那个角：什么也不做。
  // snapCorner 会把偏移量归零，而用户此刻只是「看了一眼」—— 那不该算一次修改。
  const win = config.value.runtime.window
  if (win.corner === value && win.cornerPreset === value) return
  // snapCorner 会写角落 + 把偏移归零 + 立刻重摆窗口，是「选角落」唯一正确的入口
  await window.cd.snapCorner(value)
}

const startAtLogin = computed(() => config.value.runtime.startAtLogin)

async function toggleStartAtLogin(value: boolean): Promise<void> {
  await window.cd.setStartAtLogin(value)
}

const hotkey = computed(() => config.value.runtime.toggleHotkey || t('integration.hotkeyEmpty'))

/* -------------------------------- 汇总 -------------------------------- */

const firstItemName = computed(() => activeItem.value?.name || t('editor.unnamed'))
const firstItemDate = computed(() => {
  const target = activeItem.value?.target
  if (!target) return '—'
  if (target.mode === 'once') return target.date.slice(0, 10) || '—'
  return locale.value === 'en-US'
    ? `${target.month}/${target.day} · yearly`
    : `${target.month} 月 ${target.day} 日 · 每年`
})
const cornerLabel = computed(
  () => corners.find((entry) => entry.value === corner.value)?.label ?? 'layout.topRight'
)
</script>

<template>
  <el-config-provider :locale="elLocale" :z-index="3000">
    <div class="ob-shell">
      <header class="ob-head">
        <img class="ob-head__logo" :src="appIconUrl" alt="" draggable="false" />
        <span class="ob-head__title">{{ t('onboarding.brand') }}</span>
        <span class="ob-head__step">
          {{ t('onboarding.stepOf', { current: stepIndex + 1, total: steps.length }) }}
        </span>
        <button class="ob-head__close" type="button" :title="t('onboarding.close')" @click="finish(false)">
          <el-icon :size="15"><Close /></el-icon>
        </button>
      </header>

      <div class="ob-body">
        <aside class="ob-rail">
          <div
            v-for="(entry, index) in steps"
            :key="entry.id"
            class="ob-rail__item"
            :class="{
              'is-active': index === stepIndex,
              'is-done': index < stepIndex
            }"
          >
            <span class="ob-rail__dot">
              <el-icon v-if="index < stepIndex" :size="11"><Check /></el-icon>
              <template v-else>{{ index + 1 }}</template>
            </span>
            <span>{{ t(entry.label) }}</span>
          </div>

          <p class="ob-rail__foot">{{ t('onboarding.railFoot') }}</p>
        </aside>

        <section class="ob-panel">
          <!-- ------------------------------ 欢迎 ------------------------------ -->
          <div v-if="step === 'welcome'" class="ob-step">
            <div class="ob-hero">
              <img class="ob-hero__logo" :src="appIconUrl" alt="" draggable="false" />
              <div class="ob-hero__text">
                <h1 class="ob-title">{{ t('onboarding.welcome.title') }}</h1>
                <p class="ob-lead">{{ t('onboarding.welcome.lead') }}</p>
              </div>
            </div>

            <div class="ob-card">
              <div class="ob-label" style="margin-bottom: 8px">{{ t('onboarding.welcome.language') }}</div>
              <div class="ob-langs">
                <button
                  class="ob-lang"
                  :class="{ 'is-active': config.runtime.language === 'zh-CN' }"
                  type="button"
                  @click="setLanguage('zh-CN')"
                >
                  <span>简体中文</span>
                  <span class="ob-lang__tag">zh-CN</span>
                </button>
                <button
                  class="ob-lang"
                  :class="{ 'is-active': config.runtime.language === 'en-US' }"
                  type="button"
                  @click="setLanguage('en-US')"
                >
                  <span>English</span>
                  <span class="ob-lang__tag">en-US</span>
                </button>
              </div>
              <p class="ob-hint" style="margin-top: 8px">{{ t('onboarding.welcome.languageHint') }}</p>
            </div>

            <div class="ob-points">
              <div class="ob-point">
                <span class="ob-point__dot"></span>
                <span>{{ t('onboarding.welcome.point1') }}</span>
              </div>
              <div class="ob-point">
                <span class="ob-point__dot"></span>
                <span>{{ t('onboarding.welcome.point2') }}</span>
              </div>
              <div class="ob-point">
                <span class="ob-point__dot"></span>
                <span>{{ t('onboarding.welcome.point3') }}</span>
              </div>
            </div>
          </div>

          <!-- ----------------------------- 倒数日 ----------------------------- -->
          <div v-else-if="step === 'countdown'" class="ob-step">
            <h1 class="ob-title">{{ t('onboarding.countdown.title') }}</h1>
            <p class="ob-lead">{{ t('onboarding.countdown.lead') }}</p>

            <div class="ob-split">
              <div class="ob-split__main">
                <div class="ob-form-row">
                  <div class="ob-form-row__head">
                    <span class="ob-label">{{ t('onboarding.countdown.name') }}</span>
                  </div>
                  <el-input
                    v-model="draftName"
                    :placeholder="t('editor.namePlaceholder')"
                    maxlength="24"
                    @input="scheduleCommit"
                    @blur="commitDraft"
                    @keyup.enter="commitDraft"
                  />
                </div>

                <div class="ob-form-row">
                  <div class="ob-form-row__head">
                    <span class="ob-label">{{ t('onboarding.countdown.date') }}</span>
                  </div>
                  <el-date-picker
                    v-model="draftDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    :clearable="false"
                    :editable="false"
                    style="width: 100%"
                    @change="commitDraft"
                  />
                </div>

                <div class="ob-card" style="padding: 12px 14px">
                  <div class="ob-switch-row">
                    <div class="ob-switch-row__text">
                      <div class="ob-switch-row__title">{{ t('onboarding.countdown.annual') }}</div>
                      <p class="ob-switch-row__hint">{{ t('onboarding.countdown.annualHint') }}</p>
                    </div>
                    <el-switch v-model="draftAnnual" @change="commitDraft" />
                  </div>
                </div>

                <div class="ob-note">{{ t('onboarding.countdown.moreItems') }}</div>
              </div>

              <div class="ob-split__side">
                <span class="ob-label">{{ t('onboarding.countdown.preview') }}</span>
                <CardPreview :config="config" />
              </div>
            </div>
          </div>

          <!-- ------------------------------ 外观 ------------------------------ -->
          <div v-else-if="step === 'look'" class="ob-step">
            <h1 class="ob-title">{{ t('onboarding.look.title') }}</h1>
            <p class="ob-lead">{{ t('onboarding.look.lead') }}</p>

            <div class="ob-split">
              <div class="ob-split__main">
                <div class="ob-presets">
                  <!--
                    自定义外观：仅当用户当前这套既不是默认、也不是任何内置预设时出现。
                    它只是一块「当前状态」的显示，不是按钮 —— 点它不会覆盖用户自己调好的外观。
                  -->
                  <div
                    v-if="activeLook === CUSTOM_LOOK"
                    class="ob-preset is-active is-static"
                    :title="t('onboarding.look.customHint')"
                  >
                    <span
                      class="ob-preset__swatch"
                      :style="{ background: config.appearance.background.color }"
                    >
                      <span class="ob-preset__num" :style="{ color: config.appearance.count.color }">27</span>
                      <span class="ob-preset__cap" :style="{ color: config.appearance.title.color }">DAYS</span>
                    </span>
                    <span class="ob-preset__name">{{ t('onboarding.look.customLook') }}</span>
                  </div>

                  <button
                    class="ob-preset"
                    :class="{ 'is-active': activeLook === DEFAULT_LOOK }"
                    type="button"
                    @click="applyLook(DEFAULT_LOOK)"
                  >
                    <span class="ob-preset__swatch" :style="{ background: defaultAppearance.background.color }">
                      <span class="ob-preset__num" :style="{ color: defaultAppearance.count.color }">27</span>
                      <span class="ob-preset__cap" :style="{ color: defaultAppearance.title.color }">DAYS</span>
                    </span>
                    <span class="ob-preset__name">{{ t('onboarding.look.defaultLook') }}</span>
                  </button>

                  <button
                    v-for="tile in presetTiles"
                    :key="tile.id"
                    class="ob-preset"
                    :class="{ 'is-active': activeLook === tile.id }"
                    type="button"
                    @click="applyLook(tile.id)"
                  >
                    <span class="ob-preset__swatch" :style="{ background: tile.appearance.background.color }">
                      <span class="ob-preset__num" :style="{ color: tile.appearance.count.color }">27</span>
                      <span class="ob-preset__cap" :style="{ color: tile.appearance.title.color }">DAYS</span>
                    </span>
                    <span class="ob-preset__name">{{ tile.name }}</span>
                  </button>
                </div>

                <p v-if="activeLook === CUSTOM_LOOK" class="ob-hint">
                  {{ t('onboarding.look.customHint') }}
                </p>

                <div class="ob-note">{{ t('onboarding.look.note') }}</div>
              </div>

              <div class="ob-split__side">
                <span class="ob-label">{{ t('onboarding.countdown.preview') }}</span>
                <CardPreview :config="config" />
              </div>
            </div>
          </div>

          <!-- ------------------------------ 位置 ------------------------------ -->
          <div v-else-if="step === 'place'" class="ob-step">
            <h1 class="ob-title">{{ t('onboarding.place.title') }}</h1>
            <p class="ob-lead">{{ t('onboarding.place.lead') }}</p>

            <div class="ob-corners">
              <button
                v-for="entry in corners"
                :key="entry.value"
                class="ob-corner"
                :class="{ 'is-active': corner === entry.value }"
                type="button"
                @click="pickCorner(entry.value)"
              >
                <span class="ob-corner__screen" :data-corner="entry.value">
                  <span class="ob-corner__chip"></span>
                </span>
                <span class="ob-corner__name">{{ t(entry.label) }}</span>
              </button>
            </div>

            <div class="ob-card">
              <div class="ob-switch-row">
                <div class="ob-switch-row__text">
                  <div class="ob-switch-row__title">{{ t('onboarding.place.autostart') }}</div>
                  <p class="ob-switch-row__hint">{{ t('onboarding.place.autostartHint') }}</p>
                </div>
                <el-switch :model-value="startAtLogin" @update:model-value="toggleStartAtLogin" />
              </div>

              <div class="ob-switch-row" style="margin-top: 14px">
                <div class="ob-switch-row__text">
                  <div class="ob-switch-row__title">{{ t('onboarding.place.hotkey') }}</div>
                  <p class="ob-switch-row__hint">{{ t('onboarding.place.hotkeyHint') }}</p>
                </div>
                <span class="ob-kbd">{{ hotkey }}</span>
              </div>
            </div>
          </div>

          <!-- ------------------------------ 演示 ------------------------------ -->
          <div v-else-if="step === 'tour'" class="ob-step">
            <h1 class="ob-title">{{ t('onboarding.tour.title') }}</h1>
            <p class="ob-lead">{{ t('onboarding.tour.lead') }}</p>

            <SidebarTourVideo />

            <div class="ob-points">
              <div class="ob-point">
                <span class="ob-point__dot"></span>
                <span>{{ t('onboarding.tour.point1') }}</span>
              </div>
              <div class="ob-point">
                <span class="ob-point__dot"></span>
                <span>{{ t('onboarding.tour.point2') }}</span>
              </div>
            </div>
          </div>

          <!-- ------------------------------ 完成 ------------------------------ -->
          <div v-else class="ob-step">
            <h1 class="ob-title">{{ t('onboarding.done.title') }}</h1>
            <p class="ob-lead">{{ t('onboarding.done.lead') }}</p>

            <div class="ob-split">
              <div class="ob-split__main">
                <div class="ob-card">
                  <div class="ob-summary">
                    <div class="ob-summary__row">
                      <span class="ob-summary__key">{{ t('onboarding.done.language') }}</span>
                      <span class="ob-summary__value">
                        {{ config.runtime.language === 'en-US' ? 'English' : '简体中文' }}
                      </span>
                      <span class="ob-summary__check"><el-icon :size="13"><Check /></el-icon></span>
                    </div>
                    <div class="ob-summary__row">
                      <span class="ob-summary__key">{{ t('onboarding.done.first') }}</span>
                      <span class="ob-summary__value">{{ firstItemName }} · {{ firstItemDate }}</span>
                      <span class="ob-summary__check"><el-icon :size="13"><Check /></el-icon></span>
                    </div>
                    <div class="ob-summary__row">
                      <span class="ob-summary__key">{{ t('onboarding.done.look') }}</span>
                      <span class="ob-summary__value">{{ lookName }}</span>
                      <span class="ob-summary__check"><el-icon :size="13"><Check /></el-icon></span>
                    </div>
                    <div class="ob-summary__row">
                      <span class="ob-summary__key">{{ t('onboarding.done.place') }}</span>
                      <span class="ob-summary__value">{{ t(cornerLabel) }}</span>
                      <span class="ob-summary__check"><el-icon :size="13"><Check /></el-icon></span>
                    </div>
                  </div>
                </div>

                <div class="ob-note">{{ t('onboarding.done.tip') }}</div>

                <div class="ob-actions">
                  <el-button @click="finish(true)">{{ t('onboarding.openSettings') }}</el-button>
                </div>
              </div>

              <div class="ob-split__side">
                <span class="ob-label">{{ t('onboarding.countdown.preview') }}</span>
                <CardPreview :config="config" />
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer class="ob-foot">
        <button v-if="!isLast" class="ob-foot__skip" type="button" @click="finish(false)">
          {{ t('onboarding.skip') }}
        </button>
        <span v-else class="ob-foot__skip" aria-hidden="true"></span>

        <div class="ob-foot__dots">
          <span
            v-for="(entry, index) in steps"
            :key="entry.id"
            class="ob-foot__dot"
            :class="{ 'is-active': index === stepIndex }"
          ></span>
        </div>

        <el-button v-if="stepIndex > 0" @click="back">{{ t('onboarding.back') }}</el-button>
        <el-button type="primary" @click="next">{{ primaryText }}</el-button>
      </footer>
    </div>
  </el-config-provider>
</template>
