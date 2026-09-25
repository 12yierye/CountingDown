// 视觉审查：逐页截图，并采集关键尺寸/溢出指标
const { app, BrowserWindow, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
const shots = path.join(outDir, 'shots')
fs.mkdirSync(shots, { recursive: true })
const logFile = path.join(outDir, 'visual.log')
fs.writeFileSync(logFile, 'start ' + new Date().toISOString() + '\n')

const write = (line) => {
  const text = typeof line === 'string' ? line : JSON.stringify(line)
  try {
    fs.appendFileSync(logFile, text + '\n')
  } catch (error) {
    /* ignore */
  }
  try {
    process.stdout.write(text + '\n')
  } catch (error) {
    /* ignore */
  }
}

process.on('uncaughtException', (error) => write('MAIN_UNCAUGHT ' + (error && error.stack)))
app.setPath('userData', path.join(appRoot, '.probe-userdata'))

const main = require(path.join(appRoot, 'out/main/index.js'))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function widget() {
  return BrowserWindow.getAllWindows().find((win) => win.getTitle() === '倒数日') || null
}

function settings() {
  return BrowserWindow.getAllWindows().find((win) => win.getTitle().includes('设置')) || null
}

// Electron 的 desktopCapturer 在本机返回 0 个源，改用 GDI 截图
function screenshot(name) {
  const target = path.join(shots, name + '.png')
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
    '$bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height)',
    '$g=[System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)',
    '$g.Dispose()',
    `$bmp.Save('${target}',[System.Drawing.Imaging.ImageFormat]::Png)`,
    '$bmp.Dispose()',
    'Write-Output ok'
  ].join('; ')
  const encoded = Buffer.from(ps, 'utf16le').toString('base64')
  try {
    require('node:child_process').execFileSync(
      'powershell',
      ['-NoProfile', '-EncodedCommand', encoded],
      { stdio: 'ignore' }
    )
    write('shot ' + name)
  } catch (error) {
    write('shot failed ' + name + ' :: ' + error)
  }
}

async function ev(win, expression) {
  try {
    return await win.webContents.executeJavaScript(expression)
  } catch (error) {
    return 'EVAL_FAIL ' + error
  }
}

const navTo = (label) =>
  `JSON.stringify((function(){var b=[].slice.call(document.querySelectorAll(".settings-nav__item")).filter(function(x){return (x.textContent||"").trim()===${JSON.stringify(
    label
  )}})[0]; if(!b) return {found:false, items:[].slice.call(document.querySelectorAll(".settings-nav__item")).map(function(x){return (x.textContent||"").trim()})}; b.click(); return {found:true};})())`

// 采集页面级视觉指标
const pageMetrics = `JSON.stringify((function(){
  var out = {};
  var content = document.querySelector('.settings-content');
  if (content) {
    out.contentScrollHeight = content.scrollHeight;
    out.contentClientHeight = content.clientHeight;
    out.horizontalOverflow = content.scrollWidth - content.clientWidth;
  }
  var overflows = [];
  [].slice.call(document.querySelectorAll('.settings-content *')).forEach(function(el){
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (el.scrollWidth - el.clientWidth > 2 && getComputedStyle(el).overflowX === 'visible') {
      overflows.push((el.className || el.tagName) + ' sw=' + el.scrollWidth + ' cw=' + el.clientWidth);
    }
  });
  out.overflowing = overflows.slice(0, 8);
  out.rows = document.querySelectorAll('.field-row').length;
  var labels = [].slice.call(document.querySelectorAll('.field-row__label'));
  out.zeroWidthControls = [].slice.call(document.querySelectorAll('.field-row__control')).filter(function(el){
    var r = el.getBoundingClientRect();
    return r.width < 40 || r.height < 10;
  }).length;
  out.emptyTexts = [].slice.call(document.querySelectorAll('.el-card__body, .panel-card')).filter(function(el){
    return (el.textContent || '').trim().length === 0;
  }).length;
  return out;
})())`

const cardMetrics = `JSON.stringify((function(){
  var c = document.querySelector('.cd-card');
  var s = document.querySelector('.cd-stage');
  if (!c || !s) return {card:false};
  var cr = c.getBoundingClientRect();
  var sr = s.getBoundingClientRect();
  var parts = ['.cd-card__title','.cd-card__number','.cd-card__hint','.cd-card__status'].map(function(sel){
    var el = document.querySelector(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    return {sel: sel, w: Math.round(r.width), h: Math.round(r.height), color: cs.color, overflow: el.scrollWidth - el.clientWidth};
  }).filter(Boolean);
  return {
    card: {left: Math.round(cr.left), top: Math.round(cr.top), right: Math.round(cr.right), bottom: Math.round(cr.bottom), w: Math.round(cr.width), h: Math.round(cr.height)},
    stage: {w: Math.round(sr.width), h: Math.round(sr.height)},
    insetRight: Math.round(sr.right - cr.right),
    insetTop: Math.round(cr.top - sr.top),
    scrollOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    parts: parts
  };
})())`

app.whenReady().then(async () => {
  await wait(4000)

  const win = widget()
  write('WIDGET_METRICS ' + (await ev(win, cardMetrics)))
  win.showInactive()
  await wait(600)
  await screenshot('01-widget')

  main.openSettingsWindow()
  await wait(4500)
  const s = settings()
  if (!s) {
    write('no settings window')
    app.exit(1)
    return
  }
  s.show()
  s.focus()
  s.setBounds({ x: 60, y: 40, width: 1120, height: 820 })
  await wait(1600)

  const pages = [
    ['倒数日列表', '02-list'],
    ['日期与文案', '03-target'],
    ['外观', '04-appearance'],
    ['布局', '05-layout'],
    ['行为', '06-behavior'],
    ['预设主题', '07-preset'],
    ['系统集成', '08-integration'],
    ['关于', '09-about']
  ]
  for (const [label, name] of pages) {
    write('nav ' + label + ' -> ' + (await ev(s, navTo(label))))
    await wait(1200)
    write('  metrics ' + (await ev(s, pageMetrics)))
    await screenshot(name)
  }

  // 编辑子页
  await ev(s, navTo('倒数日列表'))
  await wait(900)
  await ev(
    s,
    'JSON.stringify((function(){var b=[].slice.call(document.querySelectorAll(".cd-row__actions button"))[0]; if(b){b.click(); return "ok"} return "no-btn";})())'
  )
  await wait(1600)
  write('EDITOR_METRICS ' + (await ev(s, pageMetrics)))
  await screenshot('10-editor-top')
  await ev(
    s,
    'JSON.stringify((function(){var c=document.querySelector(".settings-content"); c.scrollTop = c.scrollHeight; return c.scrollTop;})())'
  )
  await wait(800)
  await screenshot('11-editor-bottom')

  // 精确模式 + 浅色主题的卡片
  await ev(
    win,
    'window.cd.updateConfig({behavior:{displayMode:"precise"}}).then(function(){return "ok"})'
  )
  await wait(1200)
  write('WIDGET_PRECISE ' + (await ev(win, cardMetrics)))
  win.showInactive()
  await wait(700)
  await screenshot('12-widget-precise')

  await ev(
    win,
    'window.cd.updateConfig({behavior:{displayMode:"days"}}).then(function(){return "ok"})'
  )
  await wait(800)

  write('done')
  app.exit(0)
})
