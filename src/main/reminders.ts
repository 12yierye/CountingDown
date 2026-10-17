import { Notification } from 'electron'
import { getConfig } from './config-store'
import { computeCountdown, resolveTarget } from '../shared/defaults'

/**
 * 到期提醒。
 *
 * 只在「当天」提醒，每个倒数日每天最多一次：`notified` 记的是 id → 日期，
 * 进程重启后内存清空会再提醒一次 —— 这是刻意的，否则用户关了应用再打开
 * 就再也收不到当天的提醒了。频率 15 分钟足够，不值得上更精细的调度。
 */
const notified = new Map<string, string>()
const CHECK_MS = 15 * 60 * 1000
let timer: ReturnType<typeof setInterval> | null = null

function dayKey(date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function check(): void {
  const config = getConfig()
  // 总开关 = 通知权限。关掉之后任何一项都不再提醒
  if (config.runtime.notifications === false) return
  if (!Notification.isSupported()) return

  const today = dayKey()
  const zh = config.runtime.language !== 'en-US'

  for (const item of config.countdowns) {
    if (!item.enabled) continue
    // 当日提醒是**每一项自己**的开关，不跟随全局，默认关闭
    if (item.notifyOnToday !== true) continue
    if (notified.get(item.id) === today) continue

    const target = resolveTarget(item.target, config.target)
    const result = computeCountdown(target)
    if (result.state !== 'today') continue

    notified.set(item.id, today)
    const name = item.name || (zh ? '未命名倒数日' : 'Untitled countdown')
    try {
      new Notification({
        title: zh ? `${name} 就是今天` : `${name} is today`,
        body: zh ? '桌面组件上可以看到它' : 'It is on your desktop widget',
        silent: false
      }).show()
    } catch (error) {
      console.error('[reminder] 通知发送失败', error)
    }
  }
}

export function startReminders(): void {
  if (timer) return
  // 启动后 4 秒再查，别和窗口创建、托盘初始化抢时间
  setTimeout(check, 4000)
  timer = setInterval(check, CHECK_MS)
}

export function stopReminders(): void {
  if (timer) clearInterval(timer)
  timer = null
}
