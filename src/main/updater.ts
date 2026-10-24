/**
 * 在线更新（主进程侧）。
 *
 * 流程刻意拆成三步，不自动串起来：
 *   检查 → 用户点「下载」→ 用户点「重启并安装」
 * 原因：安装包 80MB 起步，静默下载会吃流量也吃磁盘；而且没有代码签名，
 * 装的时候系统照样会弹一次「未知发布者」，与其偷偷装完再弹，不如让用户自己按下去。
 *
 * 更新源只需一个静态直链（electron-builder 生成的 latest.yml），
 * 下载完先按文件里的 sha512 校验，校验不过直接删掉 —— 这个包是要被执行（run）的。
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Transform, pipeline } from 'node:stream'
import { Notification, app, net, session, shell, type Session } from 'electron'
import {
  compareVersions,
  parseFeedUrls,
  parseUpdateFeed,
  releasePageOf,
  type UpdateFeed
} from '../shared/update'
import type { UpdateState } from '../shared/types'
import { getConfig, isDev, onConfigChange } from './config-store'

type Listener = (state: UpdateState) => void

let state: UpdateState = { phase: 'idle', current: app.getVersion(), feedUrl: '' }
/** 检查通过后待下载的那一条 */
let pending: UpdateFeed | null = null
let downloadedPath = ''
let busy = false
let lastProgressEmit = 0

const listeners = new Set<Listener>()

export function getUpdateState(): UpdateState {
  return { ...state }
}

export function onUpdateChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setState(patch: Partial<UpdateState>): UpdateState {
  state = { ...state, ...patch }
  for (const listener of listeners) {
    try {
      listener(getUpdateState())
    } catch (error) {
      console.error('[update] listener failed', error)
    }
  }
  return getUpdateState()
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 把 Chromium 的网络错误翻译成人话。
 *
 * 原始错误长这样：`net::ERR_CONNECTION_RESET`、`Fetch Failed`、`HTTP 404`，
 * 直接甩给用户等于没说 —— 他既不知道是没网、被墙、还是更新源没发布。
 */
function humanize(raw: unknown): string {
  const text = String(raw instanceof Error ? raw.message : raw ?? '').trim()
  if (!text) return '未知错误'
  const rules: [RegExp, string][] = [
    [/ERR_INTERNET_DISCONNECTED/i, '没有网络连接'],
    [/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/i, '域名解析失败，检查 DNS 或代理'],
    [/ERR_PROXY_CONNECTION_FAILED/i, '代理连不上，检查代理设置'],
    [/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|请求超时/i, '连接超时，网络太慢或被拦截'],
    [/ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_REFUSED/i, '连接被重置，可能是网络被拦截'],
    [/ERR_EMPTY_RESPONSE|ERR_CONTENT_LENGTH_MISMATCH/i, '服务器没有返回数据'],
    [/ERR_CERT/i, '证书校验失败'],
    [/ERR_ABORTED|ERR_BLOCKED/i, '请求被中止'],
    [/ERR_FAILED|Fetch Failed|Failed to fetch/i, '请求失败，网络被拦截或代理不可用'],
    [/HTTP 404/i, '更新源不存在（这个版本可能还没发布）'],
    [/HTTP 401|HTTP 403/i, '更新源拒绝访问'],
    [/HTTP 5\d\d/i, '更新源服务器出错，稍后再试'],
    [/无法解析/, '更新源内容不是有效的 latest.yml / JSON']
  ]
  for (const [pattern, message] of rules) {
    if (pattern.test(text)) return message
  }
  return text.replace(/^Error:\s*/i, '')
}

/**
 * 更新检查单独用一个 session：这样「只给更新走代理」是可行的，
 * 也不会把用户的系统代理设置带到别的地方去。
 * 分区不带 persist 前缀 → 不落盘，退出即清。
 */
let updateSession: Session | null = null

async function resolveSession(): Promise<Session | null> {
  try {
    if (!updateSession) updateSession = session.fromPartition('update-feed')
    const proxy = (getConfig().runtime.update?.proxy ?? '').trim()
    if (!proxy) await updateSession.setProxy({ mode: 'system' })
    else if (proxy === 'direct') await updateSession.setProxy({ mode: 'direct' })
    else await updateSession.setProxy({ proxyRules: proxy, proxyBypassRules: '<local>' })
    return updateSession
  } catch (error) {
    // 拿不到独立 session 就退回默认 session，别因此让整个检查失败
    console.error('[update] proxy session unavailable, falling back to default', error)
    return null
  }
}

/** 主进程里没有全局 fetch 的把握，统一走 Electron 的 net（顺带吃到系统/自定义代理） */
async function requestText(url: string, timeout = 12000): Promise<string> {
  const proxySession = await resolveSession()
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: 'follow', session: proxySession ?? undefined })
    const timer = setTimeout(() => {
      request.abort()
      reject(new Error('请求超时'))
    }, timeout)
    request.on('response', (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        clearTimeout(timer)
        request.abort()
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => {
        clearTimeout(timer)
        resolve(Buffer.concat(chunks).toString('utf8'))
      })
      response.on('error', (error: Error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    request.on('error', (error: Error) => {
      clearTimeout(timer)
      reject(error)
    })
    request.end()
  })
}

/**
 * 带重试地取更新源。
 *
 * 只对「网络层抖动」重试：404 这类确定性失败重试也没用，只会让用户多等。
 * 有多个候选地址时每个只试一次 —— 与其在第一个地址上死等两轮，
 * 不如把时间留给下一个候选（12s × 候选数 是可接受的上限）。
 */
async function requestFeed(url: string, attempts = 2): Promise<string> {
  let lastError: unknown = null
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await requestText(url)
    } catch (error) {
      lastError = error
      const text = String(error instanceof Error ? error.message : error)
      if (/HTTP 4\d\d/.test(text)) break
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 1200))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function feedUrlOf(): string {
  return (getConfig().runtime.update?.feedUrl ?? '').trim()
}

/**
 * 检查更新。
 *
 * `manual = false` 是启动后的静默检查：失败时**不**把界面推进 error，
 * 否则用户一开「关于」就看到一条红字，明明什么都没做。
 * 静默失败只记在 state.error 上（phase 仍是 idle），界面用一句软话带过。
 *
 * `feedUrl` 可以写多个地址（空格 / 逗号 / 换行分隔），按顺序试：
 * GitHub 直链在国内时通时不通，留一个镜像做后备比让用户干瞪眼强。
 */
export async function checkForUpdate(manual = false): Promise<UpdateState> {
  const candidates = parseFeedUrls(feedUrlOf())
  if (!candidates.length) {
    pending = null
    return setState({
      phase: 'disabled',
      feedUrl: '',
      latest: undefined,
      error: undefined,
      progress: undefined,
      current: app.getVersion()
    })
  }
  // 正在下载时别插一脚：打断它既丢进度也丢已经下到的字节
  if (state.phase === 'downloading') return getUpdateState()
  if (busy) return getUpdateState()

  busy = true
  setState({
    phase: 'checking',
    feedUrl: candidates[0],
    error: undefined,
    progress: undefined,
    current: app.getVersion()
  })

  try {
    let feed: UpdateFeed | null = null
    let usedUrl = candidates[0]
    let lastError: unknown = null
    for (const candidate of candidates) {
      try {
        const text = await requestFeed(candidate, candidates.length > 1 ? 1 : 2)
        const parsed = parseUpdateFeed(text, candidate)
        if (!parsed) throw new Error('更新源内容不是有效的 latest.yml / JSON')
        feed = parsed
        usedUrl = candidate
        break
      } catch (error) {
        lastError = error
        console.error('[update] feed failed', candidate, error)
      }
    }
    // 全部候选都不通才认输；有任何一个成功就用它
    if (!feed) throw lastError ?? new Error('没有可用的更新源')
    setState({ feedUrl: usedUrl })

    const checkedAt = Date.now()
    if (compareVersions(feed.version, app.getVersion()) <= 0) {
      pending = null
      return setState({
        phase: 'latest',
        latest: feed.version,
        size: feed.size,
        releaseDate: feed.releaseDate,
        notes: feed.notes,
        checkedAt
      })
    }

    pending = feed
    // 上次已经下完（没来得及装，或者装了没成功）就不再让用户下一遍
    const existing = targetFileOf(feed)
    if (existsSync(existing) && (!feed.size || statSync(existing).size === feed.size)) {
      downloadedPath = existing
      return setState({
        phase: 'ready',
        latest: feed.version,
        size: feed.size,
        releaseDate: feed.releaseDate,
        notes: feed.notes,
        progress: 1,
        checkedAt
      })
    }

    const next = setState({
      phase: 'available',
      latest: feed.version,
      size: feed.size,
      releaseDate: feed.releaseDate,
      notes: feed.notes,
      checkedAt
    })
    if (!manual) notifyAvailable(feed.version)
    return next
  } catch (error) {
    pending = null
    const message = humanize(error)
    const checkedAt = Date.now()
    if (!manual) {
      // 静默检查失败：保留一句软提示，但不把整个卡片染成错误态
      return setState({ phase: 'idle', error: message, checkedAt })
    }
    return setState({ phase: 'error', error: message, checkedAt })
  } finally {
    busy = false
  }
}

/** 「手动下载」：更新源所在的发布页，检查/下载失败时的兜底出口 */
export function openDownloadPage(): boolean {
  // 配置里可能是多个地址，取第一个能解析成发布页的
  const [first] = parseFeedUrls(state.feedUrl || feedUrlOf())
  const url = first ? releasePageOf(first) : ''
  if (!url) return false
  void shell.openExternal(url)
  return true
}

/** 静默检查发现新版本时只提示一句，不代替用户点下载 */
function notifyAvailable(version: string): void {
  if (getConfig().runtime.notifications === false) return
  if (!Notification.isSupported()) return
  try {
    new Notification({
      title: '发现新版本',
      body: `倒数日 ${version} 已发布，打开「设置 → 关于」即可下载更新`,
      silent: true
    }).show()
  } catch {
    /* 通知发不出去不影响流程 */
  }
}

function updateDir(): string {
  const dir = join(app.getPath('userData'), 'update')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function targetFileOf(feed: UpdateFeed): string {
  const name = basename(feed.url).split('?')[0]
  const safe = /\.exe$/i.test(name) ? name : `CountingDown_Setup_${feed.version}.exe`
  return join(updateDir(), safe.replace(/[<>:"/\\|?*]/g, '_'))
}

/** 下载安装包，边下边算 sha512；进度最多每 120ms 推一次，别拿 IPC 刷屏 */
export async function downloadUpdate(): Promise<UpdateState> {
  if (state.phase === 'downloading') return getUpdateState()
  const feed = pending
  if (!feed) return checkForUpdate(true)

  const target = targetFileOf(feed)
  // 上次下到一半的残包先清掉，否则追加写会得到一个大杂烩
  if (existsSync(target)) {
    try {
      unlinkSync(target)
    } catch {
      /* 删不掉就让下面的写入报错，别在这里吞掉 */
    }
  }

  setState({ phase: 'downloading', progress: 0, error: undefined })

  try {
    const proxySession = await resolveSession()
    // 80MB 的包在烂网络上一断就白下，给一次重来机会
    try {
      await downloadToFile(feed, target, proxySession)
    } catch (first) {
      console.error('[update] download retry after', first)
      setState({ progress: 0 })
      await downloadToFile(feed, target, proxySession)
    }
    downloadedPath = target
    return setState({ phase: 'ready', progress: 1 })
  } catch (error) {
    downloadedPath = ''
    return setState({ phase: 'error', error: humanize(error), progress: undefined })
  }
}

function downloadToFile(
  feed: UpdateFeed,
  target: string,
  proxySession: Session | null
): Promise<void> {
  return new Promise((resolve, reject) => {
    // 和检查走同一个 session：用户给更新配的代理，下载也得吃到
    const request = net.request({
      url: feed.url,
      redirect: 'follow',
      session: proxySession ?? undefined
    })
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      try {
        request.abort()
      } catch {
        /* ignore */
      }
      try {
        if (existsSync(target)) unlinkSync(target)
      } catch {
        /* ignore */
      }
      reject(error)
    }

    request.on('error', fail)
    request.on('response', (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        fail(new Error(`下载失败：HTTP ${response.statusCode}`))
        return
      }
      const headerLength = response.headers['content-length']
      const total =
        Number(Array.isArray(headerLength) ? headerLength[0] : headerLength) || feed.size || 0
      const hash = createHash('sha512')
      let received = 0

      // 计量放在管道里：既算哈希又报进度，顺带把背压交给 pipeline 处理，
      // 不会因为 80MB 一次性灌进内存
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          const buffer = Buffer.from(chunk)
          received += buffer.length
          hash.update(buffer)
          const now = Date.now()
          if (total && now - lastProgressEmit > 120) {
            lastProgressEmit = now
            setState({ progress: Math.min(1, received / total) })
          }
          callback(null, buffer)
        }
      })

      // Electron 的 IncomingMessage 运行时就是 Node Readable，只是类型声明没继承 Readable，
      // 这里做一次收窄：拿它当流用，好让 pipeline 帮我们处理背压与收尾
      pipeline(
        response as unknown as NodeJS.ReadableStream,
        meter,
        createWriteStream(target),
        (error) => {
          if (settled) return
          if (error) {
            fail(error instanceof Error ? error : new Error(String(error)))
            return
          }
          if (feed.size && received !== feed.size) {
            fail(new Error(`安装包不完整（${received}/${feed.size} 字节）`))
            return
          }
          if (feed.sha512) {
            const actual = hash.digest('base64')
            if (actual !== feed.sha512) {
              fail(new Error('安装包校验失败，已删除'))
              return
            }
          }
          settled = true
          resolve()
        }
      )
    })
    request.end()
  })
}

/** 拉起安装包并退出：NSIS 会接着装，装完用户可以勾「运行」 */
export function installUpdate(): boolean {
  if (state.phase !== 'ready') return false
  if (!downloadedPath || !existsSync(downloadedPath)) {
    setState({ phase: 'error', error: '安装包已不存在，请重新下载' })
    return false
  }
  try {
    // 先确认能读到文件大小，避免拉一个空壳
    if (statSync(downloadedPath).size <= 0) throw new Error('安装包为空')
    // --silent：更新不该再走一遍安装向导；--dir 指向当前安装目录，覆盖原地
    const installDir = dirname(app.getPath('exe'))
    const child = spawn(downloadedPath, ['--silent', '--dir', installDir], {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    setTimeout(() => app.quit(), 200)
    return true
  } catch (error) {
    setState({ phase: 'error', error: errorMessage(error) })
    return false
  }
}

/**
 * 启动后静默检查一次。
 * 开发模式下不查：版本号跟发布包一样，查出来也是「已是最新」，白跑一趟网络。
 */
export function scheduleAutoCheck(delay = 12000): void {
  const timer = setTimeout(() => {
    if (isDev()) return
    const update = getConfig().runtime.update
    if (!update?.autoCheck || !update.feedUrl?.trim()) return
    void checkForUpdate(false)
  }, delay)
  // 别让这个定时器拖住进程退出
  timer.unref()
}

/** 更新源被改掉时把上一次的结果清空，别让界面显示别处的版本号 */
export function watchUpdateConfig(): void {
  let lastFeed = feedUrlOf()
  onConfigChange(() => {
    const next = feedUrlOf()
    if (next === lastFeed) return
    lastFeed = next
    pending = null
    downloadedPath = ''
    setState({
      phase: 'idle',
      feedUrl: next,
      latest: undefined,
      notes: undefined,
      size: undefined,
      releaseDate: undefined,
      progress: undefined,
      checkedAt: undefined,
      error: undefined
    })
  })
}
