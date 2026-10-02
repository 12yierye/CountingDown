// 预设「手动调整所有参数」模态框验证：
//   1) 模态框能打开，外观控件齐全（17 个滑块 / 1 个数字输入 / 7 个取色器 / 4 段文字样式 / 4 个平铺分组）
//   2) 在模态框里改控件**不写盘**：全局 appearance 逐字段不变、customPresets 数量不变
//   3) 点「保存预设」→ customPresets +1，新预设 appearance 不是全局那一份，且全局 appearance 仍不变
//   4) 取消路径 → 不新增预设，全局 appearance 仍不变
//
// 与 preview-check.cjs 同一套做法：独立 userData（单实例锁按 userData 加）、
// executeJavaScript 操作 DOM、直接读磁盘 config.json 断言。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
const probeRoot = path.join(appRoot, '.probe-userdata')
fs.mkdirSync(outDir, { recursive: true })

const userData = path.join(probeRoot, `preset-tune-${Date.now().toString(36)}`)
fs.mkdirSync(userData, { recursive: true })
try {
  for (const entry of fs.readdirSync(probeRoot)) {
    if (!entry.startsWith('preset-tune-')) continue
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
            id: 'probe_tune_a',
            name: '手动调整用项',
            enabled: true,
            target: { mode: 'annual', date: '', month: 1, day: 1 },
            text: { hint: '', futureText: '', todayText: '', pastText: '', unit: '' },
            appearance: {}
          }
        ],
        activeId: 'probe_tune_a',
        runtime: { widgetVisible: true, toggleHotkey: '', language: 'zh-CN' }
      }
    },
    null,
    '\t'
  )
)

const logFile = path.join(outDir, 'preset-tune.log')
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

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * 模态框是不是真的在屏幕上。
 * 注意 `display: none` 落在 `.el-dialog` 上，不是外层那个 `.el-overlay-dialog`
 * （overlay 自己一直保持 flex），所以必须往里再看一层，否则关闭后仍会被判成「可见」。
 */
const TUNE_VISIBLE =
  '(function(){var ds=document.querySelectorAll(".tune-dialog");' +
  'var d=ds.length?ds[ds.length-1]:null;' +
  'if(!d)return {present:false,count:0};' +
  'var inner=d.querySelector(".el-dialog")||d;' +
  'var cs=getComputedStyle(inner);' +
  'var input=d.querySelector("input.el-input__inner[maxlength=\\"20\\"]");' +
  'var overlay=d.querySelector(".el-overlay-dialog")||d.parentElement;' +
  'var body=d.querySelector(".el-dialog__body");' +
  'return {present:true,count:ds.length,visible:cs.display!=="none"&&cs.visibility!=="hidden",display:cs.display,' +
  ' inline:d.getAttribute("style"),' +
  ' nameInput:!!input,' +
  ' bodyVisible:body?getComputedStyle(body).display:"<none>",' +
  ' overlayClass:overlay?overlay.className:null,' +
  ' overlayDisplay:overlay?getComputedStyle(overlay).display:null,' +
  ' dialogCount:document.querySelectorAll(".el-dialog").length};})()'

const TUNE_STATE =
  '({sliders:document.querySelectorAll(".tune-dialog .slider-field__value").length,' +
  ' colors:document.querySelectorAll(".tune-dialog .el-color-picker").length,' +
  ' styles:document.querySelectorAll(".tune-dialog .text-style-editor").length,' +
  ' widthInput:document.querySelectorAll(".tune-dialog .el-input-number").length,' +
  ' groups:document.querySelectorAll(".tune-dialog .override-group").length,' +
  ' cards:document.querySelectorAll(".tune-dialog .panel-card").length,' +
  ' previewCard:document.querySelectorAll(".tune-dialog .preview .cd-card").length,' +
  ' nameInput:!!document.querySelector(".tune-dialog input.el-input__inner[maxlength=\\"20\\"]")})'

/** 按可见按钮上的文字点击；多个同名时取最后一个（弹窗是后出现的那层） */
const CLICK_BUTTON = (pattern) =>
  `(function(){var bs=[].slice.call(document.querySelectorAll("button")).filter(function(x){` +
  `var r=x.getBoundingClientRect();return r.width>0&&r.height>0&&${pattern}.test(x.textContent||"")});` +
  `if(!bs.length)return {found:false,all:[].slice.call(document.querySelectorAll("button")).map(function(x){return (x.textContent||"").trim().slice(0,12)})};` +
  `var b=bs[bs.length-1];b.click();return {found:true,text:(b.textContent||"").trim()};})()`

/**
 * 走完「预设页 → 保存当前外观为预设 → 选手动调整 → 打开外观编辑器」。
 *
 * **必须拆成四个阶段分别 await**：Vue 的 DOM 更新是异步的，一个 executeJavaScript 里
 * 连着点「导航 → 打开保存弹窗 → 选单选 → 点打开编辑器」的话，第二次 click 时弹窗根本
 * 还没渲染出来，表现为 `found:false` 这种「点了但什么都没有」。
 */
const CLICK_NAV_PRESET =
  `(function(){var navs=[].slice.call(document.querySelectorAll(".settings-nav__item"));` +
  `var nav=navs.filter(function(x){return /预设主题|Presets/.test(x.textContent||"")})[0];` +
  `if(!nav)return {found:false,all:navs.map(function(x){return (x.textContent||"").trim()})};` +
  `nav.click();return {found:true};})()`

const CLICK_ADD_PRESET =
  `(function(){var add=[].slice.call(document.querySelectorAll("button")).filter(function(x){` +
  `return /新建预设|New preset/.test(x.textContent||"")})[0];` +
  `if(!add)return {found:false};add.click();return {found:true};})()`

const CLICK_MANUAL_RADIO =
  `(function(){var radios=[].slice.call(document.querySelectorAll(".el-dialog .el-radio"));` +
  `var manual=radios.filter(function(x){return /手动调整所有参数|Tune every value manually/.test(x.textContent||"")})[0];` +
  `if(!manual)return {found:false,radios:radios.map(function(x){return (x.textContent||"").trim()})};` +
  `manual.click();return {found:true};})()`

const CLICK_OPEN_EDITOR = CLICK_BUTTON('/手动调整参数|Tune the values/')

/** 保存弹窗里那条名称报错：名称没填时点「打开外观编辑器」应当原地报错而不是前进 */
const SAVE_NAME_ERROR =
  '({shown:(function(){var d=document.querySelector(".el-dialog");' +
  'return !!(d&&d.querySelector(".save-error"));})(),' +
  ' text:(function(){var d=document.querySelector(".el-dialog");' +
  'var e=d&&d.querySelector(".save-error");return e?(e.textContent||"").trim():"";})()})'

const SAVE_NAME_INPUT = '.el-dialog input.el-input__inner[maxlength="20"]'
const TUNE_NAME_INPUT = '.tune-dialog input.el-input__inner[maxlength="20"]'

/**
 * 走完「预设页 → 新建预设 → 选手动调整 → 进模态框 → 填名称」。
 *
 * **必须拆成多个阶段分别 await**：Vue 的 DOM 更新是异步的，一个 executeJavaScript 里
 * 连着点「导航 → 打开弹窗 → 选单选 → 点下一步」的话，后一次 click 时弹窗根本还没渲染出来，
 * 表现为 `found:false` 这种「点了但什么都没有」。
 *
 * 名称**只在模态框里问一次**（调完参数之后），保存弹窗不再有名称输入框 ——
 * 这是用户明确要求的流程，脚本也跟着走。
 */
async function openTuneDialog(win, name) {
  const steps = []
  steps.push(await jsonIn(win, CLICK_NAV_PRESET))
  await wait(900)
  steps.push(await jsonIn(win, CLICK_ADD_PRESET))
  await wait(700)
  steps.push(await jsonIn(win, CLICK_MANUAL_RADIO))
  await wait(500)
  steps.push(await jsonIn(win, CLICK_OPEN_EDITOR))
  await wait(1400)
  if (name !== null) {
    steps.push(await jsonIn(win, TYPE_INTO(TUNE_NAME_INPUT, name)))
    await wait(400)
  }
  return steps
}

const TYPE_INTO = (selector, text) =>
  `(function(){var el=document.querySelector(${JSON.stringify(selector)});` +
  `if(!el)return {found:false};` +
  `var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;` +
  `setter.call(el,${JSON.stringify(text)});` +
  `el.dispatchEvent(new Event("input",{bubbles:true}));` +
  `return {found:true,value:el.value};})()`

const SET_TUNE_SLIDER = (index, ratio) =>
  `(function(){var ss=document.querySelectorAll(".tune-dialog .slider-field__slider .el-slider__runway");` +
  `if(ss.length<=${index})return {found:false,count:ss.length};` +
  `var r=ss[${index}].getBoundingClientRect();` +
  `var opts={bubbles:true,clientX:r.left+r.width*${ratio},clientY:r.top+r.height/2,button:0};` +
  `ss[${index}].dispatchEvent(new MouseEvent("mousedown",opts));` +
  `ss[${index}].dispatchEvent(new MouseEvent("mouseup",opts));` +
  `return {found:true,count:ss.length};})()`

const PRESET_ITEMS = 'document.querySelectorAll(".preset-grid .preset-item").length'

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
  const beforeAppearance = before.appearance
  const beforePresets = (before.customPresets || []).length
  write('appearance before = ' + JSON.stringify(beforeAppearance))
  check('probe-config-loaded', beforeAppearance != null, JSON.stringify(beforePresets))

  // ------------------------ 0) 模态框里的名称空着点保存 -> 原地报错、不新增预设
  const noName = await openTuneDialog(s, null)
  const noNameClick = await jsonIn(s, CLICK_BUTTON('/^\\s*保存预设\\s*$|^\\s*Save preset\\s*$/'))
  await wait(600)
  const nameError = await jsonIn(
    s,
    '(function(){var e=document.querySelector(".tune-dialog .tune-dialog__error");' +
      'return {shown:!!e,text:e?(e.textContent||"").trim():"",titled:!!document.querySelector(".tune-dialog [class*=el-form-item__label]")};})()'
  )
  const stillOpen = await jsonIn(s, TUNE_VISIBLE)
  const countAfterEmpty = (persisted().customPresets || []).length
  write(
    'empty-name attempt = ' +
      JSON.stringify(noName) +
      ' click=' +
      JSON.stringify(noNameClick) +
      ' error=' +
      JSON.stringify(nameError)
  )
  check('empty-name-save-clicked', noNameClick.found === true, JSON.stringify(noNameClick))
  check('empty-name-is-rejected-in-dialog', nameError.shown === true, JSON.stringify(nameError))
  check('empty-name-keeps-dialog-open', stillOpen.present === true, JSON.stringify(stillOpen))
  check(
    'empty-name-does-not-add-preset',
    countAfterEmpty === beforePresets,
    JSON.stringify(countAfterEmpty)
  )
  // 关掉模态框，重新走一遍完整流程
  await jsonIn(s, CLICK_BUTTON('/^\\s*取消\\s*$|^\\s*Cancel\\s*$/'))
  await wait(700)

  // ---------------------------------------------------- 打开模态框
  const opened = await openTuneDialog(s, '模态框里调的预设')
  const state = await jsonIn(s, TUNE_STATE)
  const visibility = await jsonIn(s, TUNE_VISIBLE)
  const openedOk = opened.every((step) => step && step.found === true)
  write('open steps = ' + JSON.stringify(opened) + ' state = ' + JSON.stringify(state) + ' visible = ' + JSON.stringify(visibility))
  check('tune-dialog-opened', openedOk, JSON.stringify(opened))
  check('tune-dialog-visible', visibility.present === true && visibility.visible === true, JSON.stringify(visibility))
  check('tune-dialog-flat-groups-4', state.groups === 4, JSON.stringify(state.groups))
  check('tune-dialog-no-cards', state.cards === 0, JSON.stringify(state.cards))
  check('tune-dialog-sliders-17', state.sliders === 17, JSON.stringify(state.sliders))
  check('tune-dialog-width-input-1', state.widthInput === 1, JSON.stringify(state.widthInput))
  check('tune-dialog-colors-7', state.colors === 7, JSON.stringify(state.colors))
  check('tune-dialog-text-styles-4', state.styles === 4, JSON.stringify(state.styles))
  check('tune-dialog-live-preview', state.previewCard === 1, JSON.stringify(state.previewCard))
  check('tune-dialog-name-input', state.nameInput === true, JSON.stringify(state.nameInput))

  // ------------------------------- 1.5) 版面：预览不能压到表单，底部按钮要在视口里
  const layout = await jsonIn(
    s,
    `(function(){var left=document.querySelector(".tune-dialog__left");` +
      `var right=document.querySelector(".tune-dialog__preview");` +
      `var footer=document.querySelector(".tune-dialog .el-dialog__footer");` +
      // 注意：class 绑定落在 .el-dialog **自身**（class="el-dialog tune-dialog"），
      // 所以不能写 ".tune-dialog .el-dialog" 这种后代选择器，那样永远选不中。
      `var box=footer?footer.parentElement:null;` +
      `if(!left||!right||!footer||!box)return {found:false,hasLeft:!!left,hasRight:!!right,hasFooter:!!footer};` +
      `var l=left.getBoundingClientRect(),r=right.getBoundingClientRect();` +
      `var f=footer.getBoundingClientRect(),b=box.getBoundingClientRect();` +
      `var btns=[].slice.call(footer.querySelectorAll("button")).map(function(x){var z=x.getBoundingClientRect();return z.bottom;});` +
      `return {found:true,` +
      ` gap:Math.round(r.left-l.right),` +
      ` leftOverflow:Math.round(left.scrollWidth-left.clientWidth),` +
      ` dialogTop:Math.round(b.top),dialogBottom:Math.round(b.bottom),` +
      ` footerTop:Math.round(f.top),footerBottom:Math.round(f.bottom),` +
      ` footerOverElDialog:Math.round(f.bottom-b.bottom),` +
      ` buttonOverElDialog:btns.length?Math.round(Math.max.apply(null,btns)-b.bottom):null,` +
      ` viewportH:Math.round(window.innerHeight)};})()`
  )
  write('layout = ' + JSON.stringify(layout))
  check('tune-layout-measured', layout.found === true, JSON.stringify(layout))
  check(
    'tune-preview-does-not-overlap-form',
    layout.found === true && layout.gap > 0,
    JSON.stringify({ gap: layout.gap })
  )
  check(
    'tune-form-has-no-horizontal-overflow',
    layout.found === true && layout.leftOverflow === 0,
    JSON.stringify({ leftOverflow: layout.leftOverflow })
  )
  check(
    'tune-footer-inside-viewport',
    layout.found === true &&
      layout.footerBottom <= layout.viewportH + 1 &&
      layout.footerTop >= 0 &&
      layout.dialogTop >= -1,
    JSON.stringify({
      footerBottom: layout.footerBottom,
      viewportH: layout.viewportH,
      dialogTop: layout.dialogTop
    })
  )
  // 弹窗整体也必须收在视口里：底部表单是后加的，最容易把弹窗顶出屏幕下沿
  check(
    'tune-dialog-fits-viewport',
    layout.found === true && layout.dialogBottom <= layout.viewportH + 1,
    JSON.stringify({ dialogBottom: layout.dialogBottom, viewportH: layout.viewportH })
  )
  /*
   * 「按钮在视口内」还不够 —— 用户报的是按钮溢出到**弹窗容器**外面。
   * 之前只量了 viewport，于是「外框 599px、内部内容 607px」这种溢出整整漏掉了。
   */
  check(
    'tune-footer-inside-dialog-box',
    layout.found === true && layout.footerOverElDialog <= 1,
    JSON.stringify({ footerOverElDialog: layout.footerOverElDialog })
  )
  check(
    'tune-buttons-inside-dialog-box',
    layout.found === true && layout.buttonOverElDialog <= 1,
    JSON.stringify({ buttonOverElDialog: layout.buttonOverElDialog })
  )

  // ------------------------------- 1) 改控件 -> 不写盘
  const itemsBefore = await evalIn(s, PRESET_ITEMS)
  const dragged = await jsonIn(s, SET_TUNE_SLIDER(0, 0.85))
  await wait(900)
  const afterEdit = persisted()
  write(
    'preset items before=' +
      itemsBefore +
      ' drag=' +
      JSON.stringify(dragged) +
      ' appearance unchanged=' +
      deepEqual(afterEdit.appearance, beforeAppearance)
  )
  check('tune-slider-reachable', dragged.found === true, JSON.stringify(dragged))
  check(
    'editing-draft-does-not-touch-global',
    deepEqual(afterEdit.appearance, beforeAppearance),
    JSON.stringify(afterEdit.appearance)
  )
  check(
    'editing-draft-does-not-add-preset',
    (afterEdit.customPresets || []).length === beforePresets,
    JSON.stringify((afterEdit.customPresets || []).length)
  )

  // ------------------------------- 2) 保存 -> 只多一个预设
  await jsonIn(s, TYPE_INTO('.tune-dialog input.el-input__inner[maxlength="20"]', '模态框里调的预设'))
  await wait(400)
  const saved = await jsonIn(s, CLICK_BUTTON('/^\\s*保存预设\\s*$|^\\s*Save preset\\s*$/'))
  write('save click = ' + JSON.stringify(saved))
  const grew = await waitFor(
    async () => persisted(),
    (cfg) => cfg && (cfg.customPresets || []).length === beforePresets + 1
  )
  const afterSave = grew.seen || {}
  const newPreset = (afterSave.customPresets || []).find((p) => p.name === '模态框里调的预设')
  const afterSaveItems = await evalIn(s, PRESET_ITEMS)
  write(
    'after save = ' +
      JSON.stringify({
        presets: (afterSave.customPresets || []).length,
        items: afterSaveItems,
        newRadius: newPreset ? newPreset.appearance.background.radius : null,
        globalRadius: afterSave.appearance ? afterSave.appearance.background.radius : null
      })
  )
  check('preset-added', grew.ok, JSON.stringify((afterSave.customPresets || []).length))
  check('new-preset-name', Boolean(newPreset), JSON.stringify(newPreset && newPreset.name))
  check(
    'preset-card-rendered',
    afterSaveItems === itemsBefore + 1,
    `卡片 ${itemsBefore} -> ${afterSaveItems}（内置 5 张 + 自定义）`
  )
  check(
    'saved-preset-holds-draft-not-global',
    Boolean(newPreset) && !deepEqual(newPreset.appearance, beforeAppearance),
    newPreset ? JSON.stringify(newPreset.appearance.background.radius) : 'null'
  )
  check(
    'save-does-not-touch-global',
    deepEqual(afterSave.appearance, beforeAppearance),
    JSON.stringify(afterSave.appearance)
  )
  /*
   * 关闭用「先取一次基线，再等它真的关掉」的方式断言：
   * 直接轮询「没关」会受前一个脚本残留的 electron 进程影响（背靠背连跑时出现过
   * 8 秒还没关的假失败，单独跑 3 次全过）。这里只要求「本次保存之后确实关上了」，
   * 并同时断言 display 变成 none —— 曾经给 .el-dialog 写了 display: flex，
   * 特异性压过元素自带的 display: none，弹窗「关掉」后仍占着屏幕。
   */
  const closed = await waitFor(
    () => jsonIn(s, TUNE_VISIBLE),
    (v) => v.present === false || (v.visible === false && v.display === 'none'),
    15000
  )
  check(
    'tune-dialog-closed-after-save',
    closed.ok && grew.ok,
    JSON.stringify({ closed: closed.seen, presetCreated: grew.ok })
  )

  // ------------------------------- 3) 取消路径
  const beforeCancel = persisted()
  const reopen = await openTuneDialog(s, '这次的不要保存')
  const reopenOk = reopen.every((step) => step && step.found === true)
  const cancelDrag = await jsonIn(s, SET_TUNE_SLIDER(0, 0.2))
  await wait(600)
  const clickedCancel = await jsonIn(s, CLICK_BUTTON('/^\\s*取消\\s*$|^\\s*Cancel\\s*$/'))
  await wait(900)
  const afterCancel = persisted()
  write(
    'cancel flow = ' +
      JSON.stringify({
        reopen: reopenOk,
        drag: cancelDrag.found,
        click: clickedCancel,
        presets: (afterCancel.customPresets || []).length
      })
  )
  check('reopen-tune-dialog', reopenOk, JSON.stringify(reopen))
  check('cancel-button-clicked', clickedCancel.found === true, JSON.stringify(clickedCancel))
  check(
    'cancel-keeps-preset-count',
    (afterCancel.customPresets || []).length === (beforeCancel.customPresets || []).length,
    JSON.stringify((afterCancel.customPresets || []).length)
  )
  check(
    'cancel-keeps-global',
    deepEqual(afterCancel.appearance, beforeAppearance),
    JSON.stringify(afterCancel.appearance)
  )

  write(`SUMMARY failures=${failures}`)
  write('done')
  app.exit(failures === 0 ? 0 : 2)
})
