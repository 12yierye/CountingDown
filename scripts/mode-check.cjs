// 以指定配置启动（--config=<json 片段>），用于无人值守验证不同渲染模式
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
const userData = path.join(appRoot, '.probe-userdata')
fs.mkdirSync(outDir, { recursive: true })

const arg = process.argv.find((item) => item.startsWith('--tag='))
const tag = arg ? arg.split('=')[1] : 'run'
const logFile = path.join(outDir, `mode-${tag}.log`)
fs.writeFileSync(logFile, 'start ' + new Date().toISOString() + '\n')

const write = (line) => {
  const text = typeof line === 'string' ? line : JSON.stringify(line)
  try {
    fs.appendFileSync(logFile, text + '\n')
  } catch (error) {
    /* ignore */
  }
}

process.on('uncaughtException', (error) => write('MAIN_UNCAUGHT ' + (error && error.stack)))
app.setPath('userData', userData)
require(path.join(appRoot, 'out/main/index.js'))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function widget() {
  return BrowserWindow.getAllWindows().find((win) => win.getTitle() === '倒数日') || null
}

const STRUCTURE = `JSON.stringify((function(){
  function box(sel){
    var el = document.querySelector(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    var s = getComputedStyle(el);
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
             bg: s.backgroundColor, radius: s.borderRadius, borderWidth: s.borderWidth,
             shadow: s.boxShadow === 'none' ? 'none' : 'yes' };
  }
  function computed(sel, props){
    var el = document.querySelector(sel);
    if (!el) return null;
    var s = getComputedStyle(el);
    var out = {};
    props.forEach(function(p){ out[p] = s[p]; });
    return out;
  }
  const cardEl = document.querySelector('.cd-shrink .cd-card') || document.querySelector('.cd-card')
  return {
    stageClass: document.querySelector('.cd-stage').className,
    opaqueMatches: document.querySelector('.cd-stage').matches('.cd-stage.is-opaque'),
    cardClass: cardEl ? cardEl.className : null,
    cardParent: cardEl && cardEl.parentElement ? cardEl.parentElement.className : null,
    ruleMatches: cardEl ? cardEl.matches('.cd-stage.is-opaque .cd-card') : null,
    stagePadding: getComputedStyle(document.querySelector('.cd-stage')).padding,
    shrinkInline: document.querySelector('.cd-shrink').getAttribute('style'),
    cardInline: cardEl ? cardEl.getAttribute('style') : null,
    card: box('.cd-shrink .cd-card') || box('.cd-card'),
    cardStyle: computed('.cd-shrink .cd-card', ['width','height','maxWidth','alignSelf','flex','boxSizing','padding']),
    emptyCard: document.querySelector('.cd-card--empty') ? box('.cd-card--empty') : null
  };
})())`

async function pixelReport(win, label) {
  const image = await win.webContents.capturePage()
  const size = image.getSize()
  const bitmap = image.toBitmap()
  let opaque = 0
  let semi = 0
  let minX = size.width
  let minY = size.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const a = bitmap[(y * size.width + x) * 4 + 3]
      if (a > 250) opaque += 1
      else if (a > 8) semi += 1
      if (a > 8) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  const corner = Array.from(bitmap.slice(8, 12))
  const center = Array.from(
    bitmap.slice(((size.height >> 1) * size.width + (size.width >> 1)) * 4, ((size.height >> 1) * size.width + (size.width >> 1)) * 4 + 4)
  )
  write(
    label +
      ' ' +
      JSON.stringify({
        window: size,
        opaqueRatio: Number((opaque / (size.width * size.height)).toFixed(3)),
        semiPixels: semi,
        bbox: maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
        topLeftPixel: corner,
        centerPixel: center
      })
  )
}

app.whenReady().then(async () => {
  await wait(4500)
  const win = widget()
  if (!win) {
    write('no widget')
    app.exit(1)
    return
  }
  const host = await win.webContents.executeJavaScript(
    'window.cd.getHostInfo().then(function(h){return JSON.stringify({system:h.systemTransparency, widget:h.widgetTransparent})})'
  )
  write('host=' + host)
  write('STRUCTURE ' + (await win.webContents.executeJavaScript(STRUCTURE)))
  await pixelReport(win, 'PIXELS')
  write('done')
  app.exit(0)
})
