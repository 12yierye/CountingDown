// 更新源自检：一条命令回答「为什么检查更新总是失败」。
//
//   node scripts/update-doctor.cjs            # 用配置文件里的源（没有就用默认）
//   node scripts/update-doctor.cjs <url>      # 指定源，多个用空格/逗号分隔
//
// 分三层查，每层单独给结论：
//   1) DNS  —— 域名是不是被 hosts 写到 127.0.0.1（很多「Fetch Failed」都是这个）
//   2) HTTP —— 更新源本身能不能取到（404 说明 latest.yml 没上传）
//   3) 资产 —— latest.yml 里指的那个安装包在不在、大小对不对（只发 HEAD，不下 110MB）
const fs = require('node:fs')
const path = require('node:path')
const dns = require('node:dns')
const http = require('node:http')
const https = require('node:https')
const esbuild = require('esbuild')

const appRoot = path.resolve(__dirname, '..')
const logicFile = path.join(appRoot, '.verify/doctor-update.cjs')
esbuild.buildSync({
  entryPoints: [path.join(appRoot, 'src/shared/update.ts')],
  outfile: logicFile,
  format: 'cjs',
  platform: 'node',
  bundle: true,
  logLevel: 'silent'
})
const updateLogic = require(logicFile)

const GREEN = '\u001b[32m'
const RED = '\u001b[31m'
const YELLOW = '\u001b[33m'
const DIM = '\u001b[2m'
const RESET = '\u001b[0m'

const ok = (text) => `${GREEN}✓${RESET} ${text}`
const bad = (text) => `${RED}✗${RESET} ${text}`
const warn = (text) => `${YELLOW}!${RESET} ${text}`

/** 配置里写过的源优先，其次用内置默认值 */
function feedsFromConfig() {
  const file = path.join(process.env.APPDATA || '', 'countingdown', 'config.json')
  try {
    const config = JSON.parse(fs.readFileSync(file, 'utf8'))
    const value = String(config.runtime?.update?.feedUrl ?? '').trim()
    if (value) return { source: file, urls: updateLogic.parseFeedUrls(value) }
  } catch {
    /* 没有配置文件就走默认值 */
  }
  return { source: '内置默认值', urls: updateLogic.parseFeedUrls(updateLogic.DEFAULT_UPDATE_FEED) }
}

function lookup(host) {
  return new Promise((resolve) => {
    dns.lookup(host, { all: true }, (error, addresses) => {
      resolve(error ? { error: error.code || error.message, addresses: [] } : { addresses })
    })
  })
}

/** 只取头部：安装包有 110MB，不能为了「看一眼」把它下下来 */
function head(url, redirects = 4, timeout = 15000) {
  return new Promise((resolve) => {
    const started = Date.now()
    let request
    try {
      const parsed = new URL(url)
      request = parsed.protocol === 'http:' ? http.request(url, { method: 'HEAD' }) : https.request(url, { method: 'HEAD' })
    } catch (error) {
      resolve({ ok: false, error: String(error.message) })
      return
    }
    request.setTimeout(timeout, () => {
      request.destroy()
      resolve({ ok: false, error: 'TIMEOUT', ms: Date.now() - started })
    })
    request.on('response', (response) => {
      const { statusCode = 0, headers } = response
      if (statusCode >= 300 && statusCode < 400 && headers.location && redirects > 0) {
        response.resume()
        resolve(head(new URL(headers.location, url).toString(), redirects - 1, timeout))
        return
      }
      resolve({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, headers, ms: Date.now() - started })
    })
    request.on('error', (error) => resolve({ ok: false, error: error.code || error.message, ms: Date.now() - started }))
    request.end()
  })
}

function get(url, redirects = 4, timeout = 20000) {
  return new Promise((resolve) => {
    const started = Date.now()
    let request
    try {
      const parsed = new URL(url)
      request = parsed.protocol === 'http:' ? http.request(url) : https.request(url)
    } catch (error) {
      resolve({ ok: false, error: String(error.message) })
      return
    }
    request.setTimeout(timeout, () => {
      request.destroy()
      resolve({ ok: false, error: 'TIMEOUT', ms: Date.now() - started })
    })
    request.on('response', (response) => {
      const { statusCode = 0, headers } = response
      if (statusCode >= 300 && statusCode < 400 && headers.location && redirects > 0) {
        response.resume()
        resolve(get(new URL(headers.location, url).toString(), redirects - 1, timeout))
        return
      }
      const chunks = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () =>
        resolve({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, headers, body: Buffer.concat(chunks), ms: Date.now() - started })
      )
    })
    request.on('error', (error) => resolve({ ok: false, error: error.code || error.message, ms: Date.now() - started }))
    request.end()
  })
}

function isLoopback(address) {
  return /^(127\.|::1$|0\.0\.0\.0$)/.test(address)
}

async function main() {
  const argUrls = process.argv.slice(2).join(' ')
  const { source, urls } = argUrls.trim()
    ? { source: '命令行参数', urls: updateLogic.parseFeedUrls(argUrls) }
    : feedsFromConfig()

  console.log(`更新源（${source}）：共 ${urls.length} 个`)
  for (const url of urls) console.log(`  ${DIM}${url}${RESET}`)
  console.log('')

  let verdict = 0
  for (const url of urls) {
    const host = new URL(url).hostname
    console.log(`── ${host}`)

    // 写死的 IP / localhost 是用户故意的，别当成 hosts 屏蔽
    const literal = host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')
    const resolved = literal ? { addresses: [{ address: host }] } : await lookup(host)
    if (resolved.error) {
      console.log(bad(`DNS 解析失败：${resolved.error}`))
      console.log(`  ${DIM}→ 换 DNS 或检查网络；公司网络找管理员${RESET}`)
      verdict = Math.max(verdict, 2)
      console.log('')
      continue
    }
    const loopback = literal ? [] : resolved.addresses.filter((item) => isLoopback(item.address))
    if (loopback.length) {
      console.log(bad(`被解析到本机：${loopback.map((a) => a.address).join(', ')}`))
      console.log(`  ${DIM}→ 这是 hosts 屏蔽，不是墙。查 C:\\Windows\\System32\\drivers\\etc\\hosts${RESET}`)
      console.log(`  ${DIM}  删掉含 ${host} 的行，再 ipconfig /flushdns${RESET}`)
      verdict = Math.max(verdict, 2)
      console.log('')
      continue
    }
    console.log(ok(`DNS → ${resolved.addresses.map((a) => a.address).join(', ')}`))

    const response = await get(url)
    if (!response.ok) {
      if (response.status) {
        console.log(bad(`HTTP ${response.status}（${response.ms}ms）`))
        console.log(`  ${DIM}→ 404 通常是 latest.yml 没传进 Release，或版本号写错${RESET}`)
      } else {
        console.log(bad(`请求失败：${response.error}（${response.ms}ms）`))
        console.log(`  ${DIM}→ 连接层被拦（hosts / 代理 / 防火墙），与更新逻辑无关${RESET}`)
      }
      verdict = Math.max(verdict, 3)
      console.log('')
      continue
    }

    const feed = updateLogic.parseUpdateFeed(response.body.toString('utf8'), url)
    if (!feed) {
      console.log(bad(`内容不是可解析的 latest.yml / JSON（${response.body.length}B）`))
      verdict = Math.max(verdict, 3)
      console.log('')
      continue
    }
    console.log(ok(`更新源可用（${response.ms}ms）：版本 ${feed.version}`))
    console.log(`  ${DIM}${feed.url}${RESET}`)

    const asset = await head(feed.url)
    if (!asset.ok) {
      console.log(bad(`安装包取不到：${asset.status || asset.error}`))
      verdict = Math.max(verdict, 3)
    } else {
      const size = Number(asset.headers['content-length']) || 0
      if (!feed.size || size === feed.size) {
        console.log(ok(`安装包可达：${(size / 1024 / 1024).toFixed(1)} MB，与 latest.yml 一致`))
      } else {
        console.log(warn(`安装包大小不符：实际 ${size}，yml 写的是 ${feed.size}`))
        verdict = Math.max(verdict, 1)
      }
    }
    console.log('')
  }

  const labels = [
    '一切正常：检查更新应该能走通',
    '能查到新版本，但个别字段对不上（见上面的 ! ）',
    '网络层不通：这是环境问题，不是程序问题',
    '更新源或安装包不存在：发布流程少传了文件'
  ]
  console.log(`结论：${labels[verdict]}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
