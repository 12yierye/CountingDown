// 透明窗口「整窗浅色背板」回归检查。
//
// 背景：Windows 上如果在窗口首次显示之前调用 setIgnoreMouseEvents，
// 分层窗口会丢掉逐像素透明，整窗被画成一块不透光的浅色背板。
// 非置顶（behavior.alwaysOnTop = false）时必然复现，置顶时观察不到。
//
// 检查方式：把组件隐藏时截取窗口区域的桌面像素作为基准，再让组件显示并截图，
// 用像素差判断组件实际画出来的区域是不是只有卡片本身。
//
// 用法（必须带 --hidden，保证启动时不显示组件，从而拿到干净的桌面基准）：
//   node_modules/.bin/electron scripts/plate-check.cjs --hidden
const { app, BrowserWindow, nativeImage, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify', 'plate')
const userData = path.join(appRoot, '.probe-userdata')
fs.mkdirSync(outDir, { recursive: true })
const logFile = path.join(outDir, 'plate.log')
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
app.setPath('userData', userData)

// 直接写一份「非置顶」配置：这是背板问题最容易复现的条件
// 也可以用 CD_PLATE_TOPMOST=1 跑一遍置顶模式，确认置顶路径没有回归
const forceTop = process.env.CD_PLATE_TOPMOST === '1'
fs.mkdirSync(userData, { recursive: true })
fs.writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify({
    config: {
      behavior: { alwaysOnTop: forceTop },
      runtime: { widgetVisible: true, window: { transparent: true } }
    }
  })
)

const main = require(path.join(appRoot, 'out/main/index.js'))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
let shotIndex = 0

function check(name, ok, detail) {
  if (!ok) failures += 1
  write(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail === undefined ? '' : JSON.stringify(detail)}`)
}

/** 收尾：写出结论并以退出码反映结果，绝不允许脚本挂住 */
function finish() {
  clearTimeout(watchdog)
  write(failures === 0 ? 'ALL PASS' : `FAILURES ${failures}`)
  app.exit(failures === 0 ? 0 : 1)
}

const watchdog = setTimeout(() => {
  write('FAIL 检查超时')
  app.exit(1)
}, 150000)

process.on('unhandledRejection', (error) => {
  write('UNHANDLED_REJECTION ' + (error && error.stack ? error.stack : String(error)))
  failures += 1
  finish()
})

function widget() {
  return BrowserWindow.getAllWindows().find((win) => win.getTitle() === '倒数日') || null
}

function grab(rect, name) {
  const file = path.join(outDir, `${String(shotIndex++).padStart(2, '0')}-${name}.png`)
  const ps = [
    'Add-Type -AssemblyName System.Drawing',
    `$bmp = New-Object System.Drawing.Bitmap(${rect.width}, ${rect.height})`,
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    `$g.CopyFromScreen(${rect.x}, ${rect.y}, 0, 0, (New-Object System.Drawing.Size(${rect.width}, ${rect.height})))`,
    '$g.Dispose()',
    `$bmp.Save('${file.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    '$bmp.Dispose()',
    'Write-Output ok'
  ].join('; ')
  execFileSync(
    'powershell',
    ['-NoProfile', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
    { stdio: 'ignore' }
  )
  const image = nativeImage.createFromPath(file)
  return { size: image.getSize(), data: image.toBitmap() }
}

function meanPatch(image, rect) {
  const { width } = image.size
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * width + x) * 4
      b += image.data[i]
      g += image.data[i + 1]
      r += image.data[i + 2]
      n += 1
    }
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
}

function maxChannelDelta(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
}

/** 与基准图比较，返回「发生变化的像素」的外接矩形与占比 */
function diffBox(base, after) {
  const { width, height } = after.size
  let changed = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (
        Math.abs(base.data[i] - after.data[i]) +
          Math.abs(base.data[i + 1] - after.data[i + 1]) +
          Math.abs(base.data[i + 2] - after.data[i + 2]) <=
        30
      ) {
        continue
      }
      changed += 1
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return {
    ratio: Number((changed / (width * height)).toFixed(3)),
    box: maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  }
}

function moveCursor(x, y) {
  const script = `
$sig = @'
using System;
using System.Runtime.InteropServices;
public class CurPlate { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }
'@
Add-Type -TypeDefinition $sig
[CurPlate]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
`
  execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' })
}

async function cardRect(win) {
  const raw = await win.webContents.executeJavaScript(
    `JSON.stringify((function(){var c=document.querySelector('.cd-card');if(!c)return null;var r=c.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};})())`
  )
  return JSON.parse(raw)
}

async function interactiveFlag(win) {
  const raw = await win.webContents.executeJavaScript(
    `(document.querySelector('.cd-stage')||{dataset:{}}).dataset.interactive`
  )
  return String(raw)
}

/**
 * 隐藏 -> 截桌面基准 -> 通过应用的显示路径重新显示 -> 截图比对。
 * 断言：只有卡片（含投影）区域发生变化，窗口空白处必须还是桌面本身。
 */
async function measureShow(label) {
  const win = widget()
  if (!win) {
    check(label + ': 组件窗口存在', false)
    return
  }
  const bounds = win.getBounds()
  // 显式隐藏 / 显示，走应用自己的 setWidgetVisible 路径（等价于托盘开关）
  await win.webContents.executeJavaScript('window.cd.setWidgetVisible(false)')
  await wait(700)
  const base = grab(bounds, `${label}-hidden`)
  await win.webContents.executeJavaScript('window.cd.setWidgetVisible(true)')
  await wait(900)
  const shown = widget()
  const after = grab(bounds, `${label}-shown`)

  // 左下角远离卡片的空白区域：透明正常时应当与桌面基准完全一致
  const patch = { x: 12, y: bounds.height - 112, w: 120, h: 100 }
  const baseEmpty = meanPatch(base, patch)
  const afterEmpty = meanPatch(after, patch)
  const emptyDelta = maxChannelDelta(baseEmpty, afterEmpty)
  const result = diffBox(base, after)
  const card = shown ? await cardRect(shown) : null
  const cardArea = card ? (card.w + 40) * (card.h + 40) : 0
  const windowArea = bounds.width * bounds.height
  const changedArea = result.box ? result.box.w * result.box.h : 0

  write(
    `${label} bounds=${JSON.stringify(bounds)} card=${JSON.stringify(card)} diff=${JSON.stringify(result)} emptyDesktop=${JSON.stringify(baseEmpty)} emptyShown=${JSON.stringify(afterEmpty)}`
  )

  check(`${label}: 空白处仍是桌面（无背板）`, emptyDelta <= 12, { baseEmpty, afterEmpty, emptyDelta })
  check(
    `${label}: 变化区域不超过卡片 1.8 倍`,
    changedArea > 0 && changedArea <= cardArea * 1.8,
    { changedArea, cardArea }
  )
  check(`${label}: 变化区域远小于整窗`, result.ratio < 0.35, {
    ratio: result.ratio,
    windowArea
  })
}

app.whenReady().then(async () => {
  await wait(4500)
  let win = widget()
  if (!win) {
    write('FAIL 找不到组件窗口')
    app.exit(1)
    return
  }

  const host = JSON.parse(
    await win.webContents.executeJavaScript(
      'window.cd.getHostInfo().then(function(h){return JSON.stringify({system:h.systemTransparency,widget:h.widgetTransparent})})'
    )
  )
  const config = JSON.parse(
    await win.webContents.executeJavaScript(
      'window.cd.getConfig().then(function(c){return JSON.stringify({alwaysOnTop:c.behavior.alwaysOnTop,transparent:c.runtime.window.transparent})})'
    )
  )
  write(`host=${JSON.stringify(host)} config=${JSON.stringify(config)}`)
  check('系统透明效果可用', host.system === true, host)
  check('使用透明渲染', host.widget === true, host)
  check(
    forceTop ? '处于置顶模式' : '处于非置顶（背板问题最关键的条件）',
    config.alwaysOnTop === forceTop,
    config
  )

  // 1) 应用自己的显示路径（启动时同一条 showWidgetWindow）
  await measureShow('01-show')

  // 2) 隐藏后再显示（托盘/快捷键开关）
  await measureShow('02-toggle')

  // 3) 重建窗口（切换透明设置的路径）后再显示
  widget().webContents.executeJavaScript('window.cd.setTransparency(true)').catch(() => undefined)
  await wait(2600)
  await measureShow('03-recreate')

  // 4) 运行时切换「总在最前」（用户配置里关掉置顶时的真实路径）
  for (const top of [true, false]) {
    await widget().webContents.executeJavaScript(
      `window.cd.updateConfig({behavior:{alwaysOnTop:${top}}}).then(function(){return 1})`
    )
    await wait(500)
    await measureShow(`04-alwaysOnTop-${top}`)
  }

  // 5) 命中状态：指针在卡片上要恢复鼠标事件，移开后要恢复穿透
  win = widget()
  const bounds = win.getBounds()
  const card = await cardRect(win)
  moveCursor(bounds.x + card.x + card.w / 2, bounds.y + card.y + card.h / 2)
  await wait(700)
  const overCard = await interactiveFlag(win)
  check('指针在卡片上 -> interactive=true', overCard === 'true', overCard)
  moveCursor(bounds.x + 30, bounds.y + bounds.height - 30)
  await wait(700)
  const parked = await interactiveFlag(win)
  check('指针移到空白处 -> interactive=false', parked === 'false', parked)

  // 6) 隐藏时指针停在卡片上，再显示，命中状态必须重新判定为 true
  moveCursor(bounds.x + card.x + card.w / 2, bounds.y + card.y + card.h / 2)
  await wait(400)
  await win.webContents.executeJavaScript('window.cd.setWidgetVisible(false)')
  await wait(500)
  await interactiveFlag(win)
  await win.webContents.executeJavaScript('window.cd.setWidgetVisible(true)')
  await wait(700)
  const afterReshow = await interactiveFlag(win)
  check('显示后指针仍在卡片上 -> interactive=true', afterReshow === 'true', afterReshow)

  moveCursor(
    screen.getPrimaryDisplay().workArea.width - 20,
    screen.getPrimaryDisplay().workArea.height - 20
  )
  finish()
})
