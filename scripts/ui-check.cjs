// 设置界面本轮改动验证（DOM 级，直接跑真实 out/renderer 产物）：
//   1) 导航：日期与文案 归到「外观与风格」组
//   2) 日期页标题为「默认日期」、卡片头不再挂「跟随全局」标签
//   3) 外观页：高级参数只有一个入口，默认收起；打开后出现边框/字重/字距
//   4) 背景透明度是「背景颜色」的同级行，不再藏在取色器里
//   5) 实时预览按容器尺寸等比缩放，超大字号/超宽卡片也不越界
//   6) 副标题变量 {month}/{day}/{week} 真的被替换
//   7) 滑动条抓手不被任何 overflow:hidden 祖先裁到
//   8) 列表行不再显示「此项已覆盖外观」
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
fs.mkdirSync(outDir, { recursive: true })

/*
 * 每次用一份干净的 userData：高级参数的展开状态存在 localStorage 里，
 * 复用同一份 profile 会让「默认收起」这条断言在上一次运行之后直接失真。
 */
const userData = path.join(appRoot, '.probe-userdata', `ui-${Date.now().toString(36)}`)
fs.mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('in-process-gpu')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

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

const logFile = path.join(outDir, 'ui.log')
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

const ITEM_A = createCountdownItem({
  id: 'probe_item_a',
  name: '带外观覆盖的项',
  enabled: true,
  target: { mode: 'once', date: '2030-12-31T00:00', month: 12, day: 31 },
  appearance: { textAlpha: 0.8 }
})
const ITEM_B = createCountdownItem({ id: 'probe_item_b', name: '普通项', enabled: true })

const config = createDefaultConfig()
config.countdowns = [ITEM_A, ITEM_B]
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

const CLICK_NAV = (label) =>
  `(function(){var bs=[].slice.call(document.querySelectorAll(".settings-nav__item"));` +
  `var b=bs.filter(function(x){return (x.textContent||"").indexOf(${JSON.stringify(label)})>=0})[0];` +
  `if(!b)return {found:false,all:bs.map(function(x){return (x.textContent||"").trim()})};` +
  `b.click();return {found:true};})()`

const TYPE_INTO = (selector, text) =>
  `(function(){var el=document.querySelector(${JSON.stringify(selector)});` +
  `if(!el)return {found:false};` +
  `var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;` +
  `setter.call(el,${JSON.stringify(text)});` +
  `el.dispatchEvent(new Event("input",{bubbles:true}));` +
  `return {found:true,value:el.value};})()`

/** 找一行 FieldRow：按标签文字 */
const ROW_LABELS = `[].slice.call(document.querySelectorAll(".field-row")).map(function(r){` +
  `var t=r.querySelector(".field-row__text");return t?(t.textContent||"").trim():""})`

/** 文字样式编辑器里真正渲染出来的标签（不能被高级参数的说明文字骗到） */
const STYLE_LABELS = `[].slice.call(document.querySelectorAll(".text-style-editor .row__label"))` +
  `.map(function(x){return (x.textContent||"").trim()})`

/** 检查某个元素是否被任意 overflow 祖先裁到 */
const CLIP_CHECK = `(function(){
  var btn=document.querySelector(".slider-field .el-slider__button");
  if(!btn)return {found:false};
  var r=btn.getBoundingClientRect();
  var issues=[];
  var el=btn.parentElement;
  while(el&&el!==document.body){
    var cs=getComputedStyle(el);
    if(cs.overflowX!=="visible"||cs.overflowY!=="visible"){
      var er=el.getBoundingClientRect();
      var bl=parseFloat(cs.borderLeftWidth)||0, bt=parseFloat(cs.borderTopWidth)||0;
      var br=parseFloat(cs.borderRightWidth)||0, bb=parseFloat(cs.borderBottomWidth)||0;
      var inner={left:er.left+bl,top:er.top+bt,right:er.right-br,bottom:er.bottom-bb};
      if(r.left<inner.left-0.5||r.top<inner.top-0.5||r.right>inner.right+0.5||r.bottom>inner.bottom+0.5){
        issues.push({cls:el.className,overflow:cs.overflow,
          btn:{l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom)},
          box:{l:Math.round(inner.left),t:Math.round(inner.top),r:Math.round(inner.right),b:Math.round(inner.bottom)}});
      }
    }
    el=el.parentElement;
  }
  return {found:true,issues:issues,button:{w:Math.round(r.width),h:Math.round(r.height)}};
})()`

/** 预览内容（含 transform）实际占的盒子 */
const PREVIEW_BOX = `(function(){
  var wrap=document.querySelector(".preview");
  var content=document.querySelector(".preview__content");
  if(!wrap||!content)return {found:false};
  var wr=wrap.getBoundingClientRect();
  var cr=content.getBoundingClientRect();
  var cs=getComputedStyle(wrap);
  var inner={left:wr.left+parseFloat(cs.paddingLeft),right:wr.right-parseFloat(cs.paddingRight)};
  return {found:true,
    scale:getComputedStyle(content).transform,
    wrapW:Math.round(wr.width),wrapH:Math.round(wr.height),
    contentW:Math.round(cr.width),contentH:Math.round(cr.height),
    overflowLeft:Math.round(inner.left-cr.left),overflowRight:Math.round(cr.right-inner.right),
    overflowBottom:Math.round(cr.bottom-(wr.bottom-parseFloat(cs.paddingBottom)))};
})()`

async function shoot(name) {
  try {
    // 被遮挡/后台的窗口可能拿到上一帧的合成结果，先强制整页重绘再截
    win.webContents.invalidate()
    await wait(350)
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(outDir, `ui-${name}.png`), image.toPNG())
    write(`capture ui-${name}.png ${image.getSize().width}x${image.getSize().height}`)
  } catch (error) {
    write('capture ' + name + ' failed: ' + error)
  }
}

/**
 * 等页面真的切过去再断言。
 * 固定 sleep 在冷启动那一次会不够（组件首次渲染比后面慢），
 * 之前就撞出过一次「点完 800ms 还停在上一页」的假失败。
 */
async function pageTag(tag, expected) {
  const deadline = Date.now() + 4000
  let info = null
  for (;;) {
    info = await jsonIn(
      `({top:(document.querySelector(".settings-topbar__title")||{}).textContent||"",` +
        `active:(document.querySelector(".settings-nav__item.is-active")||{}).textContent||"",` +
        `cards:document.querySelectorAll(".panel-card").length})`
    )
    if (!expected || String(info.top).trim() === expected) break
    if (Date.now() >= deadline) break
    await wait(120)
  }
  write('page[' + tag + '] = ' + JSON.stringify(info))
  return info
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
      backgroundThrottling: false
    }
  })
  win.setMenuBarVisibility(false)
  win.setAlwaysOnTop(true, 'screen-saver')
  await win.loadFile(path.join(appRoot, 'out/renderer/settings.html'))
  await wait(1600)

  // ---------------------------------------------------------------- 1) 导航分组
  const nav = await jsonIn(
    `(function(){var out=[];` +
      `[].slice.call(document.querySelectorAll(".settings-nav__section")).forEach(function(s){` +
      `var head=s.querySelector(".settings-nav__head-label");` +
      `var items=[].slice.call(s.querySelectorAll(".settings-nav__item")).map(function(i){return (i.textContent||"").trim()});` +
      `out.push({group:head?(head.textContent||"").trim():"",items:items});});return out;})()`
  )
  write('nav = ' + JSON.stringify(nav))
  const lookGroup = (nav || []).find((g) => /外观/.test(g.group) && g.items.includes('日期与文案'))
  check('nav-target-inside-look-group', Boolean(lookGroup), JSON.stringify(nav))
  const countdownGroup = (nav || []).find((g) => g.items.includes('倒数日列表'))
  check(
    'nav-countdown-group-only-list',
    Boolean(countdownGroup) && countdownGroup.items.length === 1,
    JSON.stringify(countdownGroup)
  )

  // ------------------------------------------------- 1b) 侧栏左下角 / 关于入口
  const footer = await jsonIn(
    `(function(){var f=document.querySelector(".settings-side__footer");if(!f)return {found:false};` +
      `return {found:true,text:(f.innerText||"").trim(),` +
      `buttons:[].slice.call(f.querySelectorAll("button")).map(function(b){return (b.textContent||"").trim()}),` +
      `aboutEntry:!!f.querySelector(".settings-side__about")};})()`
  )
  write('footer = ' + JSON.stringify(footer))
  check(
    'footer-has-no-close',
    footer.found === true && !(footer.buttons || []).some((text) => /关闭|Close/.test(text)),
    JSON.stringify(footer.buttons)
  )
  check(
    'footer-only-about',
    (footer.buttons || []).length === 1 && /关于|About/.test(footer.buttons[0]),
    JSON.stringify(footer.buttons)
  )
  check('footer-hosts-about', footer.aboutEntry === true, JSON.stringify(footer.aboutEntry))
  check(
    'about-not-in-nav-groups',
    !(nav || []).some((group) => (group.items || []).includes('关于')),
    JSON.stringify(nav)
  )

  // 点左下角「关于」：切页 + 顶栏标题跟着变
  await jsonIn('document.querySelector(".settings-side__about").click()')
  await wait(800)
  const aboutPage = await jsonIn(
    `({title:(document.querySelector(".settings-topbar__title")||{}).textContent||"",` +
      `hasQuit:[].slice.call(document.querySelectorAll("button")).some(function(b){` +
      `return /彻底退出|Quit completely/.test(b.textContent||"")}),` +
      `hasReset:[].slice.call(document.querySelectorAll("button")).some(function(b){` +
      `return /恢复默认设置|Restore defaults/.test(b.textContent||"")}),` +
      `hasVersion:!!~document.body.innerText.indexOf("版本")})`
  )
  write('about page = ' + JSON.stringify(aboutPage))
  check('about-entry-switches-page', String(aboutPage.title).trim() === '关于', JSON.stringify(aboutPage.title))
  check('about-shows-version', aboutPage.hasVersion === true, 'version block')
  check('about-hosts-quit', aboutPage.hasQuit === true, 'quit button')
  check('about-hosts-reset', aboutPage.hasReset === true, 'reset button')

  // 点「恢复默认设置」应当先弹确认框；这里只验证弹窗出现并取消（真确认会把后续数据清掉）
  const resetClick = await jsonIn(
    `(function(){var bs=[].slice.call(document.querySelectorAll("button"));` +
      `var b=bs.filter(function(x){return /恢复默认设置|Restore defaults/.test(x.textContent||"")})[0];` +
      `if(!b)return {found:false};b.click();return {found:true};})()`
  )
  // 轮询等弹窗出现，不用固定 sleep（冷启动那一次 600ms 可能不够）
  let resetDialog = { box: false, text: '' }
  for (let i = 0; i < 25; i++) {
    resetDialog = await jsonIn(
      `({box:!!document.querySelector(".el-message-box"),` +
        `text:((document.querySelector(".el-message-box")||{}).innerText||"").slice(0,40)})`
    )
    if (resetDialog.box) break
    await wait(120)
  }
  let cancelClick = null
  if (resetDialog.box) {
    cancelClick = await jsonIn(
      `(function(){var box=document.querySelector(".el-message-box");if(!box)return {found:false};` +
        `var bs=[].slice.call(box.querySelectorAll("button"));` +
        `var c=bs.filter(function(x){return /取消|Cancel/.test(x.textContent||"")})[0];` +
        `if(c)c.click();return {found:true,clicked:!!c,` +
        `labels:bs.map(function(x){return (x.textContent||"").trim()})};})()`
    )
    await wait(800)
  }
  /*
   * 关闭后 Element Plus 只是把遮罩 display:none（容器留在 DOM 里），
   * 所以这里看的是「还看不看得见」，不是「节点在不在」。
   */
  /*
   * 关闭后 Element Plus 只把遮罩淡出（opacity → 0，节点和 display 都留着），
   * 所以判定「关没关」要看还看不看得见：display 非 none、opacity > 0、盒子还有高度。
   */
  const afterCancel = await jsonIn(
    `(function(){var b=document.querySelector(".el-message-box");if(!b)return {box:false,visible:false};` +
      `var overlay=b.closest(".el-overlay");var cs=overlay?getComputedStyle(overlay):null;` +
      `return {box:true,display:cs?cs.display:null,opacity:cs?Number(cs.opacity):null,` +
      `h:Math.round(b.getBoundingClientRect().height),` +
      `visible:!!cs&&cs.display!=="none"&&Number(cs.opacity)>0.05` +
      `&&b.getBoundingClientRect().height>0};})()`
  )
  const itemsAfterCancel = await evalIn(
    'window.cd.getConfig().then(function(c){return c.countdowns.length})'
  )
  write(
    'reset dialog = ' +
      JSON.stringify({ resetClick, resetDialog, cancelClick, afterCancel, itemsAfterCancel })
  )
  check('reset-opens-confirm', resetClick.found === true && resetDialog.box === true, JSON.stringify(resetDialog))
  check('reset-cancel-closes', afterCancel.visible === false, JSON.stringify(afterCancel))
  check('reset-cancel-keeps-data', Number(itemsAfterCancel) === 2, String(itemsAfterCancel))

  // 系统页不再有退出入口
  await jsonIn(CLICK_NAV('系统'))
  await wait(800)
  await pageTag('system', '系统')
  const integrationPage = await jsonIn(
    `({quitButtons:[].slice.call(document.querySelectorAll("button")).filter(function(b){` +
      `return /退出程序|彻底退出|Quit app|Quit completely/.test(b.textContent||"")})` +
      `.map(function(b){return (b.textContent||"").trim()})})`
  )
  write('integration page = ' + JSON.stringify(integrationPage))
  check(
    'integration-has-no-quit',
    (integrationPage.quitButtons || []).length === 0,
    JSON.stringify(integrationPage.quitButtons)
  )

  // ------------------------------------------------------------ 2) 日期页文案
  await jsonIn(CLICK_NAV('日期与文案'))
  await wait(800)
  await pageTag('target', '日期与文案')
  const targetPage = await jsonIn(
    `({title:(document.querySelector(".panel-card__title")||{}).textContent||"",` +
      `tags:[].slice.call(document.querySelectorAll(".panel-card__header .el-tag")).map(function(x){return (x.textContent||"").trim()}),` +
      `body:(document.body.innerText||"")})`
  )
  check(
    'target-title-is-default-date',
    /默认日期/.test(targetPage.title) && !/全局日期设置/.test(targetPage.body),
    JSON.stringify(targetPage.title)
  )
  check(
    'no-follow-global-tag',
    (targetPage.tags || []).length === 0,
    JSON.stringify(targetPage.tags)
  )
  check(
    'future-label-rewritten',
    /未到期时/.test(targetPage.body) && !/未来（可用/.test(targetPage.body),
    'placeholder label'
  )
  check(
    'text-variable-chips-present',
    (await evalIn('document.querySelectorAll(".text-vars__chip").length')) > 0,
    'chips'
  )

  // ------------------------------------------------------- 6) 变量替换（副标题）
  const now = new Date()
  const sampleMonth = 1
  const sampleDay = 1
  let sampleYear = now.getFullYear()
  if (new Date(sampleYear, sampleMonth - 1, sampleDay) < new Date(sampleYear, now.getMonth(), now.getDate())) {
    sampleYear += 1
  }
  const sampleDate = new Date(sampleYear, sampleMonth - 1, sampleDay)
  const weekZh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const expectedHint = `${sampleMonth} 月 ${sampleDay} 日 · ${weekZh[sampleDate.getDay()]}`

  await jsonIn(TYPE_INTO('.panel-card input.el-input__inner[maxlength="60"]', '{month} 月 {day} 日 · {week}'))
  // 输入 → patch → 预览重算是一条异步链路，等结果而不是等固定时间
  let hintText = ''
  for (let i = 0; i < 25; i++) {
    hintText = await evalIn(
      '(document.querySelector(".preview-wrap .cd-card__hint")||{}).textContent||""'
    )
    if (String(hintText).trim() === expectedHint) break
    await wait(120)
  }
  write('hint = ' + JSON.stringify({ got: hintText, expected: expectedHint }))
  check('hint-variables-substituted', String(hintText).trim() === expectedHint, JSON.stringify(hintText))

  // 变量按钮：点一下能把 {week} 追加进输入框
  await jsonIn(
    `(function(){var bs=[].slice.call(document.querySelectorAll(".text-vars__chip"));` +
      `var b=bs.filter(function(x){return (x.textContent||"").trim()==="{week}"})[0];` +
      `if(!b)return {found:false};b.click();return {found:true};})()`
  )
  await wait(500)
  const chipValue = await evalIn(
    'document.querySelector(\'.panel-card input.el-input__inner[maxlength="60"]\').value'
  )
  write('hint after chip = ' + JSON.stringify(chipValue))
  check('chip-appends-variable', /\{week\}$/.test(String(chipValue)), JSON.stringify(chipValue))
  // 复原，避免影响后续断言
  await jsonIn(TYPE_INTO('.panel-card input.el-input__inner[maxlength="60"]', ''))

  // -------------------------------------------------- 3) 外观页：高级参数入口
  await jsonIn(CLICK_NAV('外观'))
  await wait(900)
  await pageTag('appearance', '外观')
  const appearanceInitial = await jsonIn(
    `({switches:document.querySelectorAll("[data-cd-advanced]").length,` +
      `hasBorder:!!~document.body.innerText.indexOf("边框宽度"),` +
      `styleLabels:${STYLE_LABELS},` +
      `rows:${ROW_LABELS}})`
  )
  write('appearance initial = ' + JSON.stringify(appearanceInitial))
  check('advanced-single-entry', appearanceInitial.switches === 1, String(appearanceInitial.switches))
  const initialStyleLabels = appearanceInitial.styleLabels || []
  check(
    'advanced-collapsed-by-default',
    appearanceInitial.hasBorder === false &&
      !initialStyleLabels.includes('字重') &&
      !initialStyleLabels.includes('字距'),
    JSON.stringify({ border: appearanceInitial.hasBorder, styleLabels: initialStyleLabels })
  )
  check(
    'bg-alpha-is-sibling-row',
    (appearanceInitial.rows || []).includes('背景颜色') &&
      (appearanceInitial.rows || []).includes('背景透明度'),
    JSON.stringify(appearanceInitial.rows)
  )
  // 相邻：两个标签在同一组、且下标相邻
  const rows = appearanceInitial.rows || []
  check(
    'bg-alpha-adjacent-to-color',
    rows.indexOf('背景透明度') === rows.indexOf('背景颜色') + 1,
    `color@${rows.indexOf('背景颜色')} alpha@${rows.indexOf('背景透明度')}`
  )

  // 7) 滑动条抓手不被裁
  const clip = await jsonIn(CLIP_CHECK)
  write('clip = ' + JSON.stringify(clip))
  check(
    'slider-handle-not-clipped',
    clip.found === true && (clip.issues || []).length === 0,
    JSON.stringify(clip.issues)
  )

  await jsonIn(
    `(function(){var s=document.querySelector("[data-cd-advanced]");if(!s)return {found:false};` +
      `s.click();return {found:true};})()`
  )
  await wait(700)
  const appearanceAdvanced = await jsonIn(
    `({hasBorder:!!~document.body.innerText.indexOf("边框宽度"),` +
      `styleLabels:${STYLE_LABELS},` +
      `hasPadding:${ROW_LABELS}.includes("内边距"),` +
      `clip:${CLIP_CHECK}})`
  )
  write('appearance advanced = ' + JSON.stringify(appearanceAdvanced))
  const activeNav = await evalIn(
    '(document.querySelector(".settings-nav__item.is-active")||{}).textContent||""'
  )
  const topTitle = await evalIn(
    '(document.querySelector(".settings-topbar__title")||{}).textContent||""'
  )
  check(
    'nav-highlight-matches-page',
    String(activeNav).trim() === '外观' && String(topTitle).trim() === '外观',
    JSON.stringify({ activeNav, topTitle })
  )
  const advancedStyleLabels = appearanceAdvanced.styleLabels || []
  check(
    'advanced-adds-border-weight-spacing',
    appearanceAdvanced.hasBorder &&
      advancedStyleLabels.includes('字重') &&
      advancedStyleLabels.includes('字距') &&
      appearanceAdvanced.hasPadding === true,
    JSON.stringify(appearanceAdvanced)
  )
  check(
    'advanced-slider-not-clipped',
    appearanceAdvanced.clip.found === true && (appearanceAdvanced.clip.issues || []).length === 0,
    JSON.stringify(appearanceAdvanced.clip.issues)
  )

  await shoot('appearance-advanced')

  // ------------------------------------------------------- 8) 列表不显示覆盖标记
  await jsonIn(CLICK_NAV('倒数日列表'))
  await wait(900)
  await pageTag('list', '倒数日列表')
  const listBody = await evalIn('document.body.innerText')
  check('list-hides-override-tag', !/此项已覆盖外观/.test(String(listBody)), 'list text')
  check(
    'list-still-renders-rows',
    (await evalIn('document.querySelectorAll(".cd-row").length')) === 2,
    'rows'
  )

  // ------------------------------------------------------------ 5) 预览自适应
  await jsonIn('document.querySelectorAll(".cd-row__main")[0].click()')
  await wait(900)
  const before = await jsonIn(PREVIEW_BOX)
  write('preview normal = ' + JSON.stringify(before))
  check(
    'preview-in-bounds-normal',
    before.found === true && before.overflowLeft <= 1 && before.overflowRight <= 1,
    JSON.stringify(before)
  )
  await shoot('editor-normal')

  await evalIn(
    `window.cd.updateConfig({appearance:{count:{fontSize:120},background:{width:680}}}).then(function(){return "ok"})`
  )
  await wait(900)
  const blown = await jsonIn(PREVIEW_BOX)
  write('preview blown up = ' + JSON.stringify(blown))
  await shoot('editor-preview')
  check(
    'preview-shrinks-when-too-wide',
    blown.found === true && blown.overflowLeft <= 1 && blown.overflowRight <= 1,
    JSON.stringify(blown)
  )
  check(
    'preview-actually-scaled',
    blown.found === true && blown.contentW < 680,
    JSON.stringify({ contentW: blown.contentW })
  )

  // -------------------------------------------- 9) 预设缩略图仍然居中且不溢出
  await jsonIn(CLICK_NAV('预设主题'))
  await wait(1100)
  await pageTag('preset', '预设主题')
  const thumb = await jsonIn(
    `(function(){var c=document.querySelector(".preset-canvas");` +
      `var p=c&&c.querySelector(".preview__content");if(!c||!p)return {found:false};` +
      `var cr=c.getBoundingClientRect(),pr=p.getBoundingClientRect();` +
      `return {found:true,canvas:{w:Math.round(cr.width),h:Math.round(cr.height)},` +
      `card:{w:Math.round(pr.width),h:Math.round(pr.height)},` +
      `leftGap:Math.round(pr.left-cr.left),rightGap:Math.round(cr.right-pr.right),` +
      `topGap:Math.round(pr.top-cr.top),bottomGap:Math.round(cr.bottom-pr.bottom)};})()`
  )
  write('preset thumb = ' + JSON.stringify(thumb))
  check(
    'preset-thumbnail-contains-card',
    thumb.found === true &&
      thumb.leftGap >= -1 &&
      thumb.rightGap >= -1 &&
      thumb.topGap >= -1 &&
      thumb.bottomGap >= -1,
    JSON.stringify(thumb)
  )
  check(
    'preset-thumbnail-horizontally-centered',
    thumb.found === true && Math.abs(thumb.leftGap - thumb.rightGap) <= 2,
    JSON.stringify(thumb)
  )

  write(`SUMMARY failures=${failures}`)
  write('done')
  app.exit(failures === 0 ? 0 : 2)
})
