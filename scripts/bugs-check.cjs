// 三处修复的验证：
//   A) 开启「单位字覆盖」后，重新进入编辑页**不能**显示「未保存的更改」
//      （根因：computeItem 与 normalizeItem 的 units 键顺序不一致，而 dirty 比的是 JSON 字符串）
//   B) 新建预设：名称只问一次（保存弹窗只问来源；名称在模态框里调完参数再问）
//   C) 组件窗口被销毁后，「显示」必须能把它重建回来（曾经窗口没了就永久救不回来）
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
const probeRoot = path.join(appRoot, '.probe-userdata')
fs.mkdirSync(outDir, { recursive: true })

const userData = path.join(probeRoot, `bugs-${Date.now().toString(36)}`)
fs.mkdirSync(userData, { recursive: true })
try {
  for (const entry of fs.readdirSync(probeRoot)) {
    if (!entry.startsWith('bugs-')) continue
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

// 一开始就选「只显示天数」，顺带覆盖单位字那个场景
fs.writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify(
    {
      config: {
        countdowns: [
          {
            id: 'probe_bugs_a',
            name: '脏标记验证项',
            enabled: true,
            target: { mode: 'annual', date: '', month: 1, day: 1 },
            text: { hint: '', futureText: '', todayText: '', pastText: '', unit: '' },
            units: { enabled: false, day: '', hour: '', minute: '', second: '' },
            appearance: {}
          }
        ],
        activeId: 'probe_bugs_a',
        behavior: { displayMode: 'days' },
        runtime: { widgetVisible: true, toggleHotkey: '', language: 'zh-CN' }
      }
    },
    null,
    '\t'
  )
)

const logFile = path.join(outDir, 'bugs.log')
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

function widgetWindow() {
  return BrowserWindow.getAllWindows().find((win) => win.getTitle() === '倒数日') || null
}

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

async function waitFor(probe, predicate, timeoutMs = 10000) {
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

const CLICK_BUTTON = (pattern) =>
  `(function(){var bs=[].slice.call(document.querySelectorAll("button")).filter(function(x){` +
  `var r=x.getBoundingClientRect();return r.width>0&&r.height>0&&${pattern}.test(x.textContent||"")});` +
  `if(!bs.length)return {found:false,all:[].slice.call(document.querySelectorAll("button")).map(function(x){return (x.textContent||"").trim().slice(0,14)})};` +
  `var b=bs[bs.length-1];b.click();return {found:true,text:(b.textContent||"").trim()};})()`

/** 编辑页顶部那排标签：脏标记/已保存提示都在 .editor-head 里 */
const EDITOR_TAGS =
  '({tags:[].slice.call(document.querySelectorAll(".editor-head .el-tag")).map(function(x){return (x.textContent||"").trim()}),' +
  ' dirty:!!document.querySelector(".editor-head .el-tag--warning"),' +
  ' saved:!!document.querySelector(".editor-head .el-tag--success"),' +
  ' unitsCustom:(function(){var sw=[].slice.call(document.querySelectorAll(".el-switch"));' +
  'var hit=sw.filter(function(x){var f=x.closest(".field-row");return f&&/单位字|Unit labels/.test(f.textContent||"")})[0];' +
  'return hit?hit.classList.contains("is-checked"):null;})()})'

const OPEN_ROW = (index) =>
  `(function(){var rows=document.querySelectorAll(".cd-row__main");` +
  `if(rows.length<=${index})return {found:false,count:rows.length};` +
  `rows[${index}].click();return {found:true,count:rows.length};})()`

const TOGGLE_UNITS_OVERRIDE =
  `(function(){var sw=[].slice.call(document.querySelectorAll(".el-switch"));` +
  `var hit=sw.filter(function(x){var f=x.closest(".field-row");` +
  `return f&&/单位字|Unit labels/.test(f.textContent||"")})[0];` +
  `if(!hit)return {found:false};hit.click();return {found:true};})()`

const SAVE_EDITOR =
  `(function(){var bs=[].slice.call(document.querySelectorAll(".editor-head button"));` +
  `var b=bs.filter(function(x){return /保存|Save/.test(x.textContent||"")})[0];` +
  `if(!b)return {found:false};b.click();return {found:true};})()`

const CLICK_NAV_PRESET =
  `(function(){var navs=[].slice.call(document.querySelectorAll(".settings-nav__item"));` +
  `var nav=navs.filter(function(x){return /预设主题|Presets/.test(x.textContent||"")})[0];` +
  `if(!nav)return {found:false};nav.click();return {found:true};})()`

/** 保存/新建预设弹窗里有没有名称输入框 */
const SAVE_DIALOG_NAME =
  '({nameInput:!!document.querySelector(".el-dialog input.el-input__inner[maxlength=\\"20\\"]"),' +
  ' title:(function(){var h=document.querySelector(".el-dialog__title");return h?(h.textContent||"").trim():"";})()})'

const TUNE_NAME_INPUT =
  '!!document.querySelector(".tune-dialog input.el-input__inner[maxlength=\\"20\\"]")'

const TUNE_STATE =
  '({groups:document.querySelectorAll(".tune-dialog .override-group").length,' +
  ' preview:document.querySelectorAll(".tune-dialog .preview .cd-card").length,' +
  ' previewTitle:(function(){var t=document.querySelector(".tune-dialog .preview .cd-card__title");' +
  'return t?(t.textContent||"").trim():"";})()})'

const TYPE_INTO = (selector, text) =>
  `(function(){var el=document.querySelector(${JSON.stringify(selector)});` +
  `if(!el)return {found:false};` +
  `var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;` +
  `setter.call(el,${JSON.stringify(text)});` +
  `el.dispatchEvent(new Event("input",{bubbles:true}));` +
  `return {found:true,value:el.value};})()`

async function openPresetSaveDialog(win) {
  await jsonIn(win, CLICK_NAV_PRESET)
  await wait(900)
  const add = await jsonIn(win, CLICK_BUTTON('/新建预设|New preset/'))
  await wait(700)
  return add
}

app.whenReady().then(async () => {
  await wait(4000)

  // ================================================================ C) 组件窗口恢复
  const before = widgetWindow()
  check('widget-window-exists-at-start', Boolean(before), before ? 'ok' : 'missing')

  if (before) {
    // 模拟用户从任务栏把组件窗口关掉（Win 上就是 close 这条路径）
    before.close()
  }
  const gone = await waitFor(async () => widgetWindow(), (win) => win === null, 6000)
  write('after close: window gone = ' + JSON.stringify(gone.ok))
  check('widget-window-destroyed', gone.ok, 'close() 之后窗口应当不存在')

  // 托盘菜单应当已经回到「显示倒数日」，否则用户找不到入口
  const menuAfterClose = main.trayMenuSnapshot ? main.trayMenuSnapshot() : null
  const firstItem = menuAfterClose && menuAfterClose[0] ? menuAfterClose[0].label : ''
  write('tray first item after close = ' + JSON.stringify(firstItem))
  check(
    'tray-shows-show-after-close',
    /显示倒数日|Show countdown/.test(firstItem),
    JSON.stringify(firstItem)
  )

  // 关键一条：窗口没了之后，「显示」必须把它重建回来
  main.triggerWidgetToggle()
  const returned = await waitFor(async () => widgetWindow(), (win) => win !== null, 10000)
  await wait(600)
  const newWidget = returned.seen
  const newVisible = newWidget ? newWidget.isVisible() : false
  write('after show: recreated=' + JSON.stringify(Boolean(newWidget)) + ' visible=' + JSON.stringify(newVisible))
  check('widget-recreated-after-show', returned.ok, JSON.stringify(Boolean(newWidget)))
  check('widget-visible-after-recreate', newVisible === true, JSON.stringify(newVisible))
  // 重建出来的窗口也必须是「不进任务栏」的组件窗口
  check(
    'recreated-window-keeps-widget-traits',
    Boolean(newWidget) && newWidget.isAlwaysOnTop() && newWidget.isResizable() === false,
    JSON.stringify(newWidget ? { alwaysOnTop: newWidget.isAlwaysOnTop(), resizable: newWidget.isResizable() } : null)
  )
  const menuAfterShow = main.trayMenuSnapshot ? main.trayMenuSnapshot() : null
  const firstAfterShow = menuAfterShow && menuAfterShow[0] ? menuAfterShow[0].label : ''
  check(
    'tray-shows-hide-after-show',
    /隐藏倒数日|Hide countdown/.test(firstAfterShow),
    JSON.stringify(firstAfterShow)
  )

  // ================================================ A) 单位字覆盖：脏标记不能误报
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

  // 1) 进编辑页 -> 打开单位字覆盖 -> 保存
  await jsonIn(s, OPEN_ROW(0))
  await wait(1200)
  const first = await jsonIn(s, EDITOR_TAGS)
  write('editor first open = ' + JSON.stringify(first))
  check('units-override-off-initially', first.unitsCustom === false, JSON.stringify(first.unitsCustom))

  const toggled = await jsonIn(s, TOGGLE_UNITS_OVERRIDE)
  await wait(600)
  const afterToggle = await jsonIn(s, EDITOR_TAGS)
  check('units-override-opened', toggled.found === true && afterToggle.unitsCustom === true, JSON.stringify(afterToggle.unitsCustom))
  check('dirty-after-real-edit', afterToggle.dirty === true, JSON.stringify(afterToggle.tags))

  const savedClick = await jsonIn(s, SAVE_EDITOR)
  const savedUnits = await waitFor(
    async () => persisted(),
    (cfg) => cfg && cfg.countdowns[0].units && cfg.countdowns[0].units.enabled === true
  )
  write(
    'after save: click=' +
      JSON.stringify(savedClick) +
      ' units=' +
      JSON.stringify(savedUnits.seen ? savedUnits.seen.countdowns[0].units : null)
  )
  check('units-override-persisted', savedUnits.ok, JSON.stringify(savedUnits.seen && savedUnits.seen.countdowns[0].units))
  // 落盘的键顺序应当与 normalizeItem 一致（四个字在前、enabled 在最后）
  check(
    'persisted-units-key-order',
    savedUnits.seen &&
      JSON.stringify(Object.keys(savedUnits.seen.countdowns[0].units)) ===
        JSON.stringify(['day', 'hour', 'minute', 'second', 'enabled']),
    JSON.stringify(savedUnits.seen ? Object.keys(savedUnits.seen.countdowns[0].units) : null)
  )

  // 2) 退出编辑页再进来：这就是用户报的那个场景
  await jsonIn(s, CLICK_BUTTON('/返回列表|Back to list/'))
  await wait(1200)
  const dialog = await jsonIn(
    s,
    `(function(){return {found:!!document.querySelector(".el-message-box")};})()`
  )
  if (dialog.found) {
    // 保存后不该再弹「放弃修改」，真弹了就说明脏标记在保存那一刻又翻成 true 了
    await jsonIn(
      s,
      `(function(){var box=document.querySelector(".el-message-box");` +
        `var bs=[].slice.call(box.querySelectorAll("button"));` +
        `var d=bs.filter(function(x){return /放弃修改|Discard/.test(x.textContent||"")})[0];` +
        `if(d)d.click();return {found:true};})()`
    )
    await wait(900)
  }
  check('no-discard-dialog-after-save', dialog.found === false, JSON.stringify(dialog))

  await jsonIn(s, OPEN_ROW(0))
  await wait(1400)
  const reopened = await jsonIn(s, EDITOR_TAGS)
  write('editor reopened = ' + JSON.stringify(reopened))
  check('units-override-still-on', reopened.unitsCustom === true, JSON.stringify(reopened.unitsCustom))
  check(
    'no-dirty-on-reopen',
    reopened.dirty === false,
    JSON.stringify({ dirty: reopened.dirty, tags: reopened.tags })
  )

  // ================================================ B) 名称只问一次
  await jsonIn(s, CLICK_BUTTON('/返回列表|Back to list/'))
  await wait(1200)
  await jsonIn(
    s,
    `(function(){var box=document.querySelector(".el-message-box");if(!box)return {found:false};` +
      `var bs=[].slice.call(box.querySelectorAll("button"));` +
      `var d=bs.filter(function(x){return /放弃修改|Discard/.test(x.textContent||"")})[0];if(d)d.click();return {found:true};})()`
  )
  await wait(900)

  const addButton = await openPresetSaveDialog(s)
  const dialogState = await jsonIn(s, SAVE_DIALOG_NAME)
  write('save dialog = ' + JSON.stringify(dialogState) + ' addButton=' + JSON.stringify(addButton))
  check('new-preset-button-found', addButton.found === true, JSON.stringify(addButton))
  check(
    'save-dialog-header-is-new-preset',
    /新建预设|New preset/.test(dialogState.title || ''),
    JSON.stringify(dialogState.title)
  )
  check(
    'save-dialog-has-name-for-global-source',
    dialogState.nameInput === true,
    JSON.stringify(dialogState.nameInput)
  )

  // 切到「手动调整所有参数」：名称输入框应当从保存弹窗里消失
  await jsonIn(
    s,
    `(function(){var rs=[].slice.call(document.querySelectorAll(".el-dialog .el-radio"));` +
      `var hit=rs.filter(function(x){return /手动调整所有参数|Tune every value manually/.test(x.textContent||"")})[0];` +
      `if(!hit)return {found:false};hit.click();return {found:true};})()`
  )
  await wait(500)
  const manualState = await jsonIn(s, SAVE_DIALOG_NAME)
  write('manual mode save dialog = ' + JSON.stringify(manualState))
  check(
    'save-dialog-hides-name-for-manual',
    manualState.nameInput === false,
    JSON.stringify(manualState.nameInput)
  )

  // 进模态框：这里才是唯一一次问名字的地方
  const toTune = await jsonIn(s, CLICK_BUTTON('/手动调整参数|Tune the values/'))
  await wait(1400)
  const tuneNameInput = await evalIn(s, TUNE_NAME_INPUT)
  const tuneState = await jsonIn(s, TUNE_STATE)
  write('tune dialog: nameInput=' + JSON.stringify(tuneNameInput) + ' state=' + JSON.stringify(tuneState))
  check('tune-dialog-owns-name-input', tuneNameInput === true, JSON.stringify(tuneNameInput))
  check('tune-dialog-opened', tuneState.groups === 4, JSON.stringify(tuneState.groups))

  const previewBefore = await jsonIn(
    s,
    `(function(){var t=document.querySelector(".tune-dialog .preview .cd-card__title");` +
      `return {title:t?(t.textContent||"").trim():"<none>",` +
      ` html:(t&&t.outerHTML?t.outerHTML.slice(0,120):"")};})()`
  )
  await jsonIn(s, TYPE_INTO('.tune-dialog input.el-input__inner[maxlength="20"]', '深蓝夜间'))
  await wait(900)
  const named = await jsonIn(s, TUNE_STATE)
  const inputValue = await evalIn(
    s,
    '(function(){var el=document.querySelector(".tune-dialog input.el-input__inner[maxlength=\\"20\\"]");return el?el.value:"<none>";})()'
  )
  write(
    'tune preview: before=' +
      JSON.stringify(previewBefore) +
      ' inputValue=' +
      JSON.stringify(inputValue) +
      ' afterTitle=' +
      JSON.stringify(named.previewTitle)
  )
  check('tune-preview-follows-name', named.previewTitle === '深蓝夜间', JSON.stringify(named.previewTitle))

  const beforeSave = persisted()
  const confirmClick = await jsonIn(s, CLICK_BUTTON('/^\\s*保存预设\\s*$|^\\s*Save preset\\s*$/'))
  const created = await waitFor(
    async () => persisted(),
    (cfg) => cfg && (cfg.customPresets || []).length === (beforeSave.customPresets || []).length + 1
  )
  const afterSave = created.seen || {}
  const newPreset = (afterSave.customPresets || []).find((p) => p.name === '深蓝夜间')
  write(
    'save via tune = ' +
      JSON.stringify({ click: confirmClick, presets: (afterSave.customPresets || []).length, name: newPreset && newPreset.name })
  )
  check('preset-created-from-tune-name', Boolean(newPreset), JSON.stringify(newPreset && newPreset.name))
  check(
    'tune-save-keeps-global',
    JSON.stringify(afterSave.appearance) === JSON.stringify(beforeSave.appearance),
    '全局 appearance 不该被这次保存改动'
  )

  write(`SUMMARY failures=${failures}`)
  write('done')
  app.exit(failures === 0 ? 0 : 2)
})
