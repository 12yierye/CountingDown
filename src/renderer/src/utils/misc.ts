/**
 * 极小的发布/订阅工具：用于在写入配置后给设置界面一个短暂的「已保存」反馈。
 * 主进程写盘会广播全量配置，这里只在本地渲染进程内部使用。
 */
type Handler = () => void

const handlers = new Set<Handler>()

export function onSaved(handler: Handler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

export function emitSaved(): void {
  for (const handler of handlers) {
    try {
      handler()
    } catch (error) {
      console.warn('[saved] handler failed', error)
    }
  }
}
