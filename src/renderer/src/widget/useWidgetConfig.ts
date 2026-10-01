import { computed, onBeforeUnmount, ref, type ComputedRef } from 'vue'
import type { AppConfig } from '@shared/types'
import { config } from '@/composables/useConfig'

/**
 * 组件窗口的生效配置。
 *
 * 编辑子页在改草稿时，主进程会把「持久化配置 + 草稿覆盖」推到 `widget:preview`；
 * 这里优先用它，没收到过就回落到 `useConfig` 的持久化配置。
 * 草稿清空时主进程会再推一次不带覆盖的配置，所以不需要额外的还原逻辑。
 */
export function useWidgetConfig(): ComputedRef<AppConfig> {
  const override = ref<AppConfig | null>(null)
  const unsubscribe = window.cd.onWidgetConfig((next) => {
    override.value = next
  })
  onBeforeUnmount(unsubscribe)
  return computed(() => override.value ?? config.value)
}
