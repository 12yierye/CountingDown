<script setup lang="ts">
/**
 * 卡片预览。
 *
 * 直接复用桌面组件那一份 CountdownCard（模板与样式都不复制），
 * 所以这里看到的圆角、字距、裁切规则就是真实卡片的样子。
 * 唯一额外做的事是等比缩放：预览框装不下就把整张卡片缩到装得下为止。
 */
import { nextTick, onMounted, ref, watch } from 'vue'
import type { AppConfig } from '@shared/types'
import CountdownCard from '@/components/CountdownCard.vue'
import { useCountdownCard } from '@/composables/useCountdownCard'

const props = defineProps<{ config: AppConfig }>()

const card = useCountdownCard(() => props.config, { live: true })

const box = ref<HTMLElement | null>(null)
const fit = ref<HTMLElement | null>(null)
const scale = ref(1)

function measure(): void {
  const host = box.value
  const el = fit.value
  if (!host || !el) return
  // offsetWidth / scrollHeight 是布局尺寸，不受上一个 transform 影响
  const width = Math.max(el.offsetWidth, el.scrollWidth)
  const height = Math.max(el.offsetHeight, el.scrollHeight)
  if (width < 2 || height < 2) return
  const ratio = Math.min(
    1,
    (host.clientWidth - 12) / width,
    (host.clientHeight - 12) / height
  )
  if (Number.isFinite(ratio) && ratio > 0) scale.value = Math.min(1, Math.max(0.35, ratio))
}

onMounted(() => {
  void nextTick(measure)
  window.addEventListener('resize', measure)
})

watch(
  () => [props.config, props.config.runtime.language] as const,
  () => void nextTick(measure),
  { deep: false }
)
</script>

<template>
  <div ref="box" class="preview">
    <div ref="fit" class="preview__fit" :style="{ transform: `scale(${scale})` }">
      <CountdownCard
        v-if="card.resolved.value"
        :title="card.resolved.value.text.title"
        :precise-parts="card.precisionMode.value ? card.preciseParts.value : null"
        :abs-days="card.absDays.value"
        :unit="card.unit.value"
        :hint-text="card.hintText.value"
        :status-text="card.statusText.value"
        :show-hint="card.showHint.value"
        :show-status="card.showStatus.value"
        :style="card.cardStyleObject.value"
        :title-style="card.titleStyle.value"
        :count-style="card.countStyle.value"
        :hint-style="card.hintStyle.value"
        :status-style="card.statusStyle.value"
        :unit-style="card.unitStyle.value"
      />
    </div>
  </div>
</template>

<style scoped>
.preview {
  flex: 1;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  border-radius: var(--cd-r-md);
  /* 预览底色用棋盘格，透明卡片才看得出「透过去」是什么效果 */
  background-color: var(--cd-s2);
  background-image: linear-gradient(45deg, var(--cd-s1) 25%, transparent 25%),
    linear-gradient(-45deg, var(--cd-s1) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--cd-s1) 75%),
    linear-gradient(-45deg, transparent 75%, var(--cd-s1) 75%);
  background-size: 12px 12px;
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  overflow: hidden;
}

.preview__fit {
  transform-origin: center center;
  will-change: transform;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
