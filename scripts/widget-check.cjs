// 桌面组件的视觉状态检查：正常 / 精确模式 / 空态 / 长文本 / 大写字体
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
fs.mkdirSync(outDir, { recursive: true })
const logFile = path.join(outDir, 'widget-check.log')
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
require(path.join(appRoot, 'out/main/index.js'))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function widget() {
  return BrowserWindow.getAllWindows().find((win) => win.getTitle() === '倒数日') || null
}

async function ev(win, expression) {
  try {
    return await win.webContents.executeJavaScript(expression)
  } catch (error) {
    return 'EVAL_FAIL ' + error
  }
}

const MEASURE = `JSON.stringify((function(){
  var s = document.querySelector('.cd-stage');
  var c = document.querySelector('.cd-card');
  if (!s || !c) return { error: 'no stage/card' };
  var sr = s.getBoundingClientRect(), cr = c.getBoundingClientRect();
  var cs = getComputedStyle(c);
  var parts = ['.cd-card__title','.cd-card__count','.cd-card__precise','.cd-card__hint','.cd-card__status'].map(function(sel){
    var el = document.querySelector(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    var st = getComputedStyle(el);
    return {
      sel: sel,
      text: (el.textContent || '').trim().slice(0, 24),
      w: Math.round(r.width),
      h: Math.round(r.height),
      size: st.fontSize,
      clipsX: el.scrollWidth - el.clientWidth,
      clipsY: el.scrollHeight - el.clientHeight
    };
  }).filter(Boolean);
  var unit = document.querySelector('.cd-card__unit');
  var unitSize = unit ? getComputedStyle(unit).fontSize : null;
  var numberSize = document.querySelector('.cd-card__number') ? getComputedStyle(document.querySelector('.cd-card__number')).fontSize : null;
  return {
    card: { w: Math.round(cr.width), h: Math.round(cr.height), radius: cs.borderRadius, bg: cs.backgroundColor },
    insets: {
      left: Math.round(cr.left),
      top: Math.round(cr.top),
      right: Math.round(sr.width - cr.right),
      bottom: Math.round(sr.height - cr.bottom)
    },
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    shrink: (function () {
      var host = document.querySelector('.cd-shrink');
      if (!host) return null;
      return {
        zoom: getComputedStyle(host).zoom,
        hostClient: host.clientWidth,
        hostScroll: host.scrollWidth,
        cardOffset: document.querySelector('.cd-card').offsetWidth,
        cardScroll: document.querySelector('.cd-card').scrollWidth,
        preciseScroll: (document.querySelector('.cd-card__precise') || {}).scrollWidth || null,
        stageClient: s.clientWidth
      };
    })(),
    buttons: document.querySelectorAll('.cd-stage button').length,
    parts: parts,
    unitSize: unitSize,
    numberSize: numberSize
  };
})())`

app.whenReady().then(async () => {
  await wait(4000)
  const win = widget()

  write('1 default -> ' + (await ev(win, MEASURE)))

  // 长标题 + 长副标题
  await ev(
    win,
    'window.cd.updateConfig({countdowns:[{id:"t1",name:"一个特别特别长的倒数日标题测试",enabled:true,target:{mode:"annual",date:"2027-01-01T00:00",month:1,day:1},text:{hint:"这是一行很长的副标题，用来测试溢出与省略号的表现",futureText:"还有 {days} 天",todayText:"就在今天！",pastText:"已远去",unit:"天"},appearance:{}}],activeId:"t1"}).then(function(){return "ok"})'
  )
  await wait(1500)
  write('2 long text -> ' + (await ev(win, MEASURE)))

  // 精确模式
  await ev(win, 'window.cd.updateConfig({behavior:{displayMode:"precise"}}).then(function(){return "ok"})')
  await wait(1200)
  write('3 precise -> ' + (await ev(win, MEASURE)))

  // 超大字号 + 精确模式
  await ev(
    win,
    'window.cd.updateConfig({appearance:{count:{fontSize:110,color:"#ffffff",weight:800,letterSpacing:0}}}).then(function(){return "ok"})'
  )
  await wait(1200)
  write('4 big font precise -> ' + (await ev(win, MEASURE)))

  // 回到天数模式 + 默认字号，测试空态
  await ev(
    win,
    'window.cd.updateConfig({behavior:{displayMode:"days"},appearance:{count:{fontSize:64,color:"#ffffff",weight:700,letterSpacing:-1}},countdowns:[],activeId:""}).then(function(){return "ok"})'
  )
  await wait(1400)
  write('5 empty -> ' + (await ev(win, MEASURE)))

  // 单项外观覆盖：极端圆角 + 全透明背景
  await ev(
    win,
    'window.cd.updateConfig({countdowns:[{id:"t2",name:"透明卡片",enabled:true,target:null,text:{hint:"",futureText:"",todayText:"",pastText:"",unit:""},appearance:{background:{color:"#000000",alpha:0.05,radius:0,shadow:0,borderWidth:0}}}],activeId:"t2"}).then(function(){return "ok"})'
  )
  await wait(1400)
  write('6 transparent override -> ' + (await ev(win, MEASURE)))

  write('done')
  app.exit(0)
})
