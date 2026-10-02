// 预设保存的另外两个来源没被改坏：
//   A) 「当前全局外观」= 存预设 **并且** 把全局外观覆盖成这一份（这条语义必须保留）
//   B) 「某个倒数日的外观覆盖」= 存预设 **并且** 把该倒数日的覆盖改成这一份
//
// 背景：把 target/tune 换成 saveMode 时，「手动调整」和「当前全局外观」在原实现里
// 都会发 target='global'，接收端分不出来。改完之后最容易出的错就是顺手把 A 覆盖全局
// 那一步也删掉、或者把 B 的 itemId 判空写反 —— 所以这两条各自要有实测断言。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
const probeRoot = path.join(appRoot, '.probe-userdata')
fs.mkdirSync(outDir, { recursive: true })

const userData = path.join(probeRoot, `preset-sources-${Date.now().toString(36)}`)
fs.mkdirSync(userData, { recursive: true })
try {
  for (const entry of fs.readdirSync(probeRoot)) {
    if (!entry.startsWith('preset-sources-')) continue
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

const ITEM_A = {
  id: 'probe_src_a',
  name: '来源验证项 A',
  enabled: true,
  target: { mode: 'annual', date: '', month: 1, day: 1 },
  text: { hint: '', futureText: '', todayText: '', pastText: '', unit: '' },
  appearance: {}
}
const ITEM_B = {
  id: 'probe_src_b',
  name: '来源验证项 B',
  enabled: true,
  target: { mode: 'annual', date: '', month: 6, day: 1 },
  text: { hint: '', futureText: '', todayText: '', pastText: '', unit: '' },
  // B 有一份自己的外观覆盖，用来验证「全局 + 它的覆盖」这条合并
  appearance: { background: { color: '#ff0055', radius: 30 } }
}

fs.writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify(
    {
      config: {
        countdowns: [ITEM_A, ITEM_B],
        activeId: ITEM_A.id,
        runtime: { widgetVisible: true, toggleHotkey: '', language: 'zh-CN' }
      }
    },
    null,
    '\t'
  )
)

const logFile = path.join(outDir, 'preset-sources.log')
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

const CLICK_BUTTON = (pattern) =>
  `(function(){var bs=[].slice.call(document.querySelectorAll("button")).filter(function(x){` +
  `var r=x.getBoundingClientRect();return r.width>0&&r.height>0&&${pattern}.test(x.textContent||"")});` +
  `if(!bs.length)return {found:false,all:[].slice.call(document.querySelectorAll("button")).map(function(x){return (x.textContent||"").trim().slice(0,12)})};` +
  `var b=bs[bs.length-1];b.click();return {found:true,text:(b.textContent||"").trim()};})()`

/** 弹窗里按可见文字点某个单选（来源三选一） */
const CLICK_RADIO = (pattern) =>
  `(function(){var rs=[].slice.call(document.querySelectorAll(".el-dialog .el-radio"));` +
  `var hit=rs.filter(function(x){return ${pattern}.test(x.textContent||"")})[0];` +
  `if(!hit)return {found:false,all:rs.map(function(x){return (x.textContent||"").trim()})};` +
  `hit.click();return {found:true,text:(hit.textContent||"").trim()};})()`

/** 在下拉里挑一项（Element Plus 的下拉是 teleport 到 body 的） */
const PICK_OPTION = (pattern) =>
  `(function(){var os=[].slice.call(document.querySelectorAll(".el-select-dropdown__item, .el-option"));` +
  `var hit=os.filter(function(x){return ${pattern}.test(x.textContent||"")})[0];` +
  `if(!hit)return {found:false,all:os.map(function(x){return (x.textContent||"").trim()})};` +
  `hit.click();return {found:true,text:(hit.textContent||"").trim()};})()`

const OPEN_SELECT = '(function(){var t=document.querySelector(".el-dialog .el-select");if(!t)return {found:false};t.click();return {found:true};})()'

const TYPE_INTO = (selector, text) =>
  `(function(){var el=document.querySelector(${JSON.stringify(selector)});` +
  `if(!el)return {found:false};` +
  `var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;` +
  `setter.call(el,${JSON.stringify(text)});` +
  `el.dispatchEvent(new Event("input",{bubbles:true}));` +
  `return {found:true,value:el.value};})()`

const CLICK_NAV_PRESET =
  `(function(){var navs=[].slice.call(document.querySelectorAll(".settings-nav__item"));` +
  `var nav=navs.filter(function(x){return /预设主题|Presets/.test(x.textContent||"")})[0];` +
  `if(!nav)return {found:false};nav.click();return {found:true};})()`

const CLICK_ADD_PRESET =
  `(function(){var add=[].slice.call(document.querySelectorAll("button")).filter(function(x){` +
  `return /新建预设|New preset/.test(x.textContent||"")})[0];` +
  `if(!add)return {found:false};add.click();return {found:true};})()`

const NAME_INPUT = '.el-dialog input.el-input__inner[maxlength="20"]'
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** 打开保存弹窗并展开一次，后面按需切来源 */
async function openSaveDialog(win) {
  await jsonIn(win, CLICK_NAV_PRESET)
  await wait(900)
  const opened = await jsonIn(win, CLICK_ADD_PRESET)
  await wait(700)
  return opened
}

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

  const boot = persisted()
  const bootAppearance = boot.appearance
  write('boot appearance radius = ' + JSON.stringify(bootAppearance.background.radius))

  // ------------------------------- A) 当前全局外观：存预设 + 覆盖全局
  await openSaveDialog(s)
  // 先把全局外观改一个明显不同的值，这样「套用」与「没套用」能区分开
  await evalIn(
    s,
    'window.cd.updateConfig({appearance:{background:{radius:44}}}).then(function(){return "ok"})'
  )
  await wait(800)
  const midAppearance = persisted().appearance
  await jsonIn(s, TYPE_INTO(NAME_INPUT, '全局来源预设'))
  await wait(300)
  const globalRadio = await jsonIn(s, CLICK_RADIO('/当前全局外观|Current global appearance/'))
  await wait(300)
  const globalSaved = await jsonIn(s, CLICK_BUTTON('/^\\s*确定\\s*$|^\\s*Confirm\\s*$/'))
  const globalDone = await waitFor(
    async () => persisted(),
    (cfg) => cfg && (cfg.customPresets || []).length === 1
  )
  const afterGlobal = globalDone.seen || {}
  write(
    'A) radio=' +
      JSON.stringify(globalRadio) +
      ' saved=' +
      JSON.stringify(globalSaved) +
      ' presets=' +
      (afterGlobal.customPresets || []).length +
      ' radius=' +
      (afterGlobal.appearance ? afterGlobal.appearance.background.radius : null)
  )
  check('global-radio-clicked', globalRadio.found === true, JSON.stringify(globalRadio))
  check('global-source-preset-added', globalDone.ok, JSON.stringify((afterGlobal.customPresets || []).length))
  check(
    'global-source-overwrites-global',
    afterGlobal.appearance &&
      afterGlobal.appearance.background.radius === midAppearance.background.radius,
    `global radius=${afterGlobal.appearance && afterGlobal.appearance.background.radius} / saved snapshot=${midAppearance.background.radius}`
  )

  // ------------------------------- B) 某个倒数日的外观覆盖：存预设 + 写回该项
  await openSaveDialog(s)
  const itemRadio = await jsonIn(s, CLICK_RADIO('/倒数日的外观覆盖|Appearance override of one countdown/'))
  await wait(500)
  const openedSelect = await jsonIn(s, OPEN_SELECT)
  await wait(600)
  const picked = await jsonIn(s, PICK_OPTION('/来源验证项 B/'))
  await wait(400)
  await jsonIn(s, TYPE_INTO(NAME_INPUT, '倒数日来源预设'))
  await wait(300)
  const beforeItemSave = persisted()
  const itemSaved = await jsonIn(s, CLICK_BUTTON('/^\\s*确定\\s*$|^\\s*Confirm\\s*$/'))
  const itemDone = await waitFor(
    async () => persisted(),
    (cfg) => cfg && (cfg.customPresets || []).length === 2
  )
  const afterItem = itemDone.seen || {}
  const itemB = (afterItem.countdowns || []).find((x) => x.id === ITEM_B.id)
  const presetB = (afterItem.customPresets || []).find((p) => p.name === '倒数日来源预设')
  write(
    'B) radio=' +
      JSON.stringify(itemRadio) +
      ' select=' +
      JSON.stringify(openedSelect) +
      ' pick=' +
      JSON.stringify(picked) +
      ' saved=' +
      JSON.stringify(itemSaved)
  )
  write(
    'B) itemB.appearance=' +
      JSON.stringify(itemB && itemB.appearance) +
      ' presetB.bg=' +
      JSON.stringify(presetB && presetB.appearance.background)
  )
  check('item-radio-clicked', itemRadio.found === true, JSON.stringify(itemRadio))
  check('item-option-picked', picked.found === true, JSON.stringify(picked))
  check('item-source-preset-added', itemDone.ok, JSON.stringify((afterItem.customPresets || []).length))
  check(
    'item-source-writes-item-override',
    itemB && itemB.appearance && itemB.appearance.background && itemB.appearance.background.radius === 30,
    JSON.stringify(itemB && itemB.appearance)
  )
  check(
    'item-source-preset-is-merged-global-plus-override',
    presetB && presetB.appearance.background.radius === 30 && presetB.appearance.background.color === '#ff0055',
    JSON.stringify(presetB && presetB.appearance.background)
  )
  check(
    'item-source-keeps-other-item-untouched',
    deepEqual(
      (afterItem.countdowns || []).find((x) => x.id === ITEM_A.id).appearance,
      beforeItemSave.countdowns.find((x) => x.id === ITEM_A.id).appearance
    ),
    JSON.stringify((afterItem.countdowns || []).find((x) => x.id === ITEM_A.id).appearance)
  )

  write(`SUMMARY failures=${failures}`)
  write('done')
  app.exit(failures === 0 ? 0 : 2)
})
