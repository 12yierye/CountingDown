<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, Corner, HostInfo, ScreenInfo } from '@shared/types'
import FieldRow from '@/components/FieldRow.vue'
import SliderField from '@/components/SliderField.vue'

const props = defineProps<{ config: AppConfig }>()
const emit = defineEmits<{
  (event: 'patch', patch: unknown): void
  (event: 'snap', corner: Corner): void
}>()

const { t } = useI18n()

const corners: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

function cornerLabel(corner: Corner): string {
  switch (corner) {
    case 'top-left':
      return t('layout.topLeft')
    case 'top-right':
      return t('layout.topRight')
    case 'bottom-left':
      return t('layout.bottomLeft')
    case 'bottom-right':
      return t('layout.bottomRight')
    default:
      return t('layout.custom')
  }
}

const screen = ref<ScreenInfo | null>(null)
const host = ref<HostInfo | null>(null)

onMounted(async () => {
  const info = await window.cd.getHostInfo()
  host.value = info
  screen.value = info.screens.find((item) => item.primary) ?? info.screens[0] ?? null
})

async function setTransparency(enabled: boolean): Promise<void> {
  await window.cd.setTransparency(enabled)
  host.value = await window.cd.getHostInfo()
}

const area = computed(() => screen.value?.workArea ?? { x: 0, y: 0, width: 1920, height: 1080 })

const win = computed(() => props.config.runtime.window)

function patchWindow(patch: Record<string, unknown>): void {
  emit('patch', { runtime: { window: patch } })
}

/** 切换参考基准：四角预设同时决定卡片贴哪条边 */
function setAnchor(value: string): void {
  if (value === 'custom') {
    patchWindow({ cornerPreset: 'custom' })
    return
  }
  const corner = value as Corner
  emit('snap', corner)
}

function clampX(value: number): number {
  return Math.min(Math.max(Math.round(value), area.value.x), area.value.x + area.value.width)
}

function clampY(value: number): number {
  return Math.min(Math.max(Math.round(value), area.value.y), area.value.y + area.value.height)
}

function setAnchorCoord(axis: 'x' | 'y', value: number | undefined): void {
  const raw = Number(value ?? 0)
  if (!Number.isFinite(raw)) return
  if (axis === 'x') patchWindow({ anchorX: clampX(raw) })
  else patchWindow({ anchorY: clampY(raw) })
}

function setOffset(axis: 'x' | 'y', value: number | undefined): void {
  const raw = Math.round(Number(value ?? 0))
  if (!Number.isFinite(raw)) return
  const limit = axis === 'x' ? area.value.width : area.value.height
  const clamped = Math.min(Math.max(raw, -limit), limit)
  if (axis === 'x') patchWindow({ offsetX: clamped })
  else patchWindow({ offsetY: clamped })
}

function resetOffset(): void {
  patchWindow({ offsetX: 0, offsetY: 0 })
}

const isCustomAnchor = computed(() => win.value.cornerPreset === 'custom')
const anchorParts = computed(() => {
  const source = isCustomAnchor.value ? win.value.corner : win.value.cornerPreset
  const [vertical, horizontal] = source.split('-')
  return { vertical, horizontal }
})

const offsetXLabel = computed(() =>
  anchorParts.value.horizontal === 'left' ? t('layout.offsetXLeft') : t('layout.offsetXRight')
)
const offsetYLabel = computed(() =>
  anchorParts.value.vertical === 'top' ? t('layout.offsetYDown') : t('layout.offsetYUp')
)
</script>

<template>
  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span class="panel-card__title">
          {{ t('layout.title') }}
          <el-tooltip :content="t('layout.cornerHint')" placement="top" :show-after="150">
            <span class="panel-card__help" tabindex="0">
              <el-icon :size="13"><QuestionFilled /></el-icon>
            </span>
          </el-tooltip>
        </span>
      </div>
    </template>

    <FieldRow :label="t('layout.anchor')" :hint="t('layout.anchorHint')">
      <el-select
        :model-value="win.cornerPreset"
        style="max-width: 260px"
        @update:model-value="setAnchor"
      >
        <el-option
          v-for="corner in corners"
          :key="corner"
          :label="cornerLabel(corner)"
          :value="corner"
        />
        <el-option :label="t('layout.custom')" value="custom" />
      </el-select>
    </FieldRow>

    <FieldRow v-if="isCustomAnchor" :label="`${t('layout.anchorX')} / ${t('layout.anchorY')}`">
      <div class="inline-group">
        <el-input-number
          :model-value="win.anchorX"
          :min="area.x"
          :max="area.x + area.width"
          :step="10"
          size="small"
          controls-position="right"
          @update:model-value="(v: number | undefined) => setAnchorCoord('x', v)"
        />
        <el-input-number
          :model-value="win.anchorY"
          :min="area.y"
          :max="area.y + area.height"
          :step="10"
          size="small"
          controls-position="right"
          @update:model-value="(v: number | undefined) => setAnchorCoord('y', v)"
        />
        <span class="units-note">{{ area.width }} × {{ area.height }}</span>
      </div>
    </FieldRow>
  </el-card>

  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span class="panel-card__title">
          {{ t('layout.offsetTitle') }}
          <el-tooltip :content="t('layout.offsetHint')" placement="top" :show-after="150">
            <span class="panel-card__help" tabindex="0">
              <el-icon :size="13"><QuestionFilled /></el-icon>
            </span>
          </el-tooltip>
        </span>
        <el-button size="small" plain @click="resetOffset">
          {{ t('layout.resetOffset') }}
        </el-button>
      </div>
    </template>

    <div class="panel-grid-2">
      <FieldRow :label="offsetXLabel">
        <SliderField
          :model-value="win.offsetX"
          :min="-200"
          :max="area.width"
          :step="1"
          unit="px"
          @update:model-value="(v: number) => setOffset('x', v)"
        />
      </FieldRow>
      <FieldRow :label="offsetYLabel">
        <SliderField
          :model-value="win.offsetY"
          :min="-200"
          :max="area.height"
          :step="1"
          unit="px"
          @update:model-value="(v: number) => setOffset('y', v)"
        />
      </FieldRow>
    </div>

    <FieldRow :label="t('layout.allowDrag')" :hint="t('layout.allowDragHint')">
      <el-switch
        :model-value="config.runtime.window.allowDrag !== false"
        @update:model-value="(v: string | number | boolean) => patchWindow({ allowDrag: Boolean(v) })"
      />
    </FieldRow>
  </el-card>

  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span>{{ t('layout.transparent') }}</span>
      </div>
    </template>

    <el-alert
      v-if="!host?.systemTransparency"
      class="panel-tip"
      type="warning"
      :closable="false"
      show-icon
      :title="t('layout.transparentUnsupported')"
    />

    <FieldRow :label="t('layout.transparent')" :hint="t('layout.transparentHint')">
      <el-switch
        :model-value="config.runtime.window.transparent"
        :disabled="!host?.systemTransparency"
        @update:model-value="(v: string | number | boolean) => setTransparency(Boolean(v))"
      />
    </FieldRow>
  </el-card>
</template>

<style scoped>
.inline-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.units-note {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.panel-tip {
  margin-bottom: 12px;
}
</style>
