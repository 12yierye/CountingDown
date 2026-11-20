<script setup lang="ts">
/**
 * 「外观与风格在哪」的演示视频。
 *
 * 它是一段脚本驱动的动效，不是 mp4：镜头推近、光标点击、字幕切换全部按时间轴算，
 * 因此在任何缩放比例下都清晰，也能跟着界面语言与主题走（深色/浅色都对）。
 * 画面本身是设置窗口的等比缩略图，侧边栏的分组和条目名字都用真实文案。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

/** 一整轮演示的时长（毫秒） */
const DURATION = 13_000

const elapsed = ref(0)
const playing = ref(false)

const mock = ref<HTMLElement | null>(null)
const target = ref<HTMLElement | null>(null)
const track = ref<HTMLElement | null>(null)

/** 目标分组在缩略图里的位置，单位 %（跟着窗口尺寸走，不写死像素） */
const rect = ref({ left: 4, top: 34, width: 92, height: 32 })
let observer: ResizeObserver | null = null
let raf = 0
let last = 0

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const progress = computed(() => Math.min(1, elapsed.value / DURATION))

const easeInOut = (value: number): number =>
  value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2
const easeOut = (value: number): number => 1 - Math.pow(1 - value, 3)
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** 最大放大倍数 */
const KMAX = 1.85

const origin = computed(() => ({
  x: rect.value.left + rect.value.width / 2,
  y: rect.value.top + rect.value.height / 2
}))

/** 镜头：停留 → 推近 → 保持 → 拉回 */
const zoom = computed(() => {
  const time = progress.value
  if (time < 0.16) return 1
  if (time < 0.34) return 1 + (KMAX - 1) * easeInOut((time - 0.16) / 0.18)
  if (time < 0.86) return KMAX
  if (time < 0.98) return KMAX - (KMAX - 1) * easeInOut((time - 0.86) / 0.12)
  return 1
})

/**
 * 镜头 = 「把目标中心平移到画面中心」+「按 k 放大」。
 *
 * 只用 transform-origin 缩放是不够的：那会把目标留在它原本的位置上
 * （侧边栏在左边），放大后左侧直接被画面裁掉，标题只剩半个字。
 * 这里按 k 同步插值平移量：k=1 时平移为零（整窗可见），k=KMAX 时目标正好落在正中。
 */
const cameraStyle = computed(() => {
  const k = zoom.value
  const ratio = (k - 1) / (KMAX - 1)
  const dx = (50 - KMAX * origin.value.x) * ratio
  const dy = (50 - KMAX * origin.value.y) * ratio
  return {
    transform: `translate(${dx.toFixed(3)}%, ${dy.toFixed(3)}%) scale(${k.toFixed(4)})`,
    transformOrigin: '0 0'
  }
})

/** 光标：从画面右下角移到分组上，落点处闪一圈涟漪当作「点了一下」 */
const cursorStyle = computed(() => {
  const time = progress.value
  const k = easeOut(clamp01((time - 0.06) / 0.13))
  const fromX = 63
  const fromY = 84
  const toX = origin.value.x + 3
  const toY = origin.value.y + 4
  return {
    left: `${(fromX + (toX - fromX) * k).toFixed(2)}%`,
    top: `${(fromY + (toY - fromY) * k).toFixed(2)}%`,
    opacity: time > 0.04 && time < 0.58 ? 1 : 0
  }
})

const rippleStyle = computed(() => {
  const time = progress.value
  const k = clamp01((time - 0.17) / 0.12)
  const size = 14 + 46 * easeOut(k)
  return {
    left: `${(origin.value.x + 3).toFixed(2)}%`,
    top: `${(origin.value.y + 4).toFixed(2)}%`,
    width: `${size}px`,
    height: `${size}px`,
    marginLeft: `${-size / 2}px`,
    marginTop: `${-size / 2}px`,
    opacity: time >= 0.17 && time <= 0.30 ? String(1 - k) : '0'
  }
})

/** 字幕：0 全景 / 1 侧边栏 / 2 外观 / 3 文案与显示 / 4 预设主题 */
const captionIndex = computed(() => {
  const time = progress.value
  if (time < 0.1) return 0
  if (time < 0.34) return 1
  if (time < 0.56) return 2
  if (time < 0.74) return 3
  return 4
})

const caption = computed(() => t(`onboarding.tour.caption${captionIndex.value}`))

/** 推近之后逐项高亮侧边栏的三个子项；0 表示不高亮 */
const activeSub = computed(() => (captionIndex.value >= 2 ? captionIndex.value - 1 : 0))

const ringStyle = computed(() => ({
  left: `${rect.value.left}%`,
  top: `${rect.value.top}%`,
  width: `${rect.value.width}%`,
  height: `${rect.value.height}%`,
  opacity: zoom.value > 1.08 ? '1' : '0'
}))

const timeText = computed(() => {
  const fmt = (ms: number): string => `00:${String(Math.min(59, Math.floor(ms / 1000))).padStart(2, '0')}`
  return `${fmt(elapsed.value)} / ${fmt(DURATION)}`
})

const playedPercent = computed(() => `${(progress.value * 100).toFixed(2)}%`)

function measure(): void {
  const host = mock.value
  const node = target.value
  if (!host || !node) return
  const hostBox = host.getBoundingClientRect()
  const nodeBox = node.getBoundingClientRect()
  if (hostBox.width < 2 || hostBox.height < 2) return
  // 两者都处在同一个被缩放的坐标系里，比值与缩放无关
  rect.value = {
    left: ((nodeBox.left - hostBox.left) / hostBox.width) * 100,
    top: ((nodeBox.top - hostBox.top) / hostBox.height) * 100,
    width: (nodeBox.width / hostBox.width) * 100,
    height: (nodeBox.height / hostBox.height) * 100
  }
}

function step(timestamp: number): void {
  if (!playing.value) return
  if (!last) last = timestamp
  elapsed.value += timestamp - last
  last = timestamp
  // 循环播放：演示视频放在引导里是要能一直看的
  if (elapsed.value >= DURATION) elapsed.value = 0
  raf = requestAnimationFrame(step)
}

function play(): void {
  if (playing.value) return
  playing.value = true
  last = 0
  raf = requestAnimationFrame(step)
}

function pause(): void {
  playing.value = false
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

function toggle(): void {
  if (playing.value) pause()
  else play()
}

function seek(event: PointerEvent): void {
  const host = track.value
  if (!host) return
  const box = host.getBoundingClientRect()
  if (box.width < 2) return
  elapsed.value = clamp01((event.clientX - box.left) / box.width) * DURATION
}

function replay(): void {
  elapsed.value = 0
  play()
}

onMounted(async () => {
  await nextTick()
  measure()
  if (typeof ResizeObserver !== 'undefined' && mock.value) {
    observer = new ResizeObserver(() => measure())
    observer.observe(mock.value)
  }
  if (reducedMotion) {
    // 关掉动效的机器：直接停在「已经推近、三项都亮着」的那一帧
    elapsed.value = DURATION * 0.5
    return
  }
  play()
})

onBeforeUnmount(() => {
  pause()
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div class="tour">
    <div class="tour__viewport">
      <div class="tour__frame">
        <div class="tour__camera" :style="cameraStyle">
          <div ref="mock" class="tour__mock">
            <!-- 侧边栏：结构与真实设置窗口一致 -->
            <aside class="mock-side">
              <div class="mock-brand">
                <span class="mock-brand__logo">27</span>
                <span class="mock-brand__name">{{ t('app.name') }}</span>
              </div>
              <div class="mock-search">{{ t('nav.searchPlaceholder') }}</div>

              <p class="mock-head">{{ t('nav.groupCountdown') }}</p>
              <div class="mock-item">{{ t('nav.list') }}</div>

              <div ref="target" class="mock-group">
                <p class="mock-head mock-head--look">{{ t('nav.groupLook') }}</p>
                <div class="mock-item" :class="{ 'is-sub': activeSub === 1 }">
                  {{ t('nav.appearance') }}
                </div>
                <div class="mock-item" :class="{ 'is-sub': activeSub === 2 }">
                  {{ t('nav.target') }}
                </div>
                <div class="mock-item" :class="{ 'is-sub': activeSub === 3 }">
                  {{ t('nav.preset') }}
                </div>
              </div>

              <p class="mock-head">{{ t('nav.groupSystem') }}</p>
              <div class="mock-item">{{ t('nav.behavior') }}</div>
              <div class="mock-item">{{ t('nav.integration') }}</div>
            </aside>

            <!-- 内容区：几张骨架卡片，只为了让人认出「这是设置窗口」 -->
            <section class="mock-main">
              <div class="mock-top">{{ t('nav.appearance') }}</div>
              <div class="mock-content">
                <div class="mock-card mock-card--wide">
                  <span class="mock-line mock-line--title"></span>
                  <span class="mock-line"></span>
                  <span class="mock-line mock-line--short"></span>
                </div>
                <div class="mock-card">
                  <span class="mock-line mock-line--title"></span>
                  <div class="mock-swatches">
                    <i></i><i></i><i></i><i></i>
                  </div>
                </div>
                <div class="mock-card">
                  <span class="mock-line mock-line--title"></span>
                  <span class="mock-line"></span>
                  <span class="mock-line mock-line--short"></span>
                </div>
              </div>
            </section>

            <!-- 高亮框与光标都画在缩略图坐标系里，跟着镜头一起放大 -->
            <div class="mock-ring" :style="ringStyle"></div>
            <svg class="mock-cursor" :style="cursorStyle" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M2 1.2 13.2 8.1l-4.9.9-2.3 4.6z"
                fill="#ffffff"
                stroke="#111318"
                stroke-width="1.1"
                stroke-linejoin="round"
              />
            </svg>
            <span class="mock-ripple" :style="rippleStyle"></span>
          </div>
        </div>

        <span class="tour__badge">{{ t('onboarding.tour.badge') }}</span>
        <transition name="tour-caption" mode="out-in">
          <p :key="captionIndex" class="tour__caption">{{ caption }}</p>
        </transition>
      </div>
    </div>

    <div class="tour__controls">
      <button class="tour__btn" type="button" :title="playing ? t('onboarding.tour.pause') : t('onboarding.tour.play')" @click="toggle">
        <svg v-if="playing" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor" />
          <rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor" />
        </svg>
        <svg v-else viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5 3.4v9.2c0 .5.6.8 1 .5l7-4.6a.6.6 0 0 0 0-1L6 2.9c-.4-.3-1 0-1 .5Z" fill="currentColor" />
        </svg>
      </button>

      <div ref="track" class="tour__track" @pointerdown="seek">
        <span class="tour__played" :style="{ width: playedPercent }"></span>
        <span class="tour__thumb" :style="{ left: playedPercent }"></span>
      </div>

      <span class="tour__time">{{ timeText }}</span>
      <button class="tour__btn tour__btn--text" type="button" @click="replay">
        {{ t('onboarding.tour.replay') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.tour {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

/* 画面高度由剩余空间决定，宽度按 16:9 反推：
   小屏幕（1366×768 @125%）下整块一起缩小，而不是把底部的按钮挤出窗口 */
.tour__viewport {
  flex: 1;
  min-height: 0;
  display: flex;
  justify-content: center;
}

.tour__frame {
  position: relative;
  height: 100%;
  aspect-ratio: 16 / 9;
  max-width: 100%;
  min-height: 180px;
  border-radius: var(--cd-r-md);
  border: 1px solid var(--cd-line);
  background: var(--cd-s1);
  overflow: hidden;
  box-shadow: 0 18px 40px -28px #000;
}

.tour__camera {
  position: absolute;
  inset: 0;
  transition: none;
  will-change: transform;
}

.tour__mock {
  position: absolute;
  inset: 0;
  display: flex;
  background: var(--cd-s1);
  font-size: 9px;
  color: var(--cd-ink-2);
}

/* ------------------------------ 缩略图：侧边栏 ------------------------------ */

.mock-side {
  width: 148px;
  flex: none;
  padding: 9px 8px;
  border-right: 1px solid var(--cd-line-soft);
  background: var(--cd-s1);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mock-brand {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px 6px;
}

.mock-brand__logo {
  width: 13px;
  height: 13px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  font-size: 6px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #3a7aff, #7c5cff);
}

.mock-brand__name {
  font-size: 9px;
  font-weight: 600;
  color: var(--cd-ink-1);
}

.mock-search {
  height: 15px;
  display: flex;
  align-items: center;
  padding: 0 6px;
  border-radius: 4px;
  border: 1px solid var(--cd-line);
  background: var(--cd-s2);
  color: var(--cd-ink-4);
  font-size: 7px;
}

.mock-head {
  margin: 7px 0 2px;
  padding: 0 4px;
  font-size: 6.5px;
  letter-spacing: 0.4px;
  color: var(--cd-ink-4);
}

.mock-head--look {
  color: var(--cd-ink-1);
}

.mock-group {
  padding: 1px 0 3px;
  border-radius: 6px;
}

.mock-item {
  height: 17px;
  display: flex;
  align-items: center;
  padding: 0 4px 0 12px;
  border-radius: 5px;
  font-size: 8px;
  color: var(--cd-ink-2);
  transition: background 0.3s ease, color 0.3s ease;
}

.mock-item.is-sub {
  background: var(--cd-s4);
  color: var(--cd-ink-1);
  font-weight: 600;
}

/* ------------------------------ 缩略图：内容区 ------------------------------ */

.mock-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.mock-top {
  height: 26px;
  flex: none;
  display: flex;
  align-items: center;
  padding: 0 10px;
  border-bottom: 1px solid var(--cd-line-soft);
  font-size: 8px;
  font-weight: 600;
  color: var(--cd-ink-1);
}

.mock-content {
  flex: 1;
  padding: 8px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  align-content: start;
}

.mock-card {
  border: 1px solid var(--cd-line-soft);
  border-radius: 6px;
  background: var(--cd-s2);
  padding: 7px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-height: 54px;
}

.mock-card--wide {
  grid-column: span 2;
}

.mock-line {
  height: 4px;
  border-radius: 2px;
  background: var(--cd-s4);
}

.mock-line--title {
  width: 46%;
  height: 5px;
  background: var(--cd-line-strong);
}

.mock-line--short {
  width: 68%;
}

.mock-swatches {
  display: flex;
  gap: 4px;
}

.mock-swatches i {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: var(--cd-s4);
}

.mock-swatches i:nth-child(1) {
  background: #1e2230;
}
.mock-swatches i:nth-child(2) {
  background: #ffffff;
}
.mock-swatches i:nth-child(3) {
  background: #ffe3ec;
}
.mock-swatches i:nth-child(4) {
  background: #0b1a10;
}

/* ------------------------------- 镜头元素 ------------------------------- */

.mock-ring {
  position: absolute;
  border-radius: 8px;
  border: 1.6px solid color-mix(in srgb, var(--cd-accent) 85%, transparent);
  /* 画外压暗：把注意力收到分组上；靠超大 spread 当全屏遮罩用 */
  box-shadow: 0 0 0 9999px color-mix(in srgb, var(--cd-s0) 48%, transparent);
  pointer-events: none;
  transition: opacity 0.3s ease;
}

.mock-cursor {
  position: absolute;
  width: 15px;
  height: 15px;
  pointer-events: none;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
  transition: opacity 0.25s ease;
}

.mock-ripple {
  position: absolute;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--cd-accent) 90%, transparent);
  pointer-events: none;
}

/* -------------------------------- 字幕与控件 -------------------------------- */

.tour__badge {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 9.5px;
  letter-spacing: 0.4px;
  color: var(--cd-ink-2);
  background: color-mix(in srgb, var(--cd-s0) 62%, transparent);
  border: 1px solid var(--cd-line);
  backdrop-filter: blur(4px);
}

.tour__caption {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  margin: 0;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--cd-ink-1);
  background: color-mix(in srgb, var(--cd-s0) 78%, transparent);
  border: 1px solid var(--cd-line);
  backdrop-filter: blur(6px);
}

.tour-caption-enter-active,
.tour-caption-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.tour-caption-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.tour-caption-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.tour__controls {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 2px;
}

.tour__btn {
  width: 26px;
  height: 26px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 7px;
  border: 1px solid var(--cd-line);
  background: var(--cd-s2);
  color: var(--cd-ink-2);
  cursor: pointer;
}

.tour__btn:hover {
  color: var(--cd-ink-1);
  border-color: var(--cd-line-strong);
}

.tour__btn svg {
  width: 14px;
  height: 14px;
}

.tour__btn--text {
  width: auto;
  padding: 0 10px;
  font-size: 11.5px;
  font-family: inherit;
  color: var(--cd-ink-3);
}

.tour__track {
  position: relative;
  flex: 1;
  height: 14px;
  display: flex;
  align-items: center;
  cursor: pointer;
}

.tour__track::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 999px;
  background: var(--cd-s4);
}

.tour__played {
  position: absolute;
  left: 0;
  height: 3px;
  border-radius: 999px;
  background: var(--cd-accent);
}

.tour__thumb {
  position: absolute;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--cd-accent);
  transform: translateX(-50%);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cd-accent) 22%, transparent);
}

.tour__time {
  flex: none;
  font-size: 10.5px;
  color: var(--cd-ink-3);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.4px;
}
</style>
