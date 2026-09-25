// 列表模式验证：旧配置迁移 / 选中项切换 / 单项外观覆盖 / 无悬浮按钮 / 列表首屏
const { app, BrowserWindow, desktopCapturer, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
const userData = path.join(appRoot, '.probe-userdata')
fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(userData, { recursive: true })

// 预置一份「旧版」配置，验证自动迁移
const legacy = {
  config: {
    target: { mode: 'annual', date: '2027-03-08T00:00', month: 3, day: 8 },
    text: {
      title: '旧版纪念日',
      hint: '迁移前的副标题',
      futureText: '还有 {days} 天',
      todayText: '就在今天！',
      pastText: '已远去',
      unit: '天'
    },
    behavior: { displayMode: 'days', showPastDays: false, opacity: 1 },
    runtime: {
      widgetVisible: true,
      toggleHotkey: 'ScrollLock',
      startAtLogin: false,
      language: 'zh-CN',
      theme: 'dark',
      window: { corner: 'top-right', x: 0, y: 0 }
    }
  }
}
fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify(legacy, null, '\t'))

const logFile = path.join(outDir, 'list.log')
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

const main = require(path.join(appRoot, 'out/main/index.js'))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function widget() {
  return BrowserWindow.getAllWindows().find((win) => win.getTitle() === '倒数日') || null
}

function settings() {
  return BrowserWindow.getAllWindows().find((win) => win.getTitle().includes('设置')) || null
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

async function evalIn(win, expression) {
  if (!win) return 'NO_WINDOW'
  try {
    return await win.webContents.executeJavaScript(expression)
  } catch (error) {
    return 'EVAL_FAIL ' + error
  }
}

const widgetCardText =
  'JSON.stringify({title:(document.querySelector(".cd-card__title")||{}).textContent, number:(document.querySelector(".cd-card__number")||{}).textContent, hint:(document.querySelector(".cd-card__hint")||{}).textContent, card:(document.querySelector(".cd-card")||{}).className, toolbarNodes: document.querySelectorAll(".cd-toolbar").length, buttonsInStage: document.querySelectorAll(".cd-stage button").length})'

app.whenReady().then(async () => {
  await wait(4000)

  // 1) 旧配置迁移
  const migrated = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'))
  write('migrated countdowns=' + (migrated.config.countdowns || []).length)
  write('migrated name=' + (migrated.config.countdowns?.[0]?.name ?? 'none'))
  write('migrated activeId set=' + Boolean(migrated.config.activeId))
  write('migrated global text kept=' + JSON.stringify(migrated.config.text))
  write('legacy target removed=' + (migrated.config.target === undefined ? 'no' : 'kept as global'))

  const win = widget()
  write('widget exists=' + Boolean(win))
  write('widget card=' + (await evalIn(win, widgetCardText)))

  // 2) 新增一项并切为桌面显示
  const cfg = migrated.config
  const second = {
    id: 'verify_item_2',
    name: '验证用倒数日',
    enabled: true,
    target: { mode: 'once', date: '2030-12-31T23:59', month: 12, day: 31 },
    text: { hint: '', futureText: '', todayText: '', pastText: '', unit: '' },
    appearance: { background: { color: '#ff0055', radius: 30 } }
  }
  cfg.countdowns = [...cfg.countdowns, second]
  cfg.activeId = second.id
  await evalIn(win, 'window.cd.updateConfig(' + JSON.stringify({ countdowns: cfg.countdowns, activeId: second.id }) + ').then(function(){return "ok"})')
  await wait(1500)
  write('after switching -> ' + (await evalIn(win, widgetCardText)))

  // 3) 单项外观覆盖应生效（背景色改为 #ff0055、圆角 30）
  const overridden = await evalIn(
    win,
    'JSON.stringify({bg: getComputedStyle(document.querySelector(".cd-card")).backgroundColor, radius: getComputedStyle(document.querySelector(".cd-card")).borderRadius})'
  )
  write('override style=' + overridden)

  // 4) 切回第一项，外观应回到全局
  await evalIn(
    win,
    'window.cd.setActiveCountdown(' + JSON.stringify(cfg.countdowns[0].id) + ').then(function(){return "ok"})'
  )
  await wait(1200)
  write('back to first -> ' + (await evalIn(win, widgetCardText)))
  write(
    'global style=' +
      (await evalIn(
        win,
        'JSON.stringify({bg: getComputedStyle(document.querySelector(".cd-card")).backgroundColor, radius: getComputedStyle(document.querySelector(".cd-card")).borderRadius})'
      ))
  )

  // 5) 设置界面：首屏应为列表，且导航为两级
  main.openSettingsWindow()
  await wait(4500)
  const s = settings()
  write('settings window=' + (s ? 'present' : 'missing'))
  if (s) {
    s.webContents.on('console-message', (...args) => {
      const d = args.length > 1 && typeof args[1] === 'object' ? args[1] : null
      write('[settings-console:' + (d ? d.level : '?') + '] ' + (d ? d.message : args.join(' ')))
    })
    write(
      'settings state=' +
        (await evalIn(
          s,
          'JSON.stringify({title:(document.querySelector(".settings-topbar__title")||{}).textContent, groups: document.querySelectorAll(".settings-nav__group").length, navItems: document.querySelectorAll(".settings-nav__item").length, rows: document.querySelectorAll(".cd-row").length, hasPreview: !!document.querySelector(".preview-wrap")})'
        ))
    )
    s.show()
    s.focus()
    s.setBounds({ x: 180, y: 60, width: 1040, height: 760 })
    await wait(1500)
    await screenshot('settings-list.png')

    // 打开新建页，确认编辑器出现
    const clicked = await evalIn(
      s,
      'JSON.stringify((function(){var bs=[].slice.call(document.querySelectorAll("button"));var b=bs.filter(function(x){return /新建|New countdown/.test(x.textContent||"")})[0];if(!b)return {found:false,all:bs.map(function(x){return (x.textContent||"").trim().slice(0,12)})};b.click();return {found:true,text:(b.textContent||"").trim()};})())'
    )
    write('new-button ' + clicked)
    await wait(1000)
    write(
      'after-click rows=' +
        (await evalIn(s, 'document.querySelectorAll(".cd-row").length')) +
        ' editorHeads=' +
        (await evalIn(s, 'document.querySelectorAll(".editor-head").length'))
    )
    await wait(1500)
    s.show()
    s.focus()
    await wait(800)
    write(
      'editor state=' +
        (await evalIn(
          s,
          'JSON.stringify({editor: !!document.querySelector(".editor-head"), dividers: document.querySelectorAll(".el-divider__text").length, rows: document.querySelectorAll(".cd-row").length, backBtn: !![].slice.call(document.querySelectorAll("button")).filter(function(x){return /返回列表|Back/.test(x.textContent||"")}).length})'
        ))
    )

    // 编辑草稿稳定性：连续输入应全部保留，且不被主进程回传的配置覆盖
    for (const text of ['元旦快乐', '元旦快乐2027']) {
      await evalIn(
        s,
        'JSON.stringify((function(){var el=document.querySelector(".editor-head").closest(".el-card").querySelector("input.el-input__inner");var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;setter.call(el,' +
          JSON.stringify(text) +
          ');el.dispatchEvent(new Event("input",{bubbles:true}));return el.value;})())'
      )
      await wait(700)
    }
    const typed = await evalIn(
      s,
      'JSON.stringify({input: document.querySelector(".editor-head").closest(".el-card").querySelector("input.el-input__inner").value})'
    )
    write('typed state=' + typed)
    await wait(600)

    // 显式保存：点右上角保存按钮后才写盘并返回列表
    const saved = await evalIn(
      s,
      'JSON.stringify((function(){var b=[].slice.call(document.querySelectorAll(".panel-card__header button")).filter(function(x){return /保存|Save/.test(x.textContent||"")})[0];if(!b)return {found:false};b.click();return {found:true};})())'
    )
    write('save-button ' + saved)
    await wait(1600)
    const persistedDraft = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'))
    write(
      'persisted names=' +
        JSON.stringify(persistedDraft.config.countdowns.map((item) => item.name))
    )
    write(
      'editor closed=' + (await evalIn(s, 'document.querySelectorAll(".editor-head").length')) + ' rows=' +
        (await evalIn(s, 'document.querySelectorAll(".cd-row").length'))
    )
    await screenshot('settings-editor.png')
  }

  await wait(500)
  const w2 = widget()
  if (w2) w2.showInactive()
  await wait(600)
  await screenshot('widget-final.png')
  write('done')
  app.exit(0)
})
