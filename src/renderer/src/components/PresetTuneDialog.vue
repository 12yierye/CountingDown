<script setup lang="ts">
/**
 * 「手动调整所有参数」的模态框。
 *
 * 这里面的改动全部落在一份**深拷贝草稿**上：取消即丢弃，点「保存预设」才由调用方把草稿
 * 存成预设。全局外观、桌面卡片、外观设置页的控件值都不受这里影响 —— 这正是它和
 * 「当前全局外观」那个保存来源的区别（后者是存预设 + 覆盖全局）。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, AppearanceConfig } from '@shared/types'
import AppearanceFields from '@/components/AppearanceFields.vue'
import CountdownPreview from '@/components/CountdownPreview.vue'

const props = defineProps<{
  modelValue: boolean
  /** 提供文案、行为、语言等预览上下文；外观部分会被草稿覆盖 */
  config: AppConfig
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
 * 而且每次打开都重置草稿，下次永远从「当前全局外观」起步，不做续作。
 */
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    draft.value = cloneAppearance(props.config.appearance)
    name.value = ''
    nameError.value = false
  },
  { immediate: true }
)

/** 预览：只换掉 appearance，其余（文案、显示模式、语言）沿用真实配置 */
const previewConfig = computed<AppConfig>(() => ({ ...props.config, appearance: draft.value }))

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
    :title="t('preset.tuneTitle')"
    width="860px"
    top="5vh"
    destroy-on-close
  >
    <!--
      整块内容包一层：高度上限与滚动落在这一层（见 settings.css），
      这样弹窗外框始终被内容撑到合适高度，不需要给 .el-dialog 写任何 display/height hack。
    -->
    <div class="tune-dialog__inner">
      <p class="tune-dialog__note">{{ t('preset.tuneNameFirst') }}</p>

      <div class="tune-dialog__body">
        <div class="tune-dialog__left">
          <AppearanceFields v-model:appearance="draft" dense />
        </div>
        <aside class="tune-dialog__preview">
          <div class="tune-dialog__preview-label">{{ t('preset.tunePreview') }}</div>
          <CountdownPreview
            :config="previewConfig"
            :title="name.trim() || t('preset.namePlaceholder')"
          />
        </aside>
      </div>

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
      <el-button type="primary" @click="submit">{{ t('preset.tuneConfirm') }}</el-button>
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

.tune-dialog__body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.tune-dialog__left {
  flex: 1;
  min-width: 0;
  padding-right: 6px;
}

.tune-dialog__preview {
  flex: none;
  width: 296px;
  padding: 10px 12px 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  background: linear-gradient(135deg, var(--el-fill-color-darker), var(--el-fill-color-light));
  overflow: hidden;
}

.tune-dialog__preview-label {
  font-size: 12px;
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
