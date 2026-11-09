<script setup lang="ts">
/**
 * 单项外观覆盖弹窗。
 *
 * 为什么从编辑页里搬出来：这一块有 20+ 个控件，平铺在编辑页里等于把页面拉长三倍，
 * 而它恰恰是「偶尔才碰一次」的那一层。搬进弹窗后，编辑页只留一个开关、一行已覆盖摘要、
 * 一个入口按钮；要调的人点进来，不调的人不受影响。
 *
 * 弹窗内部分区与「外观」全局页保持同一套顺序（字体 / 背景 / 边框与阴影 / 文字），
 * 两边学一次就够。预览不放在弹窗里：打开这个弹窗时，桌面卡片正在实时渲染
 * 编辑中的草稿（见 main/preview.ts），那才是真正要对照的东西。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, AppearanceOverride, BackgroundConfig, CountdownItem, TextStyle } from '@shared/types'
import SettingSection from '@/components/SettingSection.vue'
import FieldRow from '@/components/FieldRow.vue'
import ColorField from '@/components/ColorField.vue'
import SliderField from '@/components/SliderField.vue'
import TextStyleEditor from '@/components/TextStyleEditor.vue'
import { FONT_STACKS } from '@/utils/style'

const props = defineProps<{
  visible: boolean
  config: AppConfig
  appearance: AppearanceOverride
  /** 用来渲染实时预览的草稿项（标题、日期、文案都来自它） */
  item: CountdownItem
}>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  (event: 'update:appearance', value: AppearanceOverride): void
}>()

const { t } = useI18n()

const fontOptions = FONT_STACKS

type StyleKey = 'title' | 'count' | 'hint' | 'status'
type OverrideKey = 'fontFamily' | 'background' | StyleKey

const backgroundFields = computed(() => props.appearance.background ?? {})

function patch(next: AppearanceOverride): void {
  emit('update:appearance', next)
}

function patchBackground(patchBody: Partial<BackgroundConfig>): void {
  patch({
    ...props.appearance,
    background: { ...(props.appearance.background ?? {}), ...patchBody }
  })
}

function patchStyle(key: StyleKey, value: TextStyle): void {
  patch({ ...props.appearance, [key]: value })
}

/**
 * 勾选/取消某一项覆盖：勾选时以当前全局值作为起点（用户是从现在看到的样子开始改，
 * 不是从空白开始），取消时直接删掉这个键。
 */
function setOverride(key: OverrideKey, enabled: boolean): void {
  const next: AppearanceOverride = { ...props.appearance }
  if (!enabled) {
    delete next[key]
  } else if (key === 'fontFamily') {
    next.fontFamily = props.config.appearance.fontFamily
  } else if (key === 'background') {
    next.background = { ...props.config.appearance.background }
  } else {
    next[key] = { ...props.config.appearance[key] }
  }
  patch(next)
}

function resetAll(): void {
  patch({})
}

const styles = computed<
  Array<{ key: StyleKey; label: string; sample: string }>
>(() => [
  { key: 'title', label: t('appearance.titleStyle'), sample: props.item.name || t('sample.title') },
  { key: 'count', label: t('appearance.countStyle'), sample: t('sample.count') },
  { key: 'hint', label: t('appearance.hintStyle'), sample: t('sample.hint') },
  { key: 'status', label: t('appearance.statusStyle'), sample: t('sample.status') }
])

/** 四段文字样式默认只给字号与颜色；字重/字距/透明度藏在这一个开关后面 */
const fullText = ref(false)
</script>

<template>
  <el-dialog
    :model-value="visible"
    class="item-appearance-dialog"
    width="min(920px, 94vw)"
    append-to-body
    :title="t('editor.appearanceDialogTitle', { name: item.name || t('editor.unnamed') })"
    @update:model-value="(value: boolean) => emit('update:visible', value)"
  >
    <div class="iad">
      <div class="iad__fields">
        <p class="iad__tip">{{ t('appearance.overrideTip') }}</p>

        <SettingSection
          :title="t('appearance.font')"
          :default-open="false"
        >
          <!-- 开关属于这一组本身，放标题行；放进正文会和它控制的控件挤在同一行 -->
          <template #actions>
            <el-switch
              size="small"
              :model-value="Boolean(appearance.fontFamily)"
              @update:model-value="(v: string | number | boolean) => setOverride('fontFamily', Boolean(v))"
            />
          </template>

          <FieldRow :label="t('appearance.fontFamily')" :hint="t('appearance.fontHint')">
            <el-select
              v-if="appearance.fontFamily"
              :model-value="appearance.fontFamily"
              class="font-select"
              popper-class="cd-font-select"
              filterable
              allow-create
              default-first-option
              style="width: 100%"
              @update:model-value="(v: string) => patch({ ...appearance, fontFamily: v })"
            >
              <el-option v-for="font in fontOptions" :key="font" :label="font" :value="font" />
            </el-select>
            <span v-else class="iad-row__empty">{{ t('common.followGlobal') }}</span>
          </FieldRow>
        </SettingSection>

        <SettingSection
          :title="t('appearance.background')"
        >
          <template #actions>
            <el-switch
              size="small"
              :model-value="Boolean(appearance.background)"
              @update:model-value="(v: string | number | boolean) => setOverride('background', Boolean(v))"
            />
          </template>

          <FieldRow :label="t('appearance.bgColor')">
            <ColorField
              v-if="appearance.background"
              :model-value="backgroundFields.color ?? config.appearance.background.color"
              @update:model-value="(v: string) => patchBackground({ color: v })"
            />
            <span v-else class="iad-row__empty">{{ t('common.followGlobal') }}</span>
          </FieldRow>

          <template v-if="appearance.background">
            <FieldRow :label="t('appearance.bgAlpha')">
              <SliderField
                :model-value="backgroundFields.alpha ?? config.appearance.background.alpha"
                :min="0"
                :max="1"
                :step="0.01"
                @update:model-value="(v: number) => patchBackground({ alpha: v })"
              />
            </FieldRow>
            <FieldRow :label="t('appearance.radius')">
              <SliderField
                :model-value="backgroundFields.radius ?? config.appearance.background.radius"
                :min="0"
                :max="60"
                unit="px"
                @update:model-value="(v: number) => patchBackground({ radius: v })"
              />
            </FieldRow>
            <FieldRow :label="t('appearance.padding')">
              <SliderField
                :model-value="backgroundFields.padding ?? config.appearance.background.padding"
                :min="0"
                :max="64"
                unit="px"
                @update:model-value="(v: number) => patchBackground({ padding: v })"
              />
            </FieldRow>
          </template>
        </SettingSection>

        <SettingSection
          :title="`${t('appearance.border')} / ${t('appearance.shadow')}`"
          :default-open="false"
        >
          <p v-if="!appearance.background" class="iad-note">
            {{ t('appearance.overrideNeedBackground') }}
          </p>
          <template v-else>
            <FieldRow :label="t('appearance.borderWidth')">
              <SliderField
                :model-value="backgroundFields.borderWidth ?? config.appearance.background.borderWidth"
                :min="0"
                :max="8"
                :step="0.5"
                unit="px"
                @update:model-value="(v: number) => patchBackground({ borderWidth: v })"
              />
            </FieldRow>
            <FieldRow :label="t('appearance.borderColor')">
              <ColorField
                :model-value="backgroundFields.borderColor ?? config.appearance.background.borderColor"
                @update:model-value="(v: string) => patchBackground({ borderColor: v })"
              />
            </FieldRow>
            <FieldRow :label="t('appearance.shadowStrength')">
              <SliderField
                :model-value="backgroundFields.shadow ?? config.appearance.background.shadow"
                :min="0"
                :max="100"
                @update:model-value="(v: number) => patchBackground({ shadow: v })"
              />
            </FieldRow>
            <FieldRow :label="t('appearance.shadowColor')">
              <ColorField
                :model-value="backgroundFields.shadowColor ?? config.appearance.background.shadowColor"
                @update:model-value="(v: string) => patchBackground({ shadowColor: v })"
              />
            </FieldRow>
          </template>
        </SettingSection>

        <SettingSection
          :title="t('appearance.textGroup')"
        >
          <!-- 字重/字距/单行透明度默认收起：四段样式全铺开，一屏又没了 -->
          <template #actions>
            <el-button link size="small" @click="fullText = !fullText">
              {{ fullText ? t('appearance.textCompact') : t('appearance.textFull') }}
            </el-button>
          </template>

          <div class="iad-styles">
            <div v-for="entry in styles" :key="entry.key" class="iad-style">
              <div class="iad-style__head">
                <span class="iad-style__name">{{ entry.label }}</span>
                <el-switch
                  size="small"
                  :model-value="Boolean(appearance[entry.key])"
                  @update:model-value="(v: string | number | boolean) => setOverride(entry.key, Boolean(v))"
                />
              </div>
              <TextStyleEditor
                v-if="appearance[entry.key]"
                :title="entry.label"
                :show-title="false"
                :sample="entry.sample"
                :compact="!fullText"
                :model-value="appearance[entry.key] as TextStyle"
                @update:model-value="(v: TextStyle) => patchStyle(entry.key, v)"
              />
              <p v-else class="iad-style__empty">{{ t('common.followGlobal') }}</p>
            </div>
          </div>
        </SettingSection>
      </div>

    </div>

    <template #footer>
      <div class="iad__footer">
        <el-button link type="danger" @click="resetAll">
          {{ t('editor.appearanceReset') }}
        </el-button>
        <el-button type="primary" @click="emit('update:visible', false)">
          {{ t('common.confirm') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 分区较多，表单自己滚：弹窗高度不能无限长 */
.iad__fields {
  display: flex;
  flex-direction: column;
  max-height: min(70vh, 620px);
  overflow: auto;
  padding-right: 4px;
}

.iad__tip {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.iad-row__empty {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.iad-note {
  margin: 0;
  padding: 6px 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

/* 四段文字样式：窗口够宽才并两列，否则一列。
   固定两列时每格只有 ~270px，字号滑条被压到 100px 出头，基本没法拖。 */
.iad-styles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 10px 12px;
  margin-top: 4px;
}

.iad-style {
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-extra-light);
  border-radius: 10px;
}

/* 名称在左、覆盖开关在右：开关不能挤在标题前面，否则四张卡看上去像一排复选框 */
.iad-style__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.iad-style__name {
  font-size: 13px;
  font-weight: 600;
}

.iad-style__empty {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.iad-style :deep(.text-style-editor) {
  margin: 6px 0 0;
  padding: 8px 10px;
  background: transparent;
  border: 0;
}

.iad__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

@media (max-width: 720px) {
  .iad-styles {
    grid-template-columns: 1fr;
  }
}
</style>
