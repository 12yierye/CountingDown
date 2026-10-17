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
 *
 * advanced = false（默认）时按使用频率分三层：一键配色 → 常用 6 项 → 高级参数折叠。
 * 折叠只影响这一层渲染，**不影响数据**：隐藏的字段仍原样保留在 appearance 里。
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
    advanced?: boolean
  }>(),
  { dense: false, advanced: false }
)

/** 可被「重置本组」单独恢复的四个分区（与父组件共享同一套字面量） */
const emit = defineEmits<{
  (event: 'update:appearance', value: AppearanceConfig): void
  (event: 'reset', key: 'font' | 'background' | 'border' | 'text'): void
  (event: 'toggle-advanced', value: boolean): void
}>()

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

/** 文案样板跟随界面语言，避免英文界面里预览出「元旦」「128 天」 */
const samples = computed(() => ({
  title: t('sample.title'),
  count: t('sample.count'),
  hint: t('sample.hint'),
  status: t('sample.status')
}))

const fontOptions = FONT_STACKS
</script>

<template>
  <!--
    高级参数的总开关放在表单最上面，一个入口、一个位置。
    以前「展开」藏在边框分组里、「收起」又跑到文字分组，「高级」到底指什么谁也说不清；
    现在开关固定在最上方，说明里直接列出它会带出哪些项。
    （预设调参模态框 dense 模式下没有开关位，那边固定展开。）
  -->
  <div v-if="!dense" class="advanced-bar">
    <div class="advanced-bar__text">
      <span class="advanced-bar__title">{{ t('appearance.advanced') }}</span>
      <span class="advanced-bar__hint">{{ t('appearance.advancedBarHint') }}</span>
    </div>
    <el-switch
      :model-value="advanced"
      data-cd-advanced
      @update:model-value="(v: string | number | boolean) => emit('toggle-advanced', Boolean(v))"
    />
  </div>

  <AppearanceGroup :title="t('appearance.font')" :dense="dense">
    <template #actions>
      <el-button link size="small" :title="t('appearance.resetFont')" @click="emit('reset', 'font')">
        {{ t('common.resetGroup') }}
      </el-button>
    </template>

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
    <template #actions>
      <el-button
        link
        size="small"
        :title="t('appearance.resetBackground')"
        @click="emit('reset', 'background')"
      >
        {{ t('common.resetGroup') }}
      </el-button>
    </template>

    <div class="panel-grid-2">
      <FieldRow :label="t('appearance.bgColor')">
        <ColorField
          :model-value="bg.color"
          @update:model-value="(v: string) => patchBackground({ color: v })"
        />
      </FieldRow>

      <!--
        透明度是「背景」这一级的独立设置，不是颜色的子项：
        它嵌在取色器弹层里时，多数人根本不知道这个滑条存在。
      -->
      <FieldRow :label="t('appearance.bgAlpha')">
        <SliderField
          :model-value="bg.alpha"
          :min="0"
          :max="1"
          :step="0.01"
          @update:model-value="(v: number) => patchBackground({ alpha: v })"
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

      <FieldRow v-if="advanced" :label="t('appearance.padding')">
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

  <!-- 高级模式：边框与阴影整组出现；收起时整组不渲染，入口在上面那条总开关里 -->
  <AppearanceGroup
    v-if="advanced"
    :title="`${t('appearance.border')} / ${t('appearance.shadow')}`"
    :dense="dense"
  >
    <template #actions>
      <el-button link size="small" :title="t('appearance.resetBorder')" @click="emit('reset', 'border')">
        {{ t('common.resetGroup') }}
      </el-button>
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
  </AppearanceGroup>

  <!-- 收起状态下整组不渲染：入口只有顶部那一个开关，不再另留一块占位说明 -->
  <AppearanceGroup :title="t('appearance.textGroup')" :dense="dense">
    <template #help>
      <el-tooltip :content="t('appearance.textAlphaHint')" placement="top" :show-after="150">
        <span class="panel-card__help" tabindex="0">
          <el-icon :size="13"><QuestionFilled /></el-icon>
        </span>
      </el-tooltip>
    </template>
    <template #actions>
      <el-button link size="small" :title="t('appearance.resetText')" @click="emit('reset', 'text')">
        {{ t('common.resetGroup') }}
      </el-button>
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
        :sample="samples.title"
        :compact="!advanced"
        @update:model-value="(v: TextStyle) => updateStyle('title', v)"
      />
      <TextStyleEditor
        :title="t('appearance.countStyle')"
        :model-value="appearance.count"
        :sample="samples.count"
        :compact="!advanced"
        @update:model-value="(v: TextStyle) => updateStyle('count', v)"
      />
      <TextStyleEditor
        :title="t('appearance.hintStyle')"
        :model-value="appearance.hint"
        :sample="samples.hint"
        :compact="!advanced"
        @update:model-value="(v: TextStyle) => updateStyle('hint', v)"
      />
      <TextStyleEditor
        :title="t('appearance.statusStyle')"
        :model-value="appearance.status"
        :sample="samples.status"
        :compact="!advanced"
        @update:model-value="(v: TextStyle) => updateStyle('status', v)"
      />
    </div>
  </AppearanceGroup>
</template>

<style scoped>
.advanced-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding: 10px 14px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--cd-radius, 12px);
  background: var(--el-fill-color-lighter);
}

.advanced-bar__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.advanced-bar__title {
  font-size: 13px;
  font-weight: 600;
}

.advanced-bar__hint {
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
</style>
