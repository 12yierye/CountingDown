<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, TextStyle } from '@shared/types'
import FieldRow from '@/components/FieldRow.vue'
import ColorField from '@/components/ColorField.vue'
import TextStyleEditor from '@/components/TextStyleEditor.vue'
import SliderField from '@/components/SliderField.vue'
import { FONT_STACKS } from '@/utils/style'

const props = defineProps<{ config: AppConfig }>()
const emit = defineEmits<{ (event: 'patch', patch: unknown): void }>()

const { t } = useI18n()

const bg = computed(() => props.config.appearance.background)

function patchAppearance(patch: Record<string, unknown>): void {
  emit('patch', { appearance: patch })
}

function patchBackground(patch: Record<string, unknown>): void {
  emit('patch', { appearance: { background: patch } })
}

function updateStyle(key: 'title' | 'count' | 'hint' | 'status', value: TextStyle): void {
  emit('patch', { appearance: { [key]: value } })
}

const fontOptions = FONT_STACKS
</script>

<template>
  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span>{{ t('appearance.font') }}</span>
      </div>
    </template>
    <FieldRow :label="t('appearance.fontFamily')" :hint="t('appearance.fontHint')">
      <el-select
        :model-value="config.appearance.fontFamily"
        class="font-select"
        popper-class="cd-font-select"
        filterable
        allow-create
        default-first-option
        style="width: 100%"
        @update:model-value="(v: string) => patchAppearance({ fontFamily: v })"
      >
        <el-option v-for="font in fontOptions" :key="font" :label="font" :value="font" />
      </el-select>
    </FieldRow>
  </el-card>

  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span>{{ t('appearance.background') }}</span>
      </div>
    </template>

    <FieldRow :label="t('appearance.opacity')" :hint="t('appearance.opacityHint')">
      <SliderField
        :model-value="config.appearance.opacity ?? 1"
        :min="0.2"
        :max="1"
        :step="0.01"
        @update:model-value="(v: number) => patchAppearance({ opacity: v })"
      />
    </FieldRow>

    <div class="panel-grid-2">
      <FieldRow :label="t('appearance.bgColor')">
        <ColorField
          :model-value="bg.color"
          :alpha="bg.alpha"
          show-alpha
          @update:model-value="(v: string) => patchBackground({ color: v })"
          @update:alpha="(v: number) => patchBackground({ alpha: v })"
        />
      </FieldRow>

      <FieldRow :label="t('appearance.width')" :hint="t('appearance.widthHint')">
        <el-input-number
          :model-value="bg.width"
          :min="0"
          :max="900"
          :step="10"
          size="small"
          controls-position="right"
          @update:model-value="(v: number | undefined) => patchBackground({ width: v ?? 0 })"
        />
      </FieldRow>

      <FieldRow :label="t('appearance.radius')">
        <SliderField
          :model-value="bg.radius"
          :min="0"
          :max="60"
          unit="px"
          @update:model-value="(v: number) => patchBackground({ radius: v })"
        />
      </FieldRow>

      <FieldRow :label="t('appearance.padding')">
        <SliderField
          :model-value="bg.padding"
          :min="0"
          :max="64"
          unit="px"
          @update:model-value="(v: number) => patchBackground({ padding: v })"
        />
      </FieldRow>
    </div>
  </el-card>

  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span>{{ t('appearance.border') }} / {{ t('appearance.shadow') }}</span>
      </div>
    </template>

    <div class="panel-grid-2">
      <FieldRow :label="t('appearance.borderWidth')">
        <SliderField
          :model-value="bg.borderWidth"
          :min="0"
          :max="8"
          :step="0.5"
          unit="px"
          @update:model-value="(v: number) => patchBackground({ borderWidth: v })"
        />
      </FieldRow>

      <FieldRow :label="t('appearance.borderColor')">
        <ColorField
          :model-value="bg.borderColor"
          @update:model-value="(v: string) => patchBackground({ borderColor: v })"
        />
      </FieldRow>

      <FieldRow :label="t('appearance.shadowStrength')">
        <SliderField
          :model-value="bg.shadow"
          :min="0"
          :max="100"
          @update:model-value="(v: number) => patchBackground({ shadow: v })"
        />
      </FieldRow>

      <FieldRow :label="t('appearance.shadowColor')">
        <ColorField
          :model-value="bg.shadowColor"
          @update:model-value="(v: string) => patchBackground({ shadowColor: v })"
        />
      </FieldRow>
    </div>
  </el-card>

  <el-card shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span>{{ t('appearance.titleStyle') }} / {{ t('appearance.countStyle') }}</span>
      </div>
    </template>

    <div class="panel-grid-text">
      <TextStyleEditor
        :title="t('appearance.titleStyle')"
        :model-value="config.appearance.title"
        sample="元旦"
        @update:model-value="(v: TextStyle) => updateStyle('title', v)"
      />
      <TextStyleEditor
        :title="t('appearance.countStyle')"
        :model-value="config.appearance.count"
        sample="128 天"
        @update:model-value="(v: TextStyle) => updateStyle('count', v)"
      />
      <TextStyleEditor
        :title="t('appearance.hintStyle')"
        :model-value="config.appearance.hint"
        sample="2026 年 1 月 1 日 · 周四"
        @update:model-value="(v: TextStyle) => updateStyle('hint', v)"
      />
      <TextStyleEditor
        :title="t('appearance.statusStyle')"
        :model-value="config.appearance.status"
        sample="还有 128 天"
        @update:model-value="(v: TextStyle) => updateStyle('status', v)"
      />
    </div>
  </el-card>
</template>
