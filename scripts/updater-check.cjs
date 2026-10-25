// 在线更新的纯逻辑验证（不需要 Electron，直接 node 跑）：
//   - 版本号比较
//   - latest.yml 解析（用 release/ 里 electron-builder 真实产出的那份）
//   - JSON 更新源解析（带发布说明）
//   - 相对地址补全、体积格式化
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert')

const appRoot = path.resolve(__dirname, '..')
const outFile = path.join(appRoot, '.verify/update-logic.cjs')

require('esbuild').buildSync({
  entryPoints: [path.join(appRoot, 'src/shared/update.ts')],
  outfile: outFile,
  format: 'cjs',
  platform: 'node',
  bundle: true,
  logLevel: 'silent'
})

const {
  UPDATE_FEED_PRESETS,
  looksLikeHtml,
  presetIdOf,
  compareVersions,
  parseUpdateFeed,
  resolveFeedUrl,
  formatBytes,
  releasePageOf,
  parseFeedUrls,
  DEFAULT_UPDATE_FEED
} = require(outFile)

let failures = 0
function check(name, ok, detail) {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`)
}

// ------------------------------------------------------------ 版本比较
const compareCases = [
  ['1.2.1', '1.2.0', 1],
  ['1.2.0', '1.2.1', -1],
  ['1.2.0', '1.2.0', 0],
  ['v1.3.0', '1.2.9', 1],
  ['1.10.0', '1.9.9', 1],
  ['1.2', '1.2.0', 0],
  ['1.2.0-beta.1', '1.2.0', 0],
  ['2.0.0', '10.0.0', -1]
]
for (const [left, right, expected] of compareCases) {
  const actual = compareVersions(left, right)
  check(`compare ${left} vs ${right}`, actual === expected, String(actual))
}

// ------------------------------------------------------------ latest.yml
const ymlPath = path.join(appRoot, 'release/latest.yml')
// 版本号从 package.json 读，别写死：每次发版都要改脚本的断言，迟早会忘
const appVersion = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version
const feedUrl = 'https://github.com/12yierye/CountingDown/releases/latest/download/latest.yml'
if (fs.existsSync(ymlPath)) {
  const feed = parseUpdateFeed(fs.readFileSync(ymlPath, 'utf8'), feedUrl)
  console.log('parsed latest.yml = ' + JSON.stringify(feed))
  check('yml-version', feed && feed.version === appVersion, feed && feed.version)
  check(
    'yml-url-resolved',
    feed &&
      feed.url ===
        'https://github.com/12yierye/CountingDown/releases/latest/download/CountingDown_Setup_' +
          appVersion +
          '.exe',
    feed && feed.url
  )
  check('yml-sha512', feed && /^[A-Za-z0-9+/=]{40,}$/.test(feed.sha512 ?? ''), feed && (feed.sha512 ?? '').slice(0, 12))
  check('yml-size', feed && feed.size > 80_000_000, feed && String(feed.size))
  check('yml-no-notes', feed && feed.notes === undefined, feed && String(feed.notes))
} else {
  console.log('SKIP latest.yml（还没打过包）')
}

// ------------------------------------------------------------ JSON 更新源
const jsonFeed = parseUpdateFeed(
  JSON.stringify({
    version: '1.3.0',
    url: 'https://example.com/dl/CountingDown_Setup_1.3.0.exe',
    sha512: 'abc',
    size: 12345,
    notes: '修复了 A\n新增了 B',
    releaseDate: '2026-11-01T10:00:00.000Z'
  }),
  feedUrl
)
console.log('parsed json = ' + JSON.stringify(jsonFeed))
check('json-version', jsonFeed && jsonFeed.version === '1.3.0', jsonFeed && jsonFeed.version)
check('json-notes-multiline', jsonFeed && jsonFeed.notes === '修复了 A\n新增了 B', jsonFeed && JSON.stringify(jsonFeed.notes))
check('json-absolute-url-kept', jsonFeed && jsonFeed.url === 'https://example.com/dl/CountingDown_Setup_1.3.0.exe', jsonFeed && jsonFeed.url)

// ------------------------------------------------------------ 局部/异常输入
check('parse-empty', parseUpdateFeed('', feedUrl) === null, 'null')
check('parse-garbage', parseUpdateFeed('not a feed', feedUrl) === null, 'null')
check(
  'parse-relative-subdir',
  (() => {
    const feed = parseUpdateFeed('version: 2.0.0\nfiles:\n  - url: sub/a.exe\n', 'https://host.com/u/latest.yml')
    return feed && feed.url === 'https://host.com/u/sub/a.exe'
  })(),
  'relative url'
)
check('resolve-absolute', resolveFeedUrl('https://a.com/x.yml', 'http://b.com/y.exe') === 'http://b.com/y.exe', 'kept')

// ------------------------------------------------------------ 体积
check('bytes-mb', formatBytes(82_624_238) === '78.8 MB', formatBytes(82_624_238))
check('bytes-empty', formatBytes(undefined) === '', 'empty')

// ------------------------------------------------------------ 手动下载页
check(
  'page-from-latest-asset',
  releasePageOf('https://github.com/o/r/releases/latest/download/latest.yml') ===
    'https://github.com/o/r/releases/latest',
  releasePageOf('https://github.com/o/r/releases/latest/download/latest.yml')
)
check(
  'page-from-tagged-asset',
  releasePageOf('https://github.com/o/r/releases/download/v1.3.0/a.exe') ===
    'https://github.com/o/r/releases/latest',
  releasePageOf('https://github.com/o/r/releases/download/v1.3.0/a.exe')
)
check(
  'page-from-plain-dir',
  releasePageOf('https://cdn.example.com/app/latest.yml') === 'https://cdn.example.com/app',
  releasePageOf('https://cdn.example.com/app/latest.yml')
)
check('page-empty', releasePageOf('') === '', 'empty')

// ------------------------------------------------------------ 更新源预设
check('preset-count', UPDATE_FEED_PRESETS.length === 5, String(UPDATE_FEED_PRESETS.length))
check(
  'preset-mirror-prefixes',
  ['gh-proxy.com', 'gh-proxy.net', 'gitproxy.click', 'ghproxy.link'].every((host) =>
    UPDATE_FEED_PRESETS.some((item) => item.url.endsWith(DEFAULT_UPDATE_FEED) && item.url.includes(host + '/'))
  ),
  UPDATE_FEED_PRESETS.map((item) => item.id).join(',')
)
check('preset-github-id', presetIdOf(DEFAULT_UPDATE_FEED) === 'github', presetIdOf(DEFAULT_UPDATE_FEED))
check(
  'preset-ghproxy-url',
  UPDATE_FEED_PRESETS.find((item) => item.id === 'ghproxy').url ===
    'https://gh-proxy.com/' + DEFAULT_UPDATE_FEED,
  UPDATE_FEED_PRESETS.find((item) => item.id === 'ghproxy').url
)
check(
  'preset-mirror-id',
  presetIdOf('https://gh-proxy.com/' + DEFAULT_UPDATE_FEED) === 'ghproxy',
  presetIdOf('https://gh-proxy.com/' + DEFAULT_UPDATE_FEED)
)
check(
  'preset-mirror-alt-id',
  presetIdOf('https://gh-proxy.net/' + DEFAULT_UPDATE_FEED) === 'ghproxyNet',
  presetIdOf('https://gh-proxy.net/' + DEFAULT_UPDATE_FEED)
)
check('preset-custom', presetIdOf('https://cdn.example.com/app/latest.yml') === 'custom', 'custom')
check('preset-off', presetIdOf('') === 'off' && presetIdOf('   ') === 'off', 'off')

// ------------------------------------------------------------ HTML 误返回（镜像常见）
check('html-doctype', looksLikeHtml('<!DOCTYPE html><html></html>') === true, 'doctype')
check('html-lowercase', looksLikeHtml('  <html><head></head></html>') === true, 'leading spaces')
check('html-yaml', looksLikeHtml('version: 1.2.2\nfiles: []') === false, 'yaml')

// ------------------------------------------------------------ 多更新源
check(
  'feeds-split-and-dedupe',
  JSON.stringify(
    parseFeedUrls(
      'https://a.com/x/latest.yml\nhttps://b.com/y/latest.yml, https://a.com/x/latest.yml'
    )
  ) === JSON.stringify(['https://a.com/x/latest.yml', 'https://b.com/y/latest.yml']),
  JSON.stringify(
    parseFeedUrls('https://a.com/x/latest.yml\nhttps://b.com/y/latest.yml, https://a.com/x/latest.yml')
  )
)
check('feeds-drop-relative', parseFeedUrls('latest.yml  https://c.com/x.yml').length === 1, 'relative dropped')
check('feeds-empty', parseFeedUrls('   ').length === 0, 'empty')

console.log(`SUMMARY failures=${failures}`)
process.exit(failures === 0 ? 0 : 1)
