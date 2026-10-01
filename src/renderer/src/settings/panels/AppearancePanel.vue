<script setup lang="ts">
/**
 * 全局外观页：只负责把表单的改动转成对全局配置的 patch。
 * 控件本身住在 AppearanceFields 里，好让「保存预设 → 手动调整」的模态框复用同一套表单，
 * 而不是再抄一份（抄一份的下场是两边慢慢长歪）。
 */
import type { AppConfig } from '@shared/types'
import AppearanceFields from '@/components/AppearanceFields.vue'

defineProps<{ config: AppConfig }>()
const emit = defineEmits<{ (event: 'patch', patch: unknown): void }>()
</script>

<template>
  <AppearanceFields
    :appearance="config.appearance"
    @update:appearance="(next) => emit('patch', { appearance: next })"
  />
</template>
