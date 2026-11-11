<script setup lang="ts">
/**
 * 「手动调整所有参数」的模态框。
 *
 * 这里面的改动全部落在一份**深拷贝草稿**上：取消即丢弃，点「保存预设」才由调用方把草稿
 * 存成预设。全局外观、桌面卡片、外观设置页的控件值都不受这里影响 —— 这正是它和
 * 「当前全局外观」那个保存来源的区别（后者是存预设 + 覆盖全局）。
 *
 * 弹窗里**不放实时预览**：与「外观」全局页保持一致（那边也只有表单，效果看桌面卡片）。
 * 之前右侧那列 296px 的缩略图把表单压到 530px 宽，两列网格每格只剩 247px，滑条几乎拖不开。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, AppearanceConfig } from '@shared/types'
import AppearanceFields from '@/components/AppearanceFields.vue'

const props = defineProps<{
  modelValue: boolean
  /** 新建时以它的 appearance 作为草稿起点 */
  config: AppConfig
  /** 编辑已有预设时传入它当前的外观；为空表示新建（从全局外观起步） */
  initialAppearance?: AppearanceConfig | null
  /** 编辑已有预设时传入它当前的名字 */
  initialName?: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm', payload: { name: string; appearance: AppearanceConfig }): void
}>()

const { t } = useI18n()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

/** 深拷贝：草稿与全局配置之间不能留任何共享引用，否则改草稿就等于改全局 */
function cloneAppearance(source: AppearanceConfig): AppearanceConfig {
  return JSON.parse(JSON.stringify(source)) as AppearanceConfig
}

const draft = ref<AppearanceConfig>(cloneAppearance(props.config.appearance))
const name = ref('')
const nameError = ref(false)

/**
 * 用 watch 而不是在 setup 里算一次：这个组件挂载时配置可能还没从主进程加载回来；
 * 而且每次打开都重置草稿 —— 新建时从「当前全局外观」起步，编辑时从该预设的现值起步。
 */
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    draft.value = cloneAppearance(props.initialAppearance ?? props.config.appearance)
    name.value = props.initialName ?? ''
    nameError.value = false
  },
  { immediate: true }
)

/** 编辑态：标题、说明与按钮文案都跟着变 */
const editing = computed(() => Boolean(props.initialAppearance))

function submit(): void {
  const trimmed = name.value.trim()
  nameError.value = trimmed.length === 0
  if (!trimmed) return
  emit('confirm', { name: trimmed, appearance: cloneAppearance(draft.value) })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="tune-dialog"
    :title="editing ? t('preset.tuneTitleEdit') : t('preset.tuneTitle')"
    width="760px"
    align-center
    destroy-on-close
  >
    <!--
      整块内容包一层：高度上限与滚动落在这一层（见 settings.css），
      这样弹窗外框始终被内容撑到合适高度，不需要给 .el-dialog 写任何 display/height hack。
    -->
    <div class="tune-dialog__inner">
      <p class="tune-dialog__note">
        {{ editing ? t('preset.tuneNoteEdit') : t('preset.tuneNameFirst') }}
      </p>

      <!-- 这个弹窗的语义就是「手动调整所有参数」，因此强制展开高级项 -->
      <AppearanceFields v-model:appearance="draft" dense advanced />

      <!--
        名称放在**调完参数之后**问：进来先改外观，改满意了再起名保存。
        之前是保存弹窗先问一次名字、这里又落回「保存预设」，等于同一件事问了两遍。
      -->
      <el-form label-position="top" class="tune-dialog__name" @submit.prevent>
        <el-form-item :label="t('preset.nameLabel')">
          <el-input
            v-model="name"
            :placeholder="t('preset.namePlaceholder')"
            maxlength="20"
            show-word-limit
            @keydown.enter="submit"
          />
        </el-form-item>
        <p v-if="nameError" class="tune-dialog__error">{{ t('preset.nameRequired') }}</p>
      </el-form>
    </div>

    <template #footer>
      <el-button @click="visible = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" @click="submit">
        {{ editing ? t('preset.tuneConfirmEdit') : t('preset.tuneConfirm') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/*
 * 高度与滚动都由 settings.css 里对 .el-dialog__body 的规则收口，
 * 这一层只负责把三段内容按顺序排开，不再自己做任何限高（试过，会把 footer 顶出弹窗）。
 */
.tune-dialog__inner {
  min-height: 0;
}

.tune-dialog__note {
  margin: -6px 0 12px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.tune-dialog__name {
  margin-top: 12px;
}

.tune-dialog__error {
  margin: -8px 0 0;
  font-size: 12.5px;
  color: var(--el-color-danger);
}
</style>
