// README 截图共用的演示配置。
//
// 底稿用 createDefaultConfig() 生成，而不是手写一个对象：
// 卡片样式的每一层（全局外观、单位字、状态文案）都要求字段齐全，
// 手写漏一个就会在渲染时回落到硬编码默认值，截出来的图和真实效果对不上。
//
// 演示数据固定，不读用户的 %APPDATA%，所以截图里不会出现任何真实内容。
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')

const appRoot = path.resolve(__dirname, '..')
const bundleFile = path.join(appRoot, '.verify/demo-defaults.cjs')

esbuild.buildSync({
  entryPoints: [path.join(appRoot, 'src/shared/defaults.ts')],
  outfile: bundleFile,
  format: 'cjs',
  platform: 'node',
  bundle: true,
  logLevel: 'silent'
})

const { createDefaultConfig } = require(bundleFile)

/** 4 个示例：一个每年重复、一个一次性带副标题、一个只剩月日、一个停用 */
const DEMO_COUNTDOWNS = [
  {
    id: 'demo_new_year',
    name: '元旦',
    enabled: true,
    target: { mode: 'annual', date: '2027-01-01T00:00', month: 1, day: 1 },
    text: { hint: '', futureText: '', todayText: '', pastText: '', unit: '' },
    appearance: {}
  },
  {
    id: 'demo_trip',
    name: '跨年旅行',
    enabled: true,
    target: { mode: 'once', date: '2026-12-24T09:00', month: 12, day: 24 },
    text: {
      hint: '2026 年 12 月 24 日 · 周四',
      futureText: '',
      todayText: '',
      pastText: '',
      unit: ''
    },
    appearance: {}
  },
  {
    id: 'demo_birthday',
    name: '妈妈生日',
    enabled: true,
    target: { mode: 'annual', date: '', month: 5, day: 20 },
    text: { hint: '', futureText: '', todayText: '', pastText: '', unit: '' },
    appearance: {}
  },
  {
    id: 'demo_launch',
    name: '项目上线',
    enabled: false,
    target: { mode: 'once', date: '2026-11-15T00:00', month: 11, day: 15 },
    text: { hint: '', futureText: '', todayText: '', pastText: '', unit: '' },
    appearance: {}
  }
]

function buildDemoConfig() {
  const config = createDefaultConfig()
  config.countdowns = DEMO_COUNTDOWNS.map((item) => ({ ...item }))
  config.activeId = 'demo_new_year'
  config.runtime.language = 'zh-CN'
  config.runtime.theme = 'dark'
  config.runtime.widgetVisible = true
  config.runtime.window.corner = 'top-right'
  config.runtime.window.cornerPreset = 'top-right'
  config.runtime.window.offsetX = 0
  config.runtime.window.offsetY = 0
  return config
}

module.exports = { buildDemoConfig, DEMO_COUNTDOWNS }
