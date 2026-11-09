import type { AppConfig, CountdownItem } from '../shared/types'
import { getConfig } from './config-store'

/**
 * 编辑中的草稿：纯内存，永不落盘。
 *
 * 有草稿时，组件窗口渲染的就是这份草稿（见 widgetConfig），并且会被强制显示 ——
 * 用户正在编辑/调外观，桌面上必须看得见结果。离开编辑页（或设置窗口被隐藏/关闭）
 * 时覆盖层被清空，卡片回到「编辑前」的持久化配置，显示状态也一并还原。
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

/** 供自动化验证使用：当前草稿的只读快照（内存里那一份，绝不落盘） */
export function previewOverlay(): { id: string; name: string } | null {
  if (!previewItem) return null
  return { id: previewItem.id, name: previewItem.name }
}

/**
 * 组件窗口应当渲染的配置：持久化配置（必要时）叠加草稿覆盖。
 *
 * 草稿**总是**成为当前显示项 —— 编辑一项还没显示在桌面上的倒数日时，
 * 卡片就应当变成这一项（「进入编辑自动显示倒数日」）。同时把 `enabled`
 * 强制为 true：用户在编辑页里关掉「启用」时，预览不该整张消失，
 * 否则改外观就失去了参照。
 */
export function widgetConfig(): AppConfig {
  const base = getConfig()
  const draft = previewItem
  if (!draft) return base
  const preview: CountdownItem = { ...draft, enabled: true }
  const countdowns = base.countdowns.some((entry) => entry.id === preview.id)
    ? base.countdowns.map((entry) => (entry.id === preview.id ? preview : entry))
    : [...base.countdowns, preview]
  return { ...base, countdowns, activeId: preview.id }
}
