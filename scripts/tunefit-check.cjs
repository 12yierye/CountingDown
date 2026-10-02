// 「手动调整参数」弹窗在多种窗口高度下的版面测量（不改代码，纯测量）。
//
// 关键：此前只断言了「按钮在**视口**内」，没断言「按钮在**弹窗容器**内」——
// 用户报的是后者（按钮溢出到弹窗边框外面）。这里把两个都量出来。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
const probeRoot = path.join(appRoot, '.probe-userdata')
fs.mkdirSync(outDir, { recursive: true })

const userData = path.join(probeRoot, `tunefit-${Date.now().toString(36)}`)
fs.mkdirSync(userData, { recursive: true })

fs.writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify(
    {
      config: {
        countdowns: [
          {
            id: 'probe_fit_a',
            name: '版面测量项',
            enabled: true,
            target: { mode: 'annual', date: '', month: 1, day: 1 },
            text: { hint: '', futureText: '', todayText: '', pastText: '', unit: '' },
            appearance: {}
          }
        ],
        activeId: 'probe_fit_a',
        runtime: { widgetVisible: true, toggleHotkey: '', language: 'zh-CN' }
      }
    },
    null,
    '\t'
  )
)

const logFile = path.join(outDir, 'tunefit.log')
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

const CLICK_BUTTON = (pattern) =>
  `(function(){var bs=[].slice.call(document.querySelectorAll("button")).filter(function(x){` +
  `var r=x.getBoundingClientRect();return r.width>0&&r.height>0&&${pattern}.test(x.textContent||"")});` +
  `if(!bs.length)return {found:false};var b=bs[bs.length-1];b.click();return {found:true};})()`

async function openTuneDialog(win) {
  await jsonIn(win, CLICK_BUTTON('/预设主题|Presets/'))
  await wait(900)
  await jsonIn(win, CLICK_BUTTON('/新建预设|New preset/'))
  await wait(700)
  await jsonIn(
    win,
    `(function(){var rs=[].slice.call(document.querySelectorAll(".el-dialog .el-radio"));` +
      `var hit=rs.filter(function(x){return /手动调整所有参数|Tune every value manually/.test(x.textContent||"")})[0];` +
      `if(!hit)return {found:false};hit.click();return {found:true};})()`
  )
  await wait(500)
  await jsonIn(win, CLICK_BUTTON('/手动调整参数|Tune the values/'))
  await wait(1400)
}

/**
 * 量四组几何：
 *   - dialog：弹窗自身（footer 的父元素，class 就在它身上）
 *   - body / footer / 两个按钮
 *   - inner：body 内部的滚动容器（.tune-dialog__left / .tune-dialog__name）
 * 判据：footer 与按钮必须完全落在 dialog 矩形之内，且 dialog 落在视口之内。
 */
const FIT =
  '(function(){' +
  'var footer=document.querySelector(".tune-dialog .el-dialog__footer");' +
  'var box=footer?footer.parentElement:null;' +
  'var body=document.querySelector(".tune-dialog .el-dialog__body");' +
  'var left=document.querySelector(".tune-dialog__left");' +
  'var name=document.querySelector(".tune-dialog__name");' +
  'var inner=document.querySelector(".tune-dialog__inner");' +
  'var header=document.querySelector(".tune-dialog .el-dialog__header");' +
  'if(!footer||!box||!body)return {found:false,hasFooter:!!footer,hasBox:!!box,hasBody:!!body};' +
  'var f=footer.getBoundingClientRect(),b=box.getBoundingClientRect(),d=body.getBoundingClientRect();' +
  'var btns=[].slice.call(footer.querySelectorAll("button")).map(function(x){' +
  'var r=x.getBoundingClientRect();return {t:(x.textContent||"").trim(),top:Math.round(r.top),bottom:Math.round(r.bottom),right:Math.round(r.right)};});' +
  'return {found:true,' +
  ' viewportH:Math.round(window.innerHeight),' +
  ' boxSizing:getComputedStyle(box).boxSizing,' +
  ' boxMaxH:getComputedStyle(box).maxHeight,' +
  ' boxHeight:getComputedStyle(box).height,' +
  ' boxInlineStyle:box.getAttribute("style"),' +
  ' boxDisplay:getComputedStyle(box).display,' +
  ' boxOverflow:getComputedStyle(box).overflow,' +
  ' innerDisplay:inner?getComputedStyle(inner).display:null,' +
  ' innerMaxH:inner?getComputedStyle(inner).maxHeight:null,' +
  ' inner:{h:inner?Math.round(inner.getBoundingClientRect().height):null,scrollH:inner?inner.scrollHeight:null},' +
  ' headerH:header?Math.round(header.getBoundingClientRect().height):null,' +
  ' dialog:{top:Math.round(b.top),bottom:Math.round(b.bottom),h:Math.round(b.height),clientH:box.clientHeight,scrollH:box.scrollHeight},' +
  ' body:{top:Math.round(d.top),bottom:Math.round(d.bottom),h:Math.round(d.height),clientH:body.clientHeight,scrollH:body.scrollHeight,overflowY:getComputedStyle(body).overflowY},' +
  ' leftH:left?Math.round(left.getBoundingClientRect().height):null,' +
  ' nameBottom:name?Math.round(name.getBoundingClientRect().bottom):null,' +
  ' footer:{top:Math.round(f.top),bottom:Math.round(f.bottom),left:Math.round(f.left),right:Math.round(f.right)},' +
  ' buttons:btns,' +
  ' footerOverflowsDialog:Math.round(f.bottom-b.bottom),' +
  ' buttonOverflowsDialog:btns.length?Math.max.apply(null,btns.map(function(x){return x.bottom-Math.round(b.bottom)})):null,' +
  ' dialogOverflowsViewport:Math.round(b.bottom-window.innerHeight),' +
  ' bodyScrolls:body.scrollHeight>body.clientHeight+1};})()'

app.whenReady().then(async () => {
  await wait(4000)
  main.openSettingsWindow()
  await wait(4500)
  const s = settingsWindow()
  check('settings-window-exists', Boolean(s), s ? 'ok' : 'missing')
  if (!s) {
    app.exit(1)
    return
  }
  s.show()
  s.focus()
  await wait(1000)

  // 依次测量：默认 1000×720、允许的最小 880×600，以及两者之间的 900×660
  const sizes = [
    { w: 1000, h: 720, tag: '1000x720(默认)' },
    { w: 900, h: 660, tag: '900x660' },
    { w: 880, h: 600, tag: '880x600(最小)' }
  ]

  for (const size of sizes) {
    s.setSize(size.w, size.h)
    await wait(700)
    // 每次都重新打开弹窗，确保测到的是「刚打开」的初始状态
    await openTuneDialog(s)
    const fit = await jsonIn(s, FIT)
    write(`--- ${size.tag} ---`)
    write(JSON.stringify(fit, null, 1))
    check(
      `${size.tag} 弹窗在视口内`,
      fit.found === true && fit.dialogOverflowsViewport <= 1,
      fit.found ? `dialogOverflowsViewport=${fit.dialogOverflowsViewport}` : JSON.stringify(fit)
    )
    check(
      `${size.tag} 按钮未溢出弹窗容器`,
      fit.found === true && fit.buttonOverflowsDialog <= 1,
      fit.found ? `buttonOverflowsDialog=${fit.buttonOverflowsDialog}` : JSON.stringify(fit)
    )
    check(
      `${size.tag} footer 未溢出弹窗容器`,
      fit.found === true && fit.footerOverflowsDialog <= 1,
      fit.found ? `footerOverflowsDialog=${fit.footerOverflowsDialog}` : JSON.stringify(fit)
    )
    // 收尾：把弹窗关掉，并确认「隐藏」仍然生效
    // （这次的修复依赖 `.el-dialog.tune-dialog:not([style*="display: none"])` 这个条件选择器，
    //  一旦条件写错就会退化成「弹窗关不掉、仍占着屏幕」，所以这条必须每次都断言。）
    await jsonIn(s, CLICK_BUTTON('/^\\s*取消\\s*$|^\\s*Cancel\\s*$/'))
    await wait(900)
    const hidden = await jsonIn(
      s,
      '(function(){var d=document.querySelector(".tune-dialog");' +
        'if(!d)return {present:false};' +
        'var cs=getComputedStyle(d);' +
        'return {present:true,display:cs.display,inline:d.getAttribute("style")};})()'
    )
    write(`close after ${size.tag} = ` + JSON.stringify(hidden))
    check(
      `${size.tag} 取消后弹窗已隐藏`,
      hidden.present === false || hidden.display === 'none',
      JSON.stringify(hidden)
    )
  }

  write(`SUMMARY failures=${failures}`)
  write('done')
  app.exit(failures === 0 ? 0 : 2)
})
