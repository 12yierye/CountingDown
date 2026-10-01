// 单位字「不受显示模式影响」验证：
//   1) 行为页的四个单位字输入框在任何显示模式下都**可编辑**（一个都不能是 disabled）
//   2) 「只显示天数」模式下往「时」的单位字里打字能成功，并真的写进配置
//   3) 切回「天 + 时」时那个值仍在（说明它一直是同一份数据，只是之前不让改）
//
// 背景：UnitLabelField 以前把「当前显示模式用不到」的分段直接 `:disabled="!slot.on"`，
// 于是「只显示天数」模式下根本没法设置时/分/秒的单位字。现在标灰只作提示，不禁用。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
const probeRoot = path.join(appRoot, '.probe-userdata')
fs.mkdirSync(outDir, { recursive: true })

// 独立 userData：应用的实例锁按 userData 加，复用目录会被残留进程握死
const userData = path.join(probeRoot, `units-${Date.now().toString(36)}`)
fs.mkdirSync(userData, { recursive: true })
try {
  for (const entry of fs.readdirSync(probeRoot)) {
    if (!entry.startsWith('units-')) continue
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

// 基线：显示模式就是「只显示天数」，单位字保持默认的「天 / 时 / 分 / 秒」
fs.writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify(
    {
      config: {
        countdowns: [
          {
            id: 'probe_units_a',
            name: '单位字验证项',
            enabled: true,
            target: { mode: 'annual', date: '', month: 1, day: 1 },
            text: { hint: '', futureText: '', todayText: '', pastText: '', unit: '' },
            appearance: {}
          }
        ],
        activeId: 'probe_units_a',
        behavior: { displayMode: 'days' },
        runtime: { widgetVisible: true, toggleHotkey: '', language: 'zh-CN' }
      }
    },
    null,
    '\t'
  )
)

const logFile = path.join(outDir, 'units.log')
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

/** 打开设置窗口并切到「行为」页 */
const OPEN_BEHAVIOR =
  `(function(){` +
  `var navs=[].slice.call(document.querySelectorAll(".settings-nav__item"));` +
  `var nav=navs.filter(function(x){return /行为|Behavior/.test(x.textContent||"")})[0];` +
  `if(!nav)return {found:false,all:navs.map(function(x){return (x.textContent||"").trim()})};` +
  `nav.click();return {found:true};})()`

/** 单位字区域的真实 DOM 状态：四个输入框、几个 disabled、几个标灰、各自的占位与值 */
const UNITS_STATE =
  '({inputs:document.querySelectorAll(".units__input").length,' +
  ' disabled:[].slice.call(document.querySelectorAll(".units__input")).filter(function(x){return x.disabled}).length,' +
  ' off:[].slice.call(document.querySelectorAll(".units__slot")).filter(function(x){return x.classList.contains("is-off")}).length,' +
  ' values:[].slice.call(document.querySelectorAll(".units__input")).map(function(x){return x.value}),' +
  ' checkedMode:(function(){var m=document.querySelector(".el-radio-button.is-active .el-radio-button__inner");' +
  'return m?(m.textContent||"").trim():"";})()})'

/** 直接改 Vue 之外的层：用原生 setter 打字，和 verify-list.cjs 同一套做法 */
const TYPE_UNIT = (index, text) =>
  `(function(){var el=document.querySelectorAll(".units__input")[${index}];` +
  `if(!el)return {found:false};` +
  `if(el.disabled)return {found:true,disabled:true};` +
  `var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;` +
  `setter.call(el,${JSON.stringify(text)});` +
  `el.dispatchEvent(new Event("input",{bubbles:true}));` +
  `return {found:true,disabled:false,value:el.value};})()`

/** 切换显示模式：按标签文字点那个分段按钮 */
const CLICK_MODE = (pattern) =>
  `(function(){var bs=[].slice.call(document.querySelectorAll(".el-radio-button__inner"));` +
  `var b=bs.filter(function(x){return ${pattern}.test(x.textContent||"")})[0];` +
  `if(!b)return {found:false,all:bs.map(function(x){return (x.textContent||"").trim()})};` +
  `b.click();return {found:true,text:(b.textContent||"").trim()};})()`

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

  const opened = await jsonIn(s, OPEN_BEHAVIOR)
  await wait(1000)
  const state = await jsonIn(s, UNITS_STATE)
  write('open = ' + JSON.stringify(opened) + ' units = ' + JSON.stringify(state))

  check('behavior-page-opened', opened.found === true, JSON.stringify(opened.all))
  check('units-has-four-inputs', state.inputs === 4, JSON.stringify(state.inputs))
  check(
    'display-mode-is-days-only',
    /只显示天数|Days only/.test(state.checkedMode || ''),
    JSON.stringify(state.checkedMode)
  )
  // 这条就是本次修复的核心：以前「只显示天数」下会有 3 个 disabled
  check(
    'no-unit-input-disabled-in-days-mode',
    state.disabled === 0,
    JSON.stringify({ disabled: state.disabled })
  )
  // 时 / 分 / 秒 三段当前模式用不到，应该只是标灰提示
  check('unused-segments-still-dimmed', state.off === 3, JSON.stringify({ off: state.off }))

  // ---------------------------------------------- 在「只显示天数」下设置「时」的单位字
  const typed = await jsonIn(s, TYPE_UNIT(1, 'h'))
  await wait(700)
  const afterType = await waitFor(
    async () => persisted(),
    (cfg) => cfg && cfg.behavior && cfg.behavior.units && cfg.behavior.units.hour === 'h'
  )
  write('type hour = ' + JSON.stringify(typed) + ' persisted hour=' + JSON.stringify(
    (afterType.seen && afterType.seen.behavior && afterType.seen.behavior.units) || null
  ))
  check('hour-input-reachable', typed.found === true && typed.disabled === false, JSON.stringify(typed))
  check(
    'hour-unit-saved-while-days-only',
    afterType.ok,
    JSON.stringify((afterType.seen && afterType.seen.behavior && afterType.seen.behavior.units) || null)
  )

  // ------------------------------- 切到「天 + 时」，值应当仍在（一直是同一份数据）
  const switched = await jsonIn(s, CLICK_MODE('/DD.*HH/'))
  await wait(900)
  const afterSwitch = persisted()
  const switchedState = await jsonIn(s, UNITS_STATE)
  write(
    'switch mode = ' +
      JSON.stringify(switched) +
      ' units = ' +
      JSON.stringify({ values: switchedState.values, off: switchedState.off, disabled: switchedState.disabled })
  )
  check('mode-switched', switched.found === true, JSON.stringify(switched))
  check(
    'hour-unit-survives-mode-switch',
    afterSwitch.behavior.units.hour === 'h',
    JSON.stringify(afterSwitch.behavior.units)
  )
  // 必须盯住不变量本身，而不是「off 应该是 0」：切到哪种模式就标灰哪几段是**正确**行为。
  // 这条模式下渲染 DD天 + HHh 两段，所以只有「分 / 秒」该标灰 —— 而它们依然可编辑。
  check(
    'dimming-follows-mode-without-disabling',
    switchedState.off === 2 && switchedState.disabled === 0,
    JSON.stringify({ off: switchedState.off, disabled: switchedState.disabled, checkedMode: switchedState.checkedMode })
  )

  // ---------------------------- 编辑子页的「单位字覆盖」同样不该被显示模式锁住
  await evalIn(s, 'window.cd.updateConfig({behavior:{displayMode:"days"}}).then(function(){return "ok"})')
  await wait(700)
  const editorOpen = await jsonIn(
    s,
    `(function(){var rows=document.querySelectorAll(".cd-row__main");` +
      `if(!rows.length)return {found:false};rows[0].click();return {found:true};})()`
  )
  await wait(1200)
  const overrideOn = await jsonIn(
    s,
    `(function(){var sw=[].slice.call(document.querySelectorAll(".el-switch"));` +
      `var hit=sw.filter(function(x){var f=x.closest(".field-row");` +
      `return f&&/单位字|Unit labels/.test(f.textContent||"")})[0];` +
      `if(!hit)return {found:false};hit.click();return {found:true};})()`
  )
  await wait(900)
  const editorUnits = await jsonIn(s, UNITS_STATE)
  write(
    'editor open=' +
      JSON.stringify(editorOpen) +
      ' override=' +
      JSON.stringify(overrideOn) +
      ' units=' +
      JSON.stringify(editorUnits)
  )
  check('editor-units-four-inputs', editorUnits.inputs === 4, JSON.stringify(editorUnits.inputs))
  check(
    'editor-units-not-disabled-in-days-mode',
    editorUnits.disabled === 0,
    JSON.stringify({ disabled: editorUnits.disabled })
  )

  write(`SUMMARY failures=${failures}`)
  write('done')
  app.exit(failures === 0 ? 0 : 2)
})
