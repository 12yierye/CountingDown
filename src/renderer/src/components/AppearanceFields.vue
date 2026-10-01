<script setup lang="ts">
/**
 * 外观参数表单（纯表现层）。
 *
 * 只负责「把一份外观画成控件」，改动时 emit 一份**新的 AppearanceConfig**：
 * 不读全局配置、不落盘、不知道预设的存在。因此同一个组件既能给全局外观页用，
 * 也能给「手动调整预设参数」的模态框操作一份草稿 —— 后者改半天也不会碰到全局设置。
 *
 * dense = true 时外壳换成平铺分组（见 AppearanceGroup），供列宽只有 500px 出头的模态框使用；
 * 控件、标签、tooltip 两种变体完全一致。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppearanceConfig, TextStyle } from '@shared/types'
import AppearanceGroup from '@/components/AppearanceGroup.vue'
import FieldRow from '@/components/FieldRow.vue'
import ColorField from '@/components/ColorField.vue'
import TextStyleEditor from '@/components/TextStyleEditor.vue'
import SliderField from '@/components/SliderField.vue'
import { FONT_STACKS } from '@/utils/style'

const props = withDefaults(
  defineProps<{
    appearance: AppearanceConfig
    dense?: boolean
  }>(),
  { dense: false }
)

const emit = defineEmits<{ (event: 'update:appearance', value: AppearanceConfig): void }>()

const { t } = useI18n()

const bg = computed(() => props.appearance.background)

/** 顶层字段：换掉整个对象，绝不原地改 props 里的引用 */
function patchAppearance(patch: Partial<AppearanceConfig>): void {
  emit('update:appearance', { ...props.appearance, ...patch })
}

function patchBackground(patch: Partial<AppearanceConfig['background']>): void {
  patchAppearance({ background: { ...bg.value, ...patch } })
}

function updateStyle(key: 'title' | 'count' | 'hint' | 'status', value: TextStyle): void {
  patchAppearance({ [key]: value })
}

const fontOptions = FONT_STACKS
</script>

<template>
  <AppearanceGroup :title="t('appearance.font')" :dense="dense">
    <FieldRow :label="t('appearance.fontFamily')" :hint="t('appearance.fontHint')">
      <el-select
        :model-value="appearance.fontFamily"
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
  </AppearanceGroup>

  <AppearanceGroup :title="t('appearance.background')" :dense="dense">
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
  </AppearanceGroup>

  <AppearanceGroup
    :title="`${t('appearance.border')} / ${t('appearance.shadow')}`"
    :dense="dense"
  >
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
  </AppearanceGroup>

  <AppearanceGroup :title="t('appearance.textGroup')" :dense="dense">
    <template #help>
      <el-tooltip :content="t('appearance.textAlphaHint')" placement="top" :show-after="150">
        <span class="panel-card__help" tabindex="0">
          <el-icon :size="13"><QuestionFilled /></el-icon>
        </span>
      </el-tooltip>
    </template>

    <!--
      文字透明度总开关单独放在最上面：它只影响文字，与上面的背景透明度无关；
      下面每个文字样式还能再调各自的透明度，两者相乘。
    -->
    <FieldRow :label="t('appearance.textAlpha')" :hint="t('appearance.textAlphaHint')">
      <SliderField
        :model-value="appearance.textAlpha ?? 1"
        :min="0"
        :max="1"
        :step="0.01"
        @update:model-value="(v: number) => patchAppearance({ textAlpha: v })"
      />
    </FieldRow>

    <div class="panel-grid-text">
      <TextStyleEditor
        :title="t('appearance.titleStyle')"
        :model-value="appearance.title"
        sample="元旦"
        @update:model-value="(v: TextStyle) => updateStyle('title', v)"
      />
      <TextStyleEditor
        :title="t('appearance.countStyle')"
        :model-value="appearance.count"
        sample="128 天"
        @update:model-value="(v: TextStyle) => updateStyle('count', v)"
      />
      <TextStyleEditor
        :title="t('appearance.hintStyle')"
        :model-value="appearance.hint"
        sample="2026 年 1 月 1 日 · 周四"
        @update:model-value="(v: TextStyle) => updateStyle('hint', v)"
      />
      <TextStyleEditor
        :title="t('appearance.statusStyle')"
        :model-value="appearance.status"
        sample="还有 128 天"
        @update:model-value="(v: TextStyle) => updateStyle('status', v)"
      />
    </div>
  </AppearanceGroup>
</template>
