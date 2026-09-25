// 托盘契约验证：图标存在、菜单项完整、左键切换回调可用（写入 .verify/tray.log）
const { app, BrowserWindow, Tray } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
fs.mkdirSync(outDir, { recursive: true })
const logFile = path.join(outDir, 'tray.log')
fs.writeFileSync(logFile, 'start ' + new Date().toISOString() + '\n')

const write = (line) => {
  try {
    fs.appendFileSync(logFile, line + '\n')
  } catch (error) {
    /* ignore */
  }
  try {
    process.stdout.write(line + '\n')
  } catch (error) {
    /* ignore */
  }
}

process.on('uncaughtException', (error) => write('MAIN_UNCAUGHT ' + (error && error.stack)))
app.setPath('userData', path.join(appRoot, '.probe-userdata'))

// Tray 是只读 getter，无法替换构造器；改为从原型方法里抓实例与菜单
let captured = null
let capturedMenu = null
const originalSetContextMenu = Tray.prototype.setContextMenu
Tray.prototype.setContextMenu = function patched(menu) {
  captured = this
  capturedMenu = menu
  return originalSetContextMenu.call(this, menu)
}

require(path.join(appRoot, 'out/main/index.js'))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function widget() {
  return BrowserWindow.getAllWindows().find((win) => win.getTitle() === '倒数日') || null
}

app.whenReady().then(async () => {
  await wait(4000)
  write('tray instance captured=' + Boolean(captured))
  if (!captured) {
    write('FAIL: 未能捕获 Tray 实例')
    app.exit(1)
    return
  }

  try {
    write('tray destroyed=' + captured.isDestroyed())
  } catch (error) {
    write('tray state failed: ' + error)
  }
  write(
    'menu items=' +
      (capturedMenu ? capturedMenu.items.map((item) => String(item.label)).join(' | ') : 'none')
  )

  const win = widget()
  write('widget visible(initial)=' + (win ? win.isVisible() : 'none'))

  // 托盘左键单击等价路径
  const main = require(path.join(appRoot, 'out/main/index.js'))
  main.triggerWidgetToggle()
  await wait(900)
  write('after toggle -> visible=' + (widget() ? widget().isVisible() : 'none'))
  main.triggerWidgetToggle()
  await wait(900)
  write('after 2nd toggle -> visible=' + (widget() ? widget().isVisible() : 'none'))

  write('done')
  app.exit(0)
})
