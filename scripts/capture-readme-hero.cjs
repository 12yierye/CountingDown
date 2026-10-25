// 生成 README 首图：系统壁纸 + 应用真实渲染出来的组件卡片。
//
// 为什么不用 capture-readme.cjs 那套：本机命令安全策略把 reg.exe 拉黑，
// 真实主进程起不来（detectTransparency 会 spawn 一个 reg query），
// 「跑真应用 + desktopCapturer 截桌面」在这里跑不通。
//
// 这里只开一个窗口，加载 out/renderer/widget.html（真产物），
// 再用 insertCSS 把壁纸铺成背景、把卡片钉到右上角，最后整窗截图。
// 卡片是应用自己渲染的，壁纸是系统自带的 img0.jpg。
//
// 跑法：electron.exe scripts/capture-readme-hero.cjs
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const { buildDemoConfig } = require('./demo-config.cjs')

const appRoot = path.resolve(__dirname, '..')
const outFile = path.join(appRoot, 'assets/screenshots/01-widget-on-desktop.png')
const WALLPAPER = 'C:/Windows/Web/Wallpaper/Windows/img0.jpg'
const STAGE = { width: 1280, height: 720 }
/** 卡片贴右上角，离边远一点，留出「桌面」的呼吸感 */
const CARD = { top: 72, right: 104, width: 320 }

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    ...STAGE,
    show: true,
    frame: false,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'probe-preload.cjs'),
      additionalArguments: ['--cd-config=' + JSON.stringify(buildDemoConfig())],
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  })
  win.setMenuBarVisibility(false)
  win.setAlwaysOnTop(true, 'screen-saver')

  await win.loadFile(path.join(appRoot, 'out/renderer/widget.html'))
  await wait(1400)

  // 壁纸转 data URL：widget.html 的 CSP 是 `img-src 'self' data:`，file:// 会被拦
  const wallpaper = fs.readFileSync(WALLPAPER).toString('base64')
  await win.webContents.insertCSS(`
    html, body {
      background: #0f1117 url("data:image/jpeg;base64,${wallpaper}") center / cover no-repeat fixed !important;
    }
    /* 组件页原本铺满整窗；这里把卡片摘出来，钉到右上角 */
    .cd-stage { position: fixed !important; inset: 0 !important; padding: 0 !important;
      background: transparent !important; display: block !important; }
    .cd-shrink { position: absolute !important; top: ${CARD.top}px !important; right: ${CARD.right}px !important;
      left: auto !important; bottom: auto !important; width: ${CARD.width}px !important; height: auto !important;
      display: block !important; }
    .cd-card { width: ${CARD.width}px !important; height: auto !important; }
  `)
  await wait(900)

  const rect = await win.webContents.executeJavaScript(
    '(function(){var el=document.querySelector(".cd-card");if(!el)return null;var r=el.getBoundingClientRect();' +
      'return {left:Math.round(r.left),top:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height)};})()'
  )
  process.stdout.write('card rect = ' + JSON.stringify(rect) + '\n')

  const shot = await win.webContents.capturePage()
  fs.writeFileSync(outFile, shot.toPNG())
  const size = shot.getSize()
  process.stdout.write(`saved ${path.basename(outFile)} ${size.width}x${size.height}\n`)

  app.exit(0)
})
