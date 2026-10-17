<script setup lang="ts">
/**
 * 全局外观页：只负责把表单的改动转成对全局配置的 patch。
 * 控件本身住在 AppearanceFields 里，好让「保存预设 → 手动调整」的模态框复用同一套表单，
 * 而不是再抄一份（抄一份的下场是两边慢慢长歪）。
 *
 * 这个壳额外承担三件「页面级」的事：
 *   1. 「常用 / 高级」两种密度，状态存在 localStorage，不写进配置；
 *   2. 一键配色（顶部预设条）直接覆盖全局外观，撤销交给设置页的 Ctrl+Z；
 *   3. 分组重置 —— 只恢复这一组的默认值，比「恢复默认设置」那颗核弹温和得多。
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import type { AppConfig } from '@shared/types'
import { createDefaultConfig } from '@shared/defaults'
import AppearanceFields from '@/components/AppearanceFields.vue'

type AppearanceResetKey = 'font' | 'background' | 'border' | 'text'

const props = defineProps<{ config: AppConfig }>()
const emit = defineEmits<{ (event: 'patch', patch: unknown): void }>()

const { t } = useI18n()

const STORAGE_KEY = 'cd.appearance.advanced'

function readAdvanced(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const advanced = ref(readAdvanced())

watch(advanced, (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    /* 隐私模式下写不进去，不影响使用 */
  }
})

function patchAppearance(next: AppConfig['appearance']): void {
  emit('patch', { appearance: next })
}

/**
 * 分组重置：只把这一组字段换回出厂值，其余保持不动。
 * 背景组包含颜色 / 透明度 / 圆角 / 内边距 / 宽度；边框组只动边框与阴影，
 * 因为这两类在视觉上互为一组（改边框时经常顺手改阴影）。
 */
function resetGroup(key: AppearanceResetKey): void {
  const defaults = createDefaultConfig().appearance
  const current = props.config.appearance
  const background = current.background

  if (key === 'font') {
    patchAppearance({ ...current, fontFamily: defaults.fontFamily })
  } else if (key === 'background') {
    patchAppearance({
      ...current,
      background: {
        ...background,
        color: defaults.background.color,
        alpha: defaults.background.alpha,
        radius: defaults.background.radius,
        padding: defaults.background.padding,
        width: defaults.background.width
      }
    })
  } else if (key === 'border') {
    patchAppearance({
      ...current,
      background: {
        ...background,
        borderWidth: defaults.background.borderWidth,
        borderColor: defaults.background.borderColor,
        shadow: defaults.background.shadow,
        shadowColor: defaults.background.shadowColor
      }
    })
  } else {
    patchAppearance({
      ...current,
      textAlpha: defaults.textAlpha,
      title: defaults.title,
      count: defaults.count,
      hint: defaults.hint,
      status: defaults.status
    })
  }
  ElMessage.success(t('common.resetGroupDone'))
}
</script>

<template>
  <AppearanceFields
    :appearance="config.appearance"
    :advanced="advanced"
    @update:appearance="patchAppearance"
    @reset="resetGroup"
    @toggle-advanced="(value: boolean) => (advanced = value)"
  />
</template>
