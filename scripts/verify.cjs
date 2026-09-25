// 四角定位 + 悬停命中 + 设置窗口 的端到端验证（含截图）
const { app, BrowserWindow, desktopCapturer, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
fs.mkdirSync(outDir, { recursive: true })
const logFile = path.join(outDir, 'corners.log')
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

function moveCursor(x, y) {
  const script = `
$sig = @'
using System;
using System.Runtime.InteropServices;
public class Cur2 { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }
'@
Add-Type -TypeDefinition $sig
[Cur2]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
`
  require('node:child_process').execFileSync('powershell', ['-NoProfile', '-Command', script], {
    stdio: 'ignore'
  })
}

async function screenshot(fileName) {
  const display = screen.getPrimaryDisplay()
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: display.size.width, height: display.size.height }
  })
  if (!sources.length) return write('screenshot failed')
  fs.writeFileSync(path.join(outDir, fileName), sources[0].thumbnail.toPNG())
  write('screenshot written ' + fileName)
}

async function readState() {
  const win = widget()
  if (!win) return 'no-window'
  try {
    return await win.webContents.executeJavaScript(
      'JSON.stringify({corner:(document.querySelector(".cd-stage")||{dataset:{}}).dataset.corner, interactive:(document.querySelector(".cd-stage")||{dataset:{}}).dataset.interactive, pinned:!!document.querySelector(".cd-toolbar.is-pinned")})'
    )
  } catch (error) {
    return 'EVAL_FAIL ' + error
  }
}

app.whenReady().then(async () => {
  await wait(4000)
  const win = widget()
  if (!win) {
    write('no widget window')
    app.exit(1)
    return
  }

  const display = screen.getPrimaryDisplay()
  const work = display.workArea
  write('primary workArea=' + JSON.stringify(work))

  for (const corner of ['top-left', 'bottom-left', 'bottom-right', 'top-right']) {
    await win.webContents.executeJavaScript(
      `window.cd.snapCorner(${JSON.stringify(corner)}).then(function(){return "ok"})`
    )
    await wait(700)
    write(corner + ' bounds=' + JSON.stringify(win.getBounds()) + ' state=' + (await readState()))
  }

  // 悬停命中验证（最终停在右上角）
  const bounds = win.getBounds()
  const card = JSON.parse(
    await win.webContents.executeJavaScript(
      'JSON.stringify((function(){var r=document.querySelector(".cd-card").getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),top:Math.round(r.top),right:Math.round(r.right),width:Math.round(r.width),height:Math.round(r.height)};})())'
    )
  )
  write('card rect=' + JSON.stringify(card))
  moveCursor(bounds.x + 30, bounds.y + bounds.height - 30)
  await wait(900)
  write('blank area -> ' + (await readState()))
  moveCursor(bounds.x + card.x, bounds.y + card.y)
  await wait(900)
  write('over card -> ' + (await readState()))
  // 悬停到卡片右上角外侧的工具条位置，确认工具条出现
  let sweep = 'EVAL_FAIL'
  try {
    sweep = await win.webContents.executeJavaScript(
      'JSON.stringify((function(){var t=document.querySelector(".cd-toolbar");var c=document.querySelector(".cd-card");var s=document.querySelector(".cd-stage");var tr=t?t.getBoundingClientRect():null;var cr=c.getBoundingClientRect();var sr=s.getBoundingClientRect();return {toolbar: tr?{left:Math.round(tr.left),top:Math.round(tr.top),right:Math.round(tr.right),bottom:Math.round(tr.bottom)}:null, card:{left:Math.round(cr.left),top:Math.round(cr.top),right:Math.round(cr.right),bottom:Math.round(cr.bottom)}, stage:{left:Math.round(sr.left),top:Math.round(sr.top),right:Math.round(sr.right),bottom:Math.round(sr.bottom)}, offsetParent: t&&t.offsetParent?String(t.offsetParent.className):"none", cardPosition: getComputedStyle(c).position, innerH: window.innerHeight, stagePadTop: getComputedStyle(s).paddingTop};})())'
    )
  } catch (error) {
    write('SWEEP_FAIL ' + error)
  }
  write('rects=' + sweep)
  const rects = JSON.parse(sweep)
  if (rects.toolbar) {
    const tx = bounds.x + (rects.toolbar.left + rects.toolbar.right) / 2
    const ty = bounds.y + (rects.toolbar.top + rects.toolbar.bottom) / 2
    moveCursor(tx, ty)
    await wait(900)
    write('over toolbar(' + Math.round(tx) + ',' + Math.round(ty) + ') -> ' + (await readState()))
    await screenshot('widget-hover.png')
  }
  moveCursor(960, 540)
  await wait(700)
  write('cursor parked -> ' + (await readState()))

  // 设置窗口
  main.openSettingsWindow()
  await wait(4000)
  const s = settings()
  write('settings=' + (s ? 'present visible=' + s.isVisible() : 'missing'))
  if (s) {
    s.setBounds({ x: 180, y: 60, width: 1040, height: 760 })
    await wait(1500)
    await screenshot('settings.png')
  }
  write('done')
  app.exit(0)
})
