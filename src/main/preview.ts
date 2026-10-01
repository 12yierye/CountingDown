import type { AppConfig, CountdownItem } from '../shared/types'
import { getConfig } from './config-store'

/**
 * 编辑中的草稿：纯内存，永不落盘。
 *
 * 只有「草稿项 == 当前桌面显示项」时才套给组件窗口，因此编辑一个没有显示在
 * 桌面上的项不会让卡片突然换内容。编辑器离开编辑页（或设置窗口被隐藏/关闭）时
 * 覆盖层会被清空，桌面卡片于是自然回到「编辑前」的持久化配置。
 */
let previewItem: CountdownItem | null = null

/** 入口深拷贝：渲染层给来的是 Vue 响应式 Proxy，直接持有会在后续读到别的状态 */
export function setPreviewItem(item: CountdownItem | null): void {
  previewItem = item ? (JSON.parse(JSON.stringify(item)) as CountdownItem) : null
}

export function clearPreviewItem(): void {
  previewItem = null
}

export function getPreviewItem(): CountdownItem | null {
  return previewItem
}

/** 组件窗口应当渲染的配置：持久化配置（必要时）叠加草稿覆盖 */
export function widgetConfig(): AppConfig {
  const base = getConfig()
  const draft = previewItem
  if (!draft) return base
  // 编辑的不是当前桌面显示项 -> 卡片保持不变
  if (base.activeId !== draft.id) return base
  const index = base.countdowns.findIndex((entry) => entry.id === draft.id)
  if (index < 0) return base
  const countdowns = [...base.countdowns]
  countdowns[index] = draft
  return { ...base, countdowns }
}
