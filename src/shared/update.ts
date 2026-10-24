/**
 * 在线更新：更新源的解析与版本比较（纯函数，主进程与测试共用）。
 *
 * 更新源就是 electron-builder 打包时顺手生成的 `latest.yml`
 * （`npm run dist` 会把它和安装包一起产在 release/ 里），
 * 把它和 `CountingDown_Setup_x.y.z.exe` 一起传到任意静态地址即可：
 * GitHub Releases、对象存储、自己的服务器都行，只要能直链 GET。
 *
 * 也接受 JSON：`{ "version": "1.3.0", "url": "...", "sha512": "...", "notes": "..." }`。
 * JSON 的好处是可以带多行发布说明（latest.yml 里没有这个字段）。
 */

/** 默认更新源：仓库最新 release 里的 latest.yml。留空则关闭在线更新 */
export const DEFAULT_UPDATE_FEED =
  'https://github.com/12yierye/CountingDown/releases/latest/download/latest.yml'

export interface UpdateFeed {
  version: string
  /** 安装包直链（相对地址会按更新源所在目录补全） */
  url: string
  sha512?: string
  size?: number
  releaseDate?: string
  notes?: string
}

/** 只比较数字段，`v` 前缀与 `-beta.1` 这类预发布后缀先忽略 */
export function compareVersions(a: string, b: string): number {
  const toParts = (value: string): number[] =>
    String(value ?? '')
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((piece) => {
        const num = Number.parseInt(piece, 10)
        return Number.isFinite(num) ? num : 0
      })
  const left = toParts(a)
  const right = toParts(b)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

/** `latest.yml` 里的 url 可能只是文件名，按更新源所在目录补全 */
export function resolveFeedUrl(feedUrl: string, relative: string): string {
  const value = String(relative ?? '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  try {
    return new URL(value, feedUrl).toString()
  } catch {
    return value
  }
}

/**
 * 更新源可以写多个，按空格 / 逗号 / 换行分隔，按顺序尝试。
 * 场景：GitHub 直链时通时不通，前面放直连、后面放镜像。
 * 非 http(s) 的片段直接丢掉，免得拼出个相对地址再去请求。
 */
export function parseFeedUrls(raw: string): string[] {
  const list = String(raw ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => /^https?:\/\//i.test(entry))
  return [...new Set(list)]
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function pick(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

/**
 * 解析更新源。
 *
 * `latest.yml` 的字段位置是固定的（electron-builder 生成），所以这里按行取首个匹配，
 * 不引入 YAML 依赖：多文件（x64 + arm64）时取到的就是第一个文件 —— 本项目的
 * 打包目标只有 nsis/x64，够用；将来要多架构再补。
 */
export function parseUpdateFeed(text: string, feedUrl: string): UpdateFeed | null {
  const raw = String(text ?? '').trim()
  if (!raw) return null

  if (raw.startsWith('{')) {
    let json: Record<string, unknown>
    try {
      json = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return null
    }
    const files = Array.isArray(json.files) ? (json.files as Record<string, unknown>[]) : []
    const version = pick(json, ['version', 'tag_name', 'tag'])
    const url =
      pick(json, ['url', 'path', 'download']) ||
      (files[0] ? pick(files[0], ['url', 'path']) : '')
    const sha512 = pick(json, ['sha512']) || (files[0] ? pick(files[0], ['sha512']) : '')
    const sizeRaw = files[0]?.size ?? json.size
    const size = Number(sizeRaw)
    if (!version || !url) return null
    return {
      version: stripPrefix(version),
      url: resolveFeedUrl(feedUrl, url),
      sha512: sha512 || undefined,
      size: Number.isFinite(size) && size > 0 ? size : undefined,
      releaseDate: pick(json, ['releaseDate', 'published_at', 'date']) || undefined,
      notes: pick(json, ['notes', 'releaseNotes', 'body']) || undefined
    }
  }

  const lines = raw.split(/\r?\n/)
  let version = ''
  let url = ''
  let sha512 = ''
  let size = 0
  let releaseDate = ''
  let notes = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (!version) {
      const match = /^version:\s*(.+)$/.exec(trimmed)
      if (match) {
        version = unquote(match[1])
        continue
      }
    }
    if (!url) {
      const match = /^(?:-\s*)?url:\s*(.+)$/.exec(trimmed) ?? /^path:\s*(.+)$/.exec(trimmed)
      if (match) {
        url = unquote(match[1])
        continue
      }
    }
    if (!sha512) {
      const match = /^sha512:\s*(.+)$/.exec(trimmed)
      if (match) {
        sha512 = unquote(match[1])
        continue
      }
    }
    if (!size) {
      const match = /^size:\s*(\d+)\s*$/.exec(trimmed)
      if (match) {
        size = Number(match[1])
        continue
      }
    }
    if (!releaseDate) {
      const match = /^releaseDate:\s*(.+)$/.exec(trimmed)
      if (match) {
        releaseDate = unquote(match[1])
        continue
      }
    }
    if (!notes) {
      const match = /^releaseNotes:\s*(.+)$/.exec(trimmed)
      if (match) notes = unquote(match[1])
    }
  }

  if (!version || !url) return null
  return {
    version: stripPrefix(version),
    url: resolveFeedUrl(feedUrl, url),
    sha512: sha512 || undefined,
    size: size > 0 ? size : undefined,
    releaseDate: releaseDate || undefined,
    notes: notes || undefined
  }
}

function stripPrefix(version: string): string {
  return version.trim().replace(/^v/i, '')
}

/** 安装包体积显示成 82.6 MB */
export function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return ''
  const mb = bytes / 1024 / 1024
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * 从更新源地址推出「手动下载页」。
 * GitHub 的资产直链形如 `/releases/download/<tag>/x.exe` 或 `/releases/latest/download/x.yml`，
 * 去掉后面两段就是 release 页面 —— 检查/下载不通时，至少还能让用户自己去下。
 */
export function releasePageOf(feedUrl: string): string {
  const value = String(feedUrl ?? '').trim()
  if (!value) return ''
  const latest = /^(.*?)\/releases\/(?:latest\/)?download\//i.exec(value)
  if (latest) return `${latest[1]}/releases/latest`
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname.replace(/\/[^/]*$/, '')}`
  } catch {
    return value
  }
}
