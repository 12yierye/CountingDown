// 外观页抽取 AppearanceFields / AppearanceGroup 之后的行为回归：
//   1) 四个分组都在，控件一个不少（12 滑块 / 1 数字输入 / 6 取色器 / 4 段文字样式）
//   2) 拖着控件改值仍然会**立刻落盘**（外观页的旧行为：一改就写全局配置）
//
// 这一条很关键：抽成「表现层组件 + 薄壳」的过程中，最容易坏掉的就是这条写盘链路
// （薄壳忘了把 update:appearance 转成 patch，页面看着正常但改了不生效）。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
const probeRoot = path.join(appRoot, '.probe-userdata')
fs.mkdirSync(outDir, { recursive: true })

const userData = path.join(probeRoot, `appearance-${Date.now().toString(36)}`)
fs.mkdirSync(userData, { recursive: true })
try {
  for (const entry of fs.readdirSync(probeRoot)) {
    if (!entry.startsWith('appearance-')) continue
    const full = path.join(probeRoot, entry)
    if (full === userData) continue
    try {
      fs.rmSync(full, { recursive: true, force: true, maxRetries: 1, retryDelay: 50 })
    } catch (error) {
      /* 上一个实例可能还占着，留着即可 */
    }
  }
} catch (error) {
  /* probeRoot 不可读就算了 */
}

fs.writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify(
    {
      config: {
        countdowns: [
          {
            id: 'probe_appearance_a',
            name: '外观页回归项',
            enabled: true,
            target: { mode: 'annual', date: '', month: 1, day: 1 },
            text: { hint: '', futureText: '', todayText: '', pastText: '', unit: '' },
            appearance: {}
          }
        ],
        activeId: 'probe_appearance_a',
        runtime: { widgetVisible: true, toggleHotkey: '', language: 'zh-CN' }
      }
    },
    null,
    '\t'
  )
)

const logFile = path.join(outDir, 'appearance.log')
fs.writeFileSync(logFile, 'start ' + new Date().toISOString() + '\n')

function appendLog(text) {
  try {
    fs.appendFileSync(logFile, text + '\n')
  } catch (error) {
    /* ignore */
  }
}

let stdoutBroken = false
process.stdout.on('error', (error) => {
  if (error && error.code === 'EPIPE') stdoutBroken = true
})

const write = (line) => {
  const text = typeof line === 'string' ? line : JSON.stringify(line)
  appendLog(text)
  if (stdoutBroken) return
  try {
    process.stdout.write(text + '\n')
  } catch (error) {
    if (error && error.code === 'EPIPE') stdoutBroken = true
  }
}

let failures = 0
function check(name, ok, detail) {
  if (!ok) failures += 1
  write(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`)
}

process.on('uncaughtException', (error) => {
  if (error && error.code === 'EPIPE') {
    stdoutBroken = true
    return
  }
  appendLog('MAIN_UNCAUGHT ' + (error && error.stack))
})

app.setPath('userData', userData)

const main = require(path.join(appRoot, 'out/main/index.js'))

write('harness started pid=' + process.pid + ' userData=' + userData)
app.on('will-quit', () => write('EARLY_QUIT pid=' + process.pid + ' (single-instance lock held?)'))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function settingsWindow() {
  return BrowserWindow.getAllWindows().find((win) => win.getTitle().includes('设置')) || null
}

async function evalIn(win, expression) {
  if (!win) return 'NO_WINDOW'
  try {
    return await win.webContents.executeJavaScript(expression)
  } catch (error) {
    return 'EVAL_FAIL ' + error
  }
}

async function jsonIn(win, expression) {
  const raw = await evalIn(win, `JSON.stringify(${expression})`)
  try {
    return JSON.parse(raw)
  } catch (error) {
    return { parseError: String(raw) }
  }
}

async function waitFor(probe, predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  let seen = null
  for (;;) {
    seen = await probe()
    if (predicate(seen)) return { ok: true, seen }
    if (Date.now() >= deadline) return { ok: false, seen }
    await wait(150)
  }
}

function persisted() {
  try {
    return JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8')).config
  } catch (error) {
    return null
  }
}

const OPEN_APPEARANCE =
  `(function(){var navs=[].slice.call(document.querySelectorAll(".settings-nav__item"));` +
  `var nav=navs.filter(function(x){return /外观|Appearance/.test(x.textContent||"")})[0];` +
  `if(!nav)return {found:false,all:navs.map(function(x){return (x.textContent||"").trim()})};` +
  `nav.click();return {found:true};})()`

const APPEARANCE_STATE =
  '({cards:document.querySelectorAll(".settings-content .panel-card").length,' +
  ' sliders:document.querySelectorAll(".settings-content .slider-field__value").length,' +
  ' colors:document.querySelectorAll(".settings-content .el-color-picker").length,' +
  ' styles:document.querySelectorAll(".settings-content .text-style-editor").length,' +
  ' widthInput:document.querySelectorAll(".settings-content .el-input-number").length,' +
  ' groups:document.querySelectorAll(".settings-content .override-group").length,' +
  ' headers:[].slice.call(document.querySelectorAll(".settings-content .panel-card__header")).map(function(x){return (x.textContent||"").trim()}),' +
  // 定位用：每个滑块 / 取色器属于哪个控件与哪一行，数字对不上时一眼看出多的是谁
  ' sliderDetail:[].slice.call(document.querySelectorAll(".settings-content .slider-field__value")).map(function(x){' +
  'var f=x.closest(".field-row");var e=x.closest(".text-style-editor");' +
  'return (f&&f.querySelector(".field-row__text")?f.querySelector(".field-row__text").textContent.trim():"")+' +
  '"/"+(e&&e.querySelector(".text-style-editor__title")?e.querySelector(".text-style-editor__title").textContent.trim():"")+' +
  '"/"+(x.closest(".settings-preview")?"IN-PREVIEW":"main")}),' +
  ' colorDetail:[].slice.call(document.querySelectorAll(".settings-content .el-color-picker")).map(function(x){' +
  'var f=x.closest(".field-row");var e=x.closest(".text-style-editor");' +
  'return (f&&f.querySelector(".field-row__text")?f.querySelector(".field-row__text").textContent.trim():"")+' +
  '"/"+(e&&e.querySelector(".text-style-editor__title")?e.querySelector(".text-style-editor__title").textContent.trim():"")+' +
  '"/"+(x.closest(".settings-preview")?"IN-PREVIEW":"main")})})'

/** 按百分比位置点一下滑块跑道（el-slider 用原生鼠标事件） */
const SET_SLIDER = (index, ratio) =>
  `(function(){var ss=document.querySelectorAll(".settings-content .slider-field__slider .el-slider__runway");` +
  `if(ss.length<=${index})return {found:false,count:ss.length};` +
  `var r=ss[${index}].getBoundingClientRect();` +
  `var opts={bubbles:true,clientX:r.left+r.width*${ratio},clientY:r.top+r.height/2,button:0};` +
  `ss[${index}].dispatchEvent(new MouseEvent("mousedown",opts));` +
  `ss[${index}].dispatchEvent(new MouseEvent("mouseup",opts));` +
  `return {found:true,count:ss.length};})()`

app.whenReady().then(async () => {
  await wait(4000)

  main.openSettingsWindow()
  await wait(4500)
  const s = settingsWindow()
  check('settings-window-exists', Boolean(s), s ? 'ok' : 'missing')
  if (!s) {
    await wait(200)
    app.exit(1)
    return
  }
  s.show()
  s.focus()
  await wait(800)

  const before = persisted()
  write('radius before = ' + JSON.stringify(before.appearance.background.radius))

  const opened = await jsonIn(s, OPEN_APPEARANCE)
  await wait(1200)
  const state = await jsonIn(s, APPEARANCE_STATE)
  write('open = ' + JSON.stringify(opened))
  write('state = ' + JSON.stringify(state))
  write('sliderDetail = ' + JSON.stringify(state.sliderDetail, null, 1))
  write('colorDetail = ' + JSON.stringify(state.colorDetail, null, 1))

  check('appearance-page-opened', opened.found === true, JSON.stringify(opened.all))
  check('appearance-four-cards', state.cards === 4, JSON.stringify(state.cards))
  check('appearance-no-flat-groups', state.groups === 0, JSON.stringify(state.groups))
  check('appearance-text-styles-4', state.styles === 4, JSON.stringify(state.styles))
  check('appearance-width-input-1', state.widthInput === 1, JSON.stringify(state.widthInput))

  /*
   * 滑块按控件逐一数出来，而不是写死一个总数：
   *   分组级 = 圆角 / 内边距 / 边框宽度 / 阴影强度 / 文字透明度 —— 5 个
   *           （「卡片宽度」用的是 el-input-number，本来就不是滑块）
   *   每段文字样式 = 字号 / 字距 / 透明度 —— 3 个 × 4 段 = 12 个
   * 合计 17。写死总数的话，以后给某段加一个滑块就会误报。
   */
  const textStyleSliders = state.sliderDetail.filter((x) => x.startsWith('/')).length
  const groupSliders = state.sliderDetail.length - textStyleSliders
  write(`slider breakdown: group=${groupSliders} textStyle=${textStyleSliders}`)
  check('appearance-group-sliders-5', groupSliders === 5, JSON.stringify(groupSliders))
  check(
    'appearance-sliders-3-per-text-style',
    textStyleSliders === state.styles * 3,
    `${textStyleSliders} / ${state.styles} 段`
  )
  check(
    'appearance-colors-7',
    state.colors === 7,
    JSON.stringify({
      count: state.colors,
      detail: state.colorDetail
    })
  )

  // ---------------------------------------- 改「圆角」应当立刻写盘（薄壳的写盘链路）
  const dragged = await jsonIn(s, SET_SLIDER(0, 0.85))
  const saved = await waitFor(
    async () => persisted(),
    (cfg) => cfg && cfg.appearance.background.radius !== before.appearance.background.radius
  )
  const radiusAfter = saved.seen ? saved.seen.appearance.background.radius : null
  write('drag = ' + JSON.stringify(dragged) + ' radius after = ' + JSON.stringify(radiusAfter))
  check('appearance-slider-reachable', dragged.found === true, JSON.stringify(dragged))
  check(
    'appearance-slider-writes-through-shell',
    saved.ok,
    `${before.appearance.background.radius} -> ${radiusAfter}`
  )
  check(
    'appearance-other-fields-untouched',
    saved.seen &&
      saved.seen.appearance.background.color === before.appearance.background.color &&
      saved.seen.appearance.textAlpha === before.appearance.textAlpha,
    saved.seen
      ? JSON.stringify({
          color: saved.seen.appearance.background.color,
          textAlpha: saved.seen.appearance.textAlpha
        })
      : 'null'
  )

  write(`SUMMARY failures=${failures}`)
  write('done')
  app.exit(failures === 0 ? 0 : 2)
})
