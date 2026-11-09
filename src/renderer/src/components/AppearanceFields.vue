<script setup lang="ts">
/**
 * 外观参数表单（纯表现层）。
 *
 * 只负责「把一份外观画成控件」，改动时 emit 一份**新的 AppearanceConfig**：
 * 不读全局配置、不落盘、不知道预设的存在。因此同一个组件既能给全局外观页用，
 * 也能给「手动调整预设参数」的模态框操作一份草稿 —— 后者改半天也不会碰到全局设置。
 *
 * 分区一律可折叠，顺序固定：字体 / 背景 / 边框与阴影 / 文字。
 * 默认只展开「背景」和「文字」—— 这两块打开就能解决八成的调外观需求；
 * 字体与边框、内边距收在标题后面，但标题右侧写着当前值，不用点开也知道现在是什么。
 *
 * dense = true 给列宽只有 500px 出头的模态框用：分区默认全展开。
 * advanced = true 让四段文字样式直接铺开字重/字距/透明度；页面上则由「完整参数」手动切。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppearanceConfig, TextStyle } from '@shared/types'
import SettingSection from '@/components/SettingSection.vue'
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

/** 四段文字样式默认只给字号与颜色；字重/字距/透明度藏在这一个开关后面 */
const fullText = ref(props.advanced)

/** 文案样板跟随界面语言，避免英文界面里预览出「元旦」「128 天」 */
const samples = computed(() => ({
  title: t('sample.title'),
  count: t('sample.count'),
  hint: t('sample.hint'),
  status: t('sample.status')
}))

const fontOptions = FONT_STACKS

const openFont = computed(() => props.dense)
const openBorder = computed(() => props.dense)
</script>

<template>
  <SettingSection
    :title="t('appearance.font')"
    :help="t('appearance.fontHint')"
    :default-open="openFont"
    :persist-key="dense ? '' : 'appearance.font'"
  >
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
  </SettingSection>

  <SettingSection
    :title="t('appearance.background')"
    persist-key="appearance.background"
  >
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
  </SettingSection>

  <SettingSection
    :title="`${t('appearance.border')} / ${t('appearance.shadow')}`"
    :default-open="openBorder"
    :persist-key="dense ? '' : 'appearance.border'"
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
  </SettingSection>

  <SettingSection
    :title="t('appearance.textGroup')"
    persist-key="appearance.text"
  >
    <template #actions>
      <el-button link size="small" @click="fullText = !fullText">
        {{ fullText ? t('appearance.textCompact') : t('appearance.textFull') }}
      </el-button>
      <el-button link size="small" :title="t('appearance.resetText')" @click="emit('reset', 'text')">
        {{ t('common.resetGroup') }}
      </el-button>
    </template>

    <TextStyleEditor
      :title="t('appearance.titleStyle')"
      :model-value="appearance.title"
      :sample="samples.title"
      :compact="!fullText"
      @update:model-value="(v: TextStyle) => updateStyle('title', v)"
    />
    <TextStyleEditor
      :title="t('appearance.countStyle')"
      :model-value="appearance.count"
      :sample="samples.count"
      :compact="!fullText"
      @update:model-value="(v: TextStyle) => updateStyle('count', v)"
    />
    <TextStyleEditor
      :title="t('appearance.hintStyle')"
      :model-value="appearance.hint"
      :sample="samples.hint"
      :compact="!fullText"
      @update:model-value="(v: TextStyle) => updateStyle('hint', v)"
    />
    <TextStyleEditor
      :title="t('appearance.statusStyle')"
      :model-value="appearance.status"
      :sample="samples.status"
      :compact="!fullText"
      @update:model-value="(v: TextStyle) => updateStyle('status', v)"
    />
  </SettingSection>
</template>
