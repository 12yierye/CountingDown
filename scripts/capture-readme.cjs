// 生成 README 用的截图。
//
// 用一份**独立的 demo 配置**启动应用，不会碰用户真实的 %APPDATA%\countingdown，
// 因此截图里不会出现任何真实的倒数日内容。产物写入 assets/screenshots/。
//
// 用法：node_modules\electron\dist\electron.exe scripts\capture-readme.cjs
//
// ⚠️ 跑之前先确认**没有别的窗口盖住组件区域**（本机是最大化运行的「设置」应用）。
//    桌面组件那张图是把真实桌面截下来再裁剪的，别的窗口压在组件上就会被一起截进去——
//    实测踩过：卡片右上角叠进了另一个应用的界面元素。脚本不会替你去动别人的窗口。
const { app, BrowserWindow, desktopCapturer, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, 'assets', 'screenshots')
const userData = path.join(appRoot, '.probe-userdata', 'readme-shots')

// 截图前先清掉旧产物，避免混入过期图片
fs.mkdirSync(outDir, { recursive: true })
for (const file of fs.readdirSync(outDir)) {
  if (file.endsWith('.png')) fs.rmSync(path.join(outDir, file), { force: true })
}
fs.mkdirSync(userData, { recursive: true })

const demoConfig = {
  config: {
    /**
     * 桌面卡片用**应用默认外观**（午夜蓝深色卡）。
     * 卡片在真实桌面上要看得清，靠的是它与壁纸的对比：本机壁纸是浅蓝灰
     * （实测 #a8b4ca 一带），默认深色卡内部 #191d27 对它的对比度约 7.9:1，很清楚。
     * 反过来浅色卡在浅色壁纸上只有 1.8:1 左右，会糊成一片。
     * 注意壁纸可能是轮播的——换机器/换壁纸后重跑本脚本，记得复核 01 这张图。
     */
    countdowns: [
      {
        id: 'demo_new_year',
        name: '元旦',
        enabled: true,
        target: { mode: 'annual', date: '2027-01-01T00:00', month: 1, day: 1 },
        text: { hint: '', futureText: '', todayText: '', pastText: '', unit: '' },
        appearance: {}
      },
      {
        id: 'demo_trip',
        name: '跨年旅行',
        enabled: true,
        target: { mode: 'once', date: '2026-12-24T09:00', month: 12, day: 24 },
        text: {
          hint: '2026 年 12 月 24 日 · 周四',
          futureText: '',
          todayText: '',
          pastText: '',
          unit: ''
        },
        appearance: {}
      },
      {
        id: 'demo_birthday',
        name: '妈妈生日',
        enabled: true,
        target: { mode: 'annual', date: '', month: 5, day: 20 },
        text: { hint: '', futureText: '', todayText: '', pastText: '', unit: '' },
        appearance: {}
      },
      {
        id: 'demo_launch',
        name: '项目上线',
        enabled: false,
        target: { mode: 'once', date: '2026-11-15T00:00', month: 11, day: 15 },
        text: { hint: '', futureText: '', todayText: '', pastText: '', unit: '' },
        appearance: {}
      }
    ],
    activeId: 'demo_new_year',
    runtime: {
      widgetVisible: true,
      toggleHotkey: '',
      startAtLogin: false,
      language: 'zh-CN',
      theme: 'dark',
      window: {
        corner: 'top-right',
        cornerPreset: 'top-right',
        offsetX: 0,
        offsetY: 0
      }
    }
  }
}

fs.writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify(demoConfig, null, '\t')
)

app.setPath('userData', userData)
const main = require(path.join(appRoot, 'out/main/index.js'))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function widgetWindow() {
  return BrowserWindow.getAllWindows().find((win) => win.getTitle() === '倒数日') || null
}

function settingsWindow() {
  return BrowserWindow.getAllWindows().find((win) => win.getTitle().includes('设置')) || null
}

const write = (line) => {
  try {
    process.stdout.write(line + '\n')
  } catch (error) {
    /* ignore */
  }
}

async function savePng(image, name) {
  const file = path.join(outDir, name)
  fs.writeFileSync(file, image.toPNG())
  const size = image.getSize()
  write(`saved ${name} ${size.width}x${size.height} ${Math.round(fs.statSync(file).size / 1024)}KB`)
  return file
}

/**
 * 桌面组件要连真实桌面一起截，才看得出它是「浮在桌面角落的卡片」。
 * 用 desktopCapturer 抓整屏，再**按卡片自己的矩形**（向渲染层问）裁剪，而不是按整个窗口：
 * 窗口是 624×600，卡片只占其中一角，按窗口裁会留下大片空白（实测卡片仅占画面 7%）。
 */
async function captureWidgetOnDesktop() {
  const win = widgetWindow()
  if (!win) {
    write('WIDGET_MISSING')
    return
  }
  const display = screen.getPrimaryDisplay()
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: display.bounds.width, height: display.bounds.height }
  })
  if (!sources.length) {
    write('DESKTOP_CAPTURER_EMPTY（桌面会话不可截屏？）')
    return
  }
  const shot = sources[0].thumbnail
  const size = shot.getSize()
  const ratio = size.width / display.bounds.width
  const bounds = win.getBounds()

  // 卡片在窗口内的视觉矩形（window zoom 已反映在 getBoundingClientRect 上）
  const card = await win.webContents.executeJavaScript(
    '(function(){var el=document.querySelector(".cd-card");if(!el)return null;' +
      'var r=el.getBoundingClientRect();' +
      'return {left:r.left,top:r.top,width:r.width,height:r.height};})()'
  )
  if (!card) {
    write('CARD_MISSING')
    return
  }

  // 卡片四周保留一点桌面，说明它是浮在桌面上的。
  // 别放太大：桌子上的小图标/白点会在卡片下方露出来（实测 40px 时右下角多出 3 个像素的白点）。
  const margin = 32
  const left = bounds.x + card.left
  const top = bounds.y + card.top
  const x = Math.max(0, Math.round((left - margin) * ratio))
  const y = Math.max(0, Math.round((top - margin) * ratio))
  const width = Math.min(size.width - x, Math.round((card.width + margin * 2) * ratio))
  const height = Math.min(size.height - y, Math.round((card.height + margin * 2) * ratio))

  write(
    `widget window=${JSON.stringify(bounds)} cardInWindow=${JSON.stringify(card)} ` +
      `desktopShot=${size.width}x${size.height} ratio=${ratio} crop=${x},${y},${width},${height}`
  )
  await savePng(shot.crop({ x, y, width, height }), '01-widget-on-desktop.png')
}

async function shotWindow(win, name, state) {
  if (state) write(`  ${name} state = ${JSON.stringify(state)}`)
  await savePng(await win.webContents.capturePage(), name)
}

async function evalIn(win, expression) {
  try {
    return await win.webContents.executeJavaScript(expression)
  } catch (error) {
    write('EVAL_FAIL ' + error)
    return null
  }
}

/** 按可见文字点一个按钮 */
const clickByText = (pattern) =>
  `(function(){var bs=[].slice.call(document.querySelectorAll("button"));` +
  `var b=bs.filter(function(x){return ${pattern}.test(x.textContent||"")})[0];` +
  `if(!b)return "NOT_FOUND";b.click();return (b.textContent||"").trim();})()`

const SECTION_STATE =
  '({title:(document.querySelector(".settings-topbar__title")||{}).textContent||"",' +
  ' rows:document.querySelectorAll(".cd-row").length,' +
  ' editor:!!document.querySelector(".editor-head"),' +
  ' sticky:!!document.querySelector(".editor-sticky"),' +
  ' hasPreview:!!document.querySelector(".preview-wrap"),' +
  // 编辑页不再自带预览，这里看的是设置页左上角那份统一的全局预览样板
  ' cardPreview:!!document.querySelector(".preview-wrap .cd-card"),' +
  ' widgetNumber:(document.querySelector(".preview-wrap .cd-card__number")||{}).textContent||""})'

app.whenReady().then(async () => {
  await wait(4500)

  // 1) 桌面组件：必须在打开设置窗口之前截，否则设置窗口会盖住卡片
  await captureWidgetOnDesktop()

  // 2) 设置界面
  main.openSettingsWindow()
  await wait(4500)
  const s = settingsWindow()
  if (!s) {
    write('SETTINGS_MISSING')
    app.exit(1)
    return
  }
  s.show()
  s.focus()
  s.setBounds({ x: 120, y: 60, width: 1160, height: 800 })
  await wait(2500)
  await shotWindow(s, '02-countdown-list.png', await evalIn(s, SECTION_STATE))

  // 3) 编辑子页（本次编辑的正好是桌面显示项 -> 会出现「桌面卡片实时预览」标签）
  await evalIn(s, '(function(){var r=document.querySelectorAll(".cd-row__main");if(r[0])r[0].click();return r.length;})()')
  await wait(2500)
  await shotWindow(s, '03-edit-live-preview.png', await evalIn(s, SECTION_STATE))

  // 4) 全局外观页（带实时预览）
  await evalIn(s, clickByText('/^外观$/'))
  await wait(2500)
  await shotWindow(s, '04-global-appearance.png', await evalIn(s, SECTION_STATE))

  // 5) 预设主题页（换肤入口，配图用）
  await evalIn(s, clickByText('/^预设主题$/'))
  await wait(2500)
  await shotWindow(s, '05-preset-themes.png', await evalIn(s, SECTION_STATE))

  write('done')
  app.exit(0)
})
