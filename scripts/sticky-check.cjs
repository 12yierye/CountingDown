// 编辑子页吸顶栏验证（DOM 级，直接跑真实的 out/renderer 产物）：
//   1) 未吸顶：有圆角、有边框、没有 is-stuck
//   2) 只滚 10px（不足 18px 的 padding-top）：仍然不算吸顶
//   3) 吸顶：is-stuck 生效，上方圆角 0、边框透明、栏体贴住滚动视口顶端、保存按钮可见
//   4) 一次滚到底：滚完的**第一帧**就已经是吸顶态（不会「先画一帧圆角再变方」）
//   5) 回到顶部：圆角与边框原样恢复
//   6) 保存按钮不再跳回列表：点完仍停在编辑页，草稿已落盘、脏标记消失
//
// 用内存版 window.cd（scripts/probe-preload.cjs）代替真主进程：主进程启动要读系统
// 注册表（判断系统透明效果），本机命令安全策略拉黑了 reg.exe。界面仍是真产物，
// 因此 CSS/组件/吸顶判定逻辑全部是真代码。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
fs.mkdirSync(outDir, { recursive: true })

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('in-process-gpu')
// 窗口被遮挡时 Chromium 会停掉渲染生命周期，scroll 事件与 rAF 都不再派发 ——
// 那会让「滚动 → 吸顶」整条链路在测试里根本不发生。这几个开关关掉后台节流与遮挡判定。
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

/* 用真实的默认配置工厂，别手抄一份 —— 抄的那份迟早会和源码对不上 */
const defaultsFile = path.join(outDir, 'probe-defaults.cjs')
require('esbuild').buildSync({
  entryPoints: [path.join(appRoot, 'src/shared/defaults.ts')],
  outfile: defaultsFile,
  format: 'cjs',
  platform: 'node',
  bundle: true,
  logLevel: 'silent'
})
const { createDefaultConfig, createCountdownItem } = require(defaultsFile)

const logFile = path.join(outDir, 'sticky.log')
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
  appendLog('UNCAUGHT ' + (error && error.stack))
})

/* 探针配置：两项，第一项就是当前显示项 */
const ITEM_A = createCountdownItem({
  id: 'probe_item_a',
  name: '吸顶检查项',
  enabled: true,
  target: { mode: 'once', date: '2030-12-31T23:59', month: 12, day: 31 },
  text: { hint: '副标题', futureText: '', todayText: '', pastText: '', unit: '' }
})
const ITEM_B = createCountdownItem({
  id: 'probe_item_b',
  name: '第二项',
  enabled: true,
  target: { mode: 'annual', date: '', month: 6, day: 1 }
})

/** 列表需要够长，「列表滚到中途再进编辑页」才有得滚 */
const FILLER = Array.from({ length: 10 }, (_, index) =>
  createCountdownItem({
    id: `probe_item_f${index}`,
    name: `填充项 ${index + 1}`,
    enabled: false,
    target: { mode: 'annual', date: '', month: (index % 12) + 1, day: 1 }
  })
)

const config = createDefaultConfig()
config.countdowns = [ITEM_A, ITEM_B, ...FILLER]
config.activeId = ITEM_A.id
config.runtime.language = 'zh-CN'
config.runtime.toggleHotkey = ''

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let win = null

async function evalIn(expression) {
  if (!win) return 'NO_WINDOW'
  try {
    return await win.webContents.executeJavaScript(expression)
  } catch (error) {
    return 'EVAL_FAIL ' + error
  }
}

async function jsonIn(expression) {
  const raw = await evalIn(`JSON.stringify(${expression})`)
  try {
    return JSON.parse(raw)
  } catch (error) {
    return { parseError: String(raw) }
  }
}

const SET_SCROLL = (top) =>
  `(function(){var sc=document.querySelector(".settings-content");if(!sc)return {found:false};` +
  `sc.scrollTop=${top};return {found:true,scrollTop:sc.scrollTop,max:sc.scrollHeight-sc.clientHeight};})()`

const BAR_STATE =
  '({found:!!document.querySelector(".editor-sticky"),' +
  ' stuck:(function(){var b=document.querySelector(".editor-sticky");return !!b&&b.classList.contains("is-stuck")})(),' +
  ' cls:(function(){var b=document.querySelector(".editor-sticky");return b?b.className:""})(),' +
  ' radius:(function(){var b=document.querySelector(".editor-sticky");if(!b)return null;var s=getComputedStyle(b);' +
  ' return {tl:s.borderTopLeftRadius,tr:s.borderTopRightRadius,bl:s.borderBottomLeftRadius,br:s.borderBottomRightRadius}})(),' +
  ' border:(function(){var b=document.querySelector(".editor-sticky");if(!b)return null;var s=getComputedStyle(b);' +
  ' return {width:s.borderTopWidth,color:s.borderTopColor,style:s.borderTopStyle,left:s.borderLeftColor,right:s.borderRightColor,bottom:s.borderBottomColor}})(),' +
  ' barTop:(function(){var b=document.querySelector(".editor-sticky");return b?Math.round(b.getBoundingClientRect().top):null})(),' +
  ' barTopRaw:(function(){var b=document.querySelector(".editor-sticky");return b?b.getBoundingClientRect().top:null})(),' +
  ' anchorTop:(function(){var a=document.querySelector(".editor-anchor");return a?a.getBoundingClientRect().top:null})(),' +
  ' barHeight:(function(){var b=document.querySelector(".editor-sticky");return b?Math.round(b.getBoundingClientRect().height):null})(),' +
  ' scrollerTop:(function(){var sc=document.querySelector(".settings-content");return sc?Math.round(sc.getBoundingClientRect().top):null})(),' +
  ' scrollerPadTop:(function(){var sc=document.querySelector(".settings-content");return sc?getComputedStyle(sc).paddingTop:null})(),' +
  ' scrollTop:(function(){var sc=document.querySelector(".settings-content");return sc?Math.round(sc.scrollTop):null})(),' +
  ' scrollMax:(function(){var sc=document.querySelector(".settings-content");return sc?sc.scrollHeight-sc.clientHeight:null})(),' +
  ' saveVisible:(function(){var bs=[].slice.call(document.querySelectorAll(".editor-head button"));' +
  ' var save=bs.filter(function(x){return /保存|Save/.test(x.textContent||"")})[0];if(!save)return false;' +
  ' var r=save.getBoundingClientRect();return r.top>=0&&r.bottom<=window.innerHeight})(),' +
  ' anchorHeight:(function(){var a=document.querySelector(".editor-anchor");return a?Math.round(a.getBoundingClientRect().height):null})()})'

const barState = () => jsonIn(BAR_STATE)

/**
 * 等到吸顶状态变成期望值。
 *
 * 不写死 sleep：窗口在后台/被遮挡时，Chromium 会推迟一帧的渲染步骤，
 * scroll 事件可能要几百毫秒才派发（实测 250ms 偶尔不够、偶尔又很及时）。
 * 这里等的是「最终收敛到正确状态」，不是「多快」——「多快」由首次滚动的
 * 首帧断言单独盯。
 */
async function settle(expectedStuck, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const state = await barState()
    if (state.stuck === expectedStuck) return { ok: true, state }
    if (Date.now() >= deadline) return { ok: false, state }
    await wait(80)
  }
}

function isTransparent(color) {
  if (!color) return false
  const text = String(color).replace(/\s/g, '')
  if (text === 'transparent') return true
  const match = /^rgba?\(([\d.]+),([\d.]+),([\d.]+)(?:,([\d.]+))?\)$/.exec(text)
  if (!match) return false
  return match[4] === undefined ? false : Number(match[4]) === 0
}

async function capture(name, height) {
  try {
    const rect = await jsonIn(
      '(function(){var sc=document.querySelector(".settings-content");if(!sc)return null;' +
        `var r=sc.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(Math.max(0,r.top)),` +
        `width:Math.round(r.width),height:Math.round(Math.min(${height},r.height))};})()`
    )
    if (!rect) return
    const image = await win.webContents.capturePage(rect)
    fs.writeFileSync(path.join(outDir, `sticky-${name}.png`), image.toPNG())
    write(`capture ${name} -> .verify/sticky-${name}.png ${rect.width}x${rect.height}`)
  } catch (error) {
    write('capture ' + name + ' failed: ' + error)
  }
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1200,
    height: 760,
    show: true,
    backgroundColor: '#1b1d22',
    webPreferences: {
      preload: path.join(__dirname, 'probe-preload.cjs'),
      additionalArguments: ['--cd-config=' + JSON.stringify(config)],
      contextIsolation: true,
      sandbox: false,
      // 被遮挡的窗口默认会冻结渲染，scroll 事件也不派发
      backgroundThrottling: false
    }
  })
  win.setMenuBarVisibility(false)
  win.setAlwaysOnTop(true, 'screen-saver')
  await win.loadFile(path.join(appRoot, 'out/renderer/settings.html'))
  await wait(1800)

  const booted = await jsonIn(
    '({rows:document.querySelectorAll(".cd-row__main").length,hidden:document.hidden,vis:document.visibilityState})'
  )
  const rafTicks = await evalIn(
    `new Promise(function(resolve){var n=0;var t=performance.now();` +
      `var tick=function(){n++;if(performance.now()-t<500)requestAnimationFrame(tick);else resolve(n)};` +
      `requestAnimationFrame(tick);})`
  )
  write('boot = ' + JSON.stringify(booted) + ' rafTicks/500ms=' + rafTicks)
  check('list-rendered', booted.rows === 12, JSON.stringify(booted))
  check('window-rendering', Number(rafTicks) > 5, 'rafTicks=' + rafTicks)

  await jsonIn('document.querySelectorAll(".cd-row__main")[0].click()')
  await wait(900)

  // ---------------------------------------------------------------- 1) 未吸顶
  await jsonIn(SET_SCROLL(0))
  const { state: top } = await settle(false)
  write('state@0 = ' + JSON.stringify(top))
  check('editor-opened', top.found === true, JSON.stringify(top.found))
  check('anchor-is-zero-height', top.anchorHeight === 0, JSON.stringify(top.anchorHeight))
  check('top-not-stuck', top.stuck === false, JSON.stringify(top.cls))
  check(
    'top-sits-below-padding',
    top.barTop === top.scrollerTop + 18,
    `barTop=${top.barTop} scrollerTop=${top.scrollerTop} pad=${top.scrollerPadTop}`
  )
  check(
    'top-has-round-corners',
    top.radius && top.radius.tl === '12px' && top.radius.tr === '12px',
    JSON.stringify(top.radius)
  )
  check(
    'top-has-border',
    top.border && top.border.width === '1px' && !isTransparent(top.border.color),
    JSON.stringify(top.border)
  )
  await capture('top', 130)

  // ------------------------------------------- 2) 只滚 10px：还不该算吸顶
  await jsonIn(SET_SCROLL(10))
  const { state: slight } = await settle(false)
  write('state@10 = ' + JSON.stringify(slight))
  check('slight-scroll-not-stuck', slight.stuck === false, JSON.stringify(slight.cls))
  check(
    'slight-scroll-keeps-corners',
    slight.radius && slight.radius.tl === '12px' && !isTransparent(slight.border.color),
    JSON.stringify({ radius: slight.radius, border: slight.border })
  )

  // ------------------------------------------------------------------ 3) 吸顶
  await jsonIn(SET_SCROLL(80))
  const { state: stuck } = await settle(true)
  write('state@80 = ' + JSON.stringify(stuck))
  check('scrolled-is-stuck', stuck.stuck === true, JSON.stringify(stuck.cls))
  check(
    'stuck-top-corners-square',
    stuck.radius && stuck.radius.tl === '0px' && stuck.radius.tr === '0px',
    JSON.stringify(stuck.radius)
  )
  check(
    'stuck-bottom-corners-kept',
    stuck.radius && stuck.radius.bl === '12px' && stuck.radius.br === '12px',
    JSON.stringify(stuck.radius)
  )
  check(
    'stuck-top-border-gone',
    stuck.border && isTransparent(stuck.border.color),
    JSON.stringify(stuck.border)
  )
  check(
    'stuck-side-borders-kept',
    stuck.border &&
      !isTransparent(stuck.border.left) &&
      !isTransparent(stuck.border.right) &&
      !isTransparent(stuck.border.bottom),
    JSON.stringify(stuck.border)
  )
  check(
    'stuck-border-box-unchanged',
    stuck.barHeight === top.barHeight,
    `${top.barHeight} -> ${stuck.barHeight}`
  )
  check(
    'stuck-flush-to-viewport-top',
    Math.abs(stuck.barTop - stuck.scrollerTop) <= 1,
    `barTop=${stuck.barTop} scrollerTop=${stuck.scrollerTop}`
  )
  check('stuck-save-button-visible', stuck.saveVisible === true, JSON.stringify(stuck.saveVisible))
  await capture('stuck', 130)

  // ------------------------------------------ 4) 一次滚到底：首帧就是吸顶态
  await jsonIn(SET_SCROLL(0))
  await settle(false)
  const firstFrame = await evalIn(
    `new Promise(function(resolve){var sc=document.querySelector(".settings-content");` +
      `sc.scrollTop=200;` +
      `requestAnimationFrame(function(){var b=document.querySelector(".editor-sticky");` +
      `var st=getComputedStyle(b);resolve({stuck:b.classList.contains("is-stuck"),` +
      `tl:st.borderTopLeftRadius,color:st.borderTopColor,scrollTop:sc.scrollTop});});})`
  )
  write('first-frame@200 = ' + JSON.stringify(firstFrame))
  check('stuck-applied-on-first-frame', firstFrame.stuck === true, JSON.stringify(firstFrame))
  check('square-on-first-frame', firstFrame.tl === '0px', JSON.stringify(firstFrame.tl))
  check('border-gone-on-first-frame', isTransparent(firstFrame.color), JSON.stringify(firstFrame.color))

  // ------------------------------------------------------ 4b) 滚到底 + 连续抖动
  const toBottom = await jsonIn(SET_SCROLL(999999))
  const { state: bottom } = await settle(true)
  write('state@bottom = ' + JSON.stringify({ toBottom, bottom }))
  check(
    'bottom-is-stuck',
    bottom.stuck === true && Math.abs(bottom.barTop - bottom.scrollerTop) <= 1,
    `barTop=${bottom.barTop} scrollerTop=${bottom.scrollerTop}`
  )

  const thrash = await jsonIn(
    `(function(){var sc=document.querySelector(".settings-content");var seq=[0,120,5,60,0,300,20,0];` +
      `seq.forEach(function(v){sc.scrollTop=v;});` +
      `sc.scrollTop=60;return {scrollTop:sc.scrollTop};})()`
  )
  const { state: afterThrash } = await settle(true)
  write('after thrash = ' + JSON.stringify({ thrash, afterThrash }))
  check('thrash-ends-stuck', afterThrash.stuck === true, JSON.stringify(afterThrash.cls))

  // ------------------------------------------------------------ 5) 回到顶部
  await jsonIn(SET_SCROLL(0))
  const { state: back } = await settle(false)
  write('state@0-again = ' + JSON.stringify(back))
  check('back-to-top-unstuck', back.stuck === false, JSON.stringify(back.cls))
  check(
    'back-to-top-corners-restored',
    back.radius && back.radius.tl === '12px' && back.radius.tr === '12px',
    JSON.stringify(back.radius)
  )
  check(
    'back-to-top-border-restored',
    back.border && back.border.width === '1px' && !isTransparent(back.border.color),
    JSON.stringify(back.border)
  )
  await capture('top-again', 130)

  // ----------------------------------------- 6) 保存按钮不再跳回列表（吸顶态下点）
  await jsonIn(SET_SCROLL(80))
  await settle(true)
  await evalIn(
    `(function(){var el=document.querySelector('.panel-card input.el-input__inner[maxlength="30"]');` +
      `if(!el)return "no-input";` +
      `var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;` +
      `setter.call(el,'保存后仍留在编辑页');` +
      `el.dispatchEvent(new Event("input",{bubbles:true}));return "ok";})()`
  )
  await wait(250)
  const dirtyTag = await jsonIn(
    `[].slice.call(document.querySelectorAll(".editor-head .el-tag")).map(function(x){return x.textContent.trim()})`
  )
  write('tags before save = ' + JSON.stringify(dirtyTag))

  const clicked = await jsonIn(
    `(function(){var bs=[].slice.call(document.querySelectorAll(".editor-head button"));` +
      `var b=bs.filter(function(x){return /保存|Save/.test(x.textContent||"")})[0];` +
      `if(!b)return {found:false,all:bs.map(function(x){return (x.textContent||"").trim()})};` +
      `b.click();return {found:true,text:(b.textContent||"").trim()};})()`
  )
  await wait(700)
  const afterSave = await jsonIn(
    `({editor:!!document.querySelector(".editor-head"),rows:document.querySelectorAll(".cd-row").length,` +
      `stuck:(function(){var b=document.querySelector(".editor-sticky");return !!b&&b.classList.contains("is-stuck")})(),` +
      `tags:[].slice.call(document.querySelectorAll(".editor-head .el-tag")).map(function(x){return x.textContent.trim()}),` +
      `savedName:(function(){var el=document.querySelector('.panel-card input.el-input__inner[maxlength="30"]');return el?el.value:""})()})`
  )
  const savedConfig = await evalIn(
    'window.cd.getConfig().then(function(c){return c.countdowns[0].name})'
  )
  write(
    'after save = ' +
      JSON.stringify({ clicked, afterSave, savedConfig, dirtyTag })
  )
  check('save-clicked', clicked.found === true, JSON.stringify(clicked))
  check('save-keeps-editor-open', afterSave.editor === true, JSON.stringify(afterSave))
  check('save-does-not-render-list', afterSave.rows === 0, JSON.stringify(afterSave.rows))
  check('save-writes-item', savedConfig === '保存后仍留在编辑页', JSON.stringify(savedConfig))
  check('save-keeps-stuck-state', afterSave.stuck === true, JSON.stringify(afterSave.stuck))
  check(
    'save-shows-saved-tag',
    (afterSave.tags || []).some((tag) => /已保存|Saved/.test(tag)),
    JSON.stringify(afterSave.tags)
  )

  await wait(1200)
  const clickedAgain = await jsonIn(
    `(function(){var bs=[].slice.call(document.querySelectorAll(".editor-head button"));` +
      `var b=bs.filter(function(x){return /保存|Save/.test(x.textContent||"")})[0];` +
      `if(!b)return {found:false};b.click();return {found:true};})()`
  )
  await wait(500)
  const stillEditor = await evalIn('!!document.querySelector(".editor-head")')
  write('save again = ' + JSON.stringify({ clickedAgain, stillEditor }))
  check('save-again-keeps-editor', stillEditor === true, String(stillEditor))

  // ------------------------- 7) 列表滚到中途再进编辑页：一进来就是吸顶态
  // 滚动容器是同一个 .settings-content，从列表切到编辑页不会重置 scrollTop，
  // 所以这条路径必须一挂载就判断正确，不能等用户再滚一下才纠正。
  await jsonIn(
    `(function(){var bs=[].slice.call(document.querySelectorAll(".editor-head button"));` +
      `var b=bs.filter(function(x){return /返回列表|Back/.test(x.textContent||"")})[0];` +
      `if(b)b.click();return {found:!!b};})()`
  )
  await wait(600)
  await jsonIn(SET_SCROLL(300))
  await wait(250)
  const listScrolled = await jsonIn(
    `({scrollTop:document.querySelector(".settings-content").scrollTop,rows:document.querySelectorAll(".cd-row__main").length})`
  )
  await jsonIn('document.querySelectorAll(".cd-row__main")[0].click()')
  await wait(500)
  const { state: freshOpen } = await settle(true)
  write('fresh open while scrolled = ' + JSON.stringify({ listScrolled, freshOpen }))
  check(
    'fresh-open-while-scrolled-is-stuck',
    freshOpen.stuck === true &&
      freshOpen.radius &&
      freshOpen.radius.tl === '0px' &&
      isTransparent(freshOpen.border.color),
    JSON.stringify({ stuck: freshOpen.stuck, radius: freshOpen.radius, border: freshOpen.border })
  )
  check(
    'fresh-open-flush-to-top',
    Math.abs(freshOpen.barTop - freshOpen.scrollerTop) <= 1,
    `barTop=${freshOpen.barTop} scrollerTop=${freshOpen.scrollerTop}`
  )

  // ------------------- 8) 新建项「保存后返回列表」不能被当成空白项删掉
  // 这是「保存不再顺手返回」带来的新路径：新建 -> 保存 -> 返回，
  // 列表那边把「没保存就离开的新建项」当空白项删掉，所以必须告诉它「已经存过了」。
  await jsonIn(
    `(function(){var bs=[].slice.call(document.querySelectorAll(".editor-head button"));` +
      `var b=bs.filter(function(x){return /返回列表|Back/.test(x.textContent||"")})[0];` +
      `if(b)b.click();return {found:!!b};})()`
  )
  await wait(700)
  const beforeNew = await evalIn('window.cd.getConfig().then(function(c){return c.countdowns.length})')
  await jsonIn(
    `(function(){var bs=[].slice.call(document.querySelectorAll("button"));` +
      `var b=bs.filter(function(x){return /新建倒数日|New countdown/.test(x.textContent||"")})[0];` +
      `if(!b)return {found:false};b.click();return {found:true};})()`
  )
  await wait(700)
  await evalIn(
    `(function(){var el=document.querySelector('.panel-card input.el-input__inner[maxlength="30"]');` +
      `if(!el)return "no-input";` +
      `var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;` +
      `setter.call(el,'新建后立刻保存');` +
      `el.dispatchEvent(new Event("input",{bubbles:true}));return "ok";})()`
  )
  await wait(200)
  await jsonIn(
    `(function(){var bs=[].slice.call(document.querySelectorAll(".editor-head button"));` +
      `var b=bs.filter(function(x){return /保存|Save/.test(x.textContent||"")})[0];` +
      `if(!b)return {found:false};b.click();return {found:true};})()`
  )
  await wait(500)
  const afterSaveEditor = await evalIn('!!document.querySelector(".editor-head")')
  await jsonIn(
    `(function(){var bs=[].slice.call(document.querySelectorAll(".editor-head button"));` +
      `var b=bs.filter(function(x){return /返回列表|Back/.test(x.textContent||"")})[0];` +
      `if(b)b.click();return {found:!!b};})()`
  )
  await wait(700)
  const afterNew = await evalIn('window.cd.getConfig().then(function(c){return c.countdowns.length})')
  const newNames = await evalIn(
    'window.cd.getConfig().then(function(c){return c.countdowns.map(function(i){return i.name})})'
  )
  write(
    'new item flow = ' +
      JSON.stringify({ beforeNew, afterSaveEditor, afterNew, newNames })
  )
  check('new-item-save-keeps-editor', afterSaveEditor === true, String(afterSaveEditor))
  check(
    'new-item-saved-not-dropped-on-back',
    afterNew === beforeNew + 1 && (newNames || []).includes('新建后立刻保存'),
    `count ${beforeNew} -> ${afterNew}, names=${JSON.stringify(newNames)}`
  )

  // ------------------------------------------------ 9) 浅色主题下再看一眼（截图）
  await evalIn(
    `window.cd.updateConfig({runtime:{theme:'light'}}).then(function(){return 'ok'})`
  )
  await wait(400)
  const lightTheme = await evalIn(
    `({dark:document.documentElement.classList.contains('dark'),` +
      `body:getComputedStyle(document.body).backgroundColor,` +
      `rows:document.querySelectorAll(".cd-row__main").length})`
  )
  write('light theme = ' + JSON.stringify(lightTheme))
  check('light-theme-applied', lightTheme.dark === false, JSON.stringify(lightTheme))
  await jsonIn('document.querySelectorAll(".cd-row__main")[0].click()')
  await wait(1200)
  const lightEditor = await jsonIn(
    '({editor:!!document.querySelector(".editor-head"),rows:document.querySelectorAll(".cd-row__main").length})'
  )
  write('light editor = ' + JSON.stringify(lightEditor))
  check('light-editor-opened', lightEditor.editor === true, JSON.stringify(lightEditor))
  await jsonIn(SET_SCROLL(80))
  const { state: lightStuck } = await settle(true)
  write('light stuck = ' + JSON.stringify({ radius: lightStuck.radius, border: lightStuck.border }))
  check(
    'light-theme-stuck-square',
    lightStuck.stuck === true &&
      lightStuck.radius &&
      lightStuck.radius.tl === '0px' &&
      isTransparent(lightStuck.border.color),
    JSON.stringify({ stuck: lightStuck.stuck, radius: lightStuck.radius, border: lightStuck.border })
  )
  await capture('stuck-light', 130)
  await jsonIn(SET_SCROLL(0))
  const { state: lightTop } = await settle(false)
  check(
    'light-theme-top-restored',
    lightTop.stuck === false &&
      lightTop.radius &&
      lightTop.radius.tl === '12px' &&
      !isTransparent(lightTop.border.color),
    JSON.stringify({ stuck: lightTop.stuck, radius: lightTop.radius, border: lightTop.border })
  )
  await capture('top-light', 130)

  write(`SUMMARY failures=${failures}`)
  write('done')
  app.exit(failures === 0 ? 0 : 2)
})
