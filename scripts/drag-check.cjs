// 拖动 / 不透明度 / 字体下拉 / 深色按钮配色 的端到端验证（含真实鼠标模拟与截图）
const { app, BrowserWindow, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
const shots = path.join(outDir, 'drag')
fs.mkdirSync(shots, { recursive: true })
const logFile = path.join(outDir, 'drag-check.log')
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

async function ev(win, expression) {
  try {
    return await win.webContents.executeJavaScript(expression)
  } catch (error) {
    return 'EVAL_FAIL ' + error
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** PowerShell 里的真实鼠标操作：SetCursorPos + mouse_event（左键按下/抬起） */
function psLines(lines) {
  const script = [
    '$sig = @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class CdMouse {',
    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
    '  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);',
    '  public static void Down() { mouse_event(0x0002, 0, 0, 0, IntPtr.Zero); }',
    '  public static void Up() { mouse_event(0x0004, 0, 0, 0, IntPtr.Zero); }',
    '}',
    '"@',
    'Add-Type -TypeDefinition $sig',
    ...lines
  ].join('\n')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  require('node:child_process').execFileSync('powershell', ['-NoProfile', '-EncodedCommand', encoded], {
    stdio: 'ignore'
  })
}

/** 把光标移到 (x,y) 并按下左键，然后分步移动到最后落点并松开 */
async function realDrag(from, to, steps = 12) {
  psLines([`[CdMouse]::SetCursorPos(${Math.round(from.x)}, ${Math.round(from.y)})`])
  await sleep(500)
  psLines(['[CdMouse]::Down()'])
  await sleep(180)
  for (let i = 1; i <= steps; i += 1) {
    const x = from.x + ((to.x - from.x) * i) / steps
    const y = from.y + ((to.y - from.y) * i) / steps
    psLines([`[CdMouse]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})`])
    await sleep(45)
  }
  await sleep(160)
  psLines(['[CdMouse]::Up()'])
  await sleep(600)
}

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
    require('node:child_process').execFileSync('powershell', ['-NoProfile', '-EncodedCommand', encoded], {
      stdio: 'ignore'
    })
    write('shot ' + name)
  } catch (error) {
    write('shot failed ' + name + ' :: ' + error)
  }
}

const navTo = (label) =>
  `JSON.stringify((function(){var b=[].slice.call(document.querySelectorAll(".settings-nav__item")).filter(function(x){return (x.textContent||"").trim()===${JSON.stringify(
    label
  )}})[0]; if(!b) return {found:false}; b.click(); return {found:true};})())`

const BUTTON_PROBE = `JSON.stringify((function(){
  function parseColor(v){var m=/rgba?\\(([^)]+)\\)/.exec(v||'');if(!m)return null;var p=m[1].split(',').map(function(x){return parseFloat(x)});return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
  function ch(c){var s=c/255;return s<=0.03928?s/12.92:Math.pow((s+0.055)/1.055,2.4);}
  function lum(c){return 0.2126*ch(c.r)+0.7152*ch(c.g)+0.0722*ch(c.b);}
  function ratio(f,b){var a=lum(f),c=lum(b),hi=Math.max(a,c),lo=Math.min(a,c);return Math.round(((hi+0.05)/(lo+0.05))*100)/100;}
  var out=[];
  [].slice.call(document.querySelectorAll('.el-button')).forEach(function(b){
    var cs=getComputedStyle(b); var fg=parseColor(cs.color), bg=parseColor(cs.backgroundColor);
    var r=b.getBoundingClientRect(); if(r.width<1) return;
    out.push({ text:(b.textContent||'').trim().slice(0,12), plain:b.classList.contains('is-plain'),
      color:cs.color, bg:cs.backgroundColor, contrast: fg&&bg&&bg.a>0.9 ? ratio(fg,bg) : null });
  });
  return { html: document.documentElement.className, buttons: out };
})())`

const FONT_PROBE = `JSON.stringify((function(){
  var out={};
  var items=[].slice.call(document.querySelectorAll('.cd-font-select .el-select-dropdown__item'));
  out.popperFound = document.querySelectorAll('.cd-font-select').length;
  out.count=items.length;
  out.items=items.map(function(li){
    var cs=getComputedStyle(li);
    return { text:(li.textContent||'').trim(), scrollW:li.scrollWidth, clientW:li.clientWidth,
      h:Math.round(li.getBoundingClientRect().height), whiteSpace:cs.whiteSpace,
      overflow:cs.overflow, clipped: li.scrollWidth - li.clientWidth > 1 };
  });
  out.truncated = out.items.filter(function(i){return /…/.test(i.text) || i.clipped;}).length;
  return out;
})())`

const OPACITY_PROBE = `JSON.stringify((function(){
  var card=document.querySelector('.cd-card');
  var stage=document.querySelector('.cd-stage');
  return {
    stageDragging: stage ? stage.dataset.dragging : null,
    allowDragClass: card ? card.classList.contains('is-draggable') : null,
    cardOpacity: card ? getComputedStyle(card).opacity : null,
    stageInteractive: stage ? stage.dataset.interactive : null
  };
})())`

app.whenReady().then(async () => {
  await wait(4000)
  const win = widget()
  if (!win) {
    write('no widget window')
    app.exit(1)
    return
  }
  const area = screen.getPrimaryDisplay().workArea
  write('workArea ' + JSON.stringify(area))

  // 从默认的右上角开始，确保位置可预期
  await ev(win, `window.cd.updateConfig({runtime:{theme:"dark",language:"zh-CN",window:{allowDrag:true}},appearance:{opacity:1},behavior:{alwaysOnTop:true}}).then(function(){return "ok"})`)
  await ev(win, `window.cd.snapCorner("top-right").then(function(){return "ok"})`)
  await wait(800)
  const before = win.getBounds()
  write('BEFORE bounds=' + JSON.stringify(before) + ' state=' + (await ev(win, OPACITY_PROBE)))

  // ---- 1) 真实拖动：把卡片往左下拖 ----
  const card = JSON.parse(
    await ev(
      win,
      'JSON.stringify((function(){var r=document.querySelector(".cd-card").getBoundingClientRect();return {left:Math.round(r.left),top:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height)};})())'
    )
  )
  write('card=' + JSON.stringify(card))
  const grab = {
    x: before.x + card.left + card.width / 2,
    y: before.y + card.top + card.height / 2
  }
  const target = { x: area.x + 320, y: area.y + area.height - 220 }
  write('drag ' + JSON.stringify(grab) + ' -> ' + JSON.stringify(target))
  await realDrag(grab, target)
  const after = win.getBounds()
  const cfg = await ev(win, 'window.cd.getConfig().then(function(c){return JSON.stringify(c.runtime.window)})')
  write('AFTER bounds=' + JSON.stringify(after))
  write('AFTER window config=' + cfg)
  write('AFTER state=' + (await ev(win, OPACITY_PROBE)))

  // 配置能不能还原出同一个窗口位置
  const parsed = JSON.parse(cfg)
  const expect = {
    x:
      parsed.cornerPreset.endsWith('left')
        ? area.x + 20 + parsed.offsetX
        : area.x + area.width - after.width - 20 - parsed.offsetX,
    y:
      parsed.cornerPreset.startsWith('top')
        ? area.y + 20 + parsed.offsetY
        : area.y + area.height - after.height - 20 - parsed.offsetY
  }
  write(
    'ROUNDTRIP ' +
      JSON.stringify({
        expect,
        actual: { x: after.x, y: after.y },
        ok: Math.abs(expect.x - after.x) <= 2 && Math.abs(expect.y - after.y) <= 2,
        moved: after.x !== before.x || after.y !== before.y,
        nearestCorner: parsed.cornerPreset,
        offsetsInRange:
          parsed.offsetX >= -200 &&
          parsed.offsetX <= area.width &&
          parsed.offsetY >= -200 &&
          parsed.offsetY <= area.height
      })
  )
  await screenshot('01-after-drag')

  // 设置面板里应显示同一组数值
  main.openSettingsWindow()
  await wait(4500)
  const s = settings()
  if (!s) {
    write('no settings window')
    app.exit(1)
    return
  }
  s.setBounds({ x: 60, y: 40, width: 1120, height: 820 })
  await wait(1200)
  await ev(s, navTo('布局'))
  await wait(1200)
  write(
    'LAYOUT_PANEL ' +
      (await ev(
        s,
        `JSON.stringify((function(){
          var rows=[].slice.call(document.querySelectorAll('.field-row'));
          var pick=function(name){var r=rows.filter(function(x){return (x.querySelector('.field-row__label')||{}).textContent && x.querySelector('.field-row__label').textContent.trim().indexOf(name)>=0;})[0]; if(!r) return null; var v=r.querySelector('.slider-field__value'); return v? v.textContent.trim() : (r.querySelector('.el-switch')? 'switch' : null);};
          return {
            offsetX: pick('偏移')? null : null,
            sliders: [].slice.call(document.querySelectorAll('.slider-field__value')).map(function(v){return v.textContent.trim()}),
            dragSwitch: document.querySelectorAll('.field-row .el-switch').length,
            dragRow: (function(){var r=rows.filter(function(x){return /允许拖动/.test((x.querySelector('.field-row__label')||{}).textContent||'')})[0]; if(!r) return null; var sw=r.querySelector('.el-switch'); return sw? sw.classList.contains('is-checked') : null;})()
          };
        })())`
      ))
  )
  await screenshot('02-layout-panel')

  // ---- 2) 关掉允许拖动后，拖动不应生效 ----
  await ev(s, `window.cd.updateConfig({runtime:{window:{allowDrag:false}}}).then(function(){return "ok"})`)
  await wait(900)
  const before2 = win.getBounds()
  await realDrag(
    { x: before2.x + card.left + card.width / 2, y: before2.y + card.top + card.height / 2 },
    { x: before2.x + card.left + card.width / 2 - 160, y: before2.y + card.top + card.height / 2 - 120 }
  )
  const after2 = win.getBounds()
  write(
    'DRAG_DISABLED ' +
      JSON.stringify({
        before: before2,
        after: after2,
        moved: after2.x !== before2.x || after2.y !== before2.y,
        state: await ev(win, OPACITY_PROBE)
      })
  )
  await ev(s, `window.cd.updateConfig({runtime:{window:{allowDrag:true}}}).then(function(){return "ok"})`)
  await wait(700)

  // ---- 2b) 托盘菜单里的「允许拖动」与配置同步 ----
  const dragEnabled = main.trayMenuSnapshot()
  await ev(s, `window.cd.updateConfig({runtime:{window:{allowDrag:false}}}).then(function(){return "ok"})`)
  await wait(500)
  const dragDisabled = main.trayMenuSnapshot()
  await ev(s, `window.cd.updateConfig({runtime:{window:{allowDrag:true}}}).then(function(){return "ok"})`)
  await wait(500)
  write(
    'TRAY_MENU ' +
      JSON.stringify({
        labels: dragEnabled.map((item) => item.label),
        whenAllowed: dragEnabled.find((item) => item.label === '允许拖动') || null,
        whenBlocked: dragDisabled.find((item) => item.label === '允许拖动') || null
      })
  )

  // ---- 3) 不透明度：全局 + 单项覆盖 ----
  await ev(s, `window.cd.updateConfig({appearance:{opacity:0.5}}).then(function(){return "ok"})`)
  await wait(900)
  write('OPACITY_GLOBAL ' + (await ev(win, OPACITY_PROBE)))
  const itemId = await ev(s, 'window.cd.getConfig().then(function(c){return c.activeId})')
  // 直接给选中项写入外观覆盖（模拟编辑页勾选「不透明度」）
  await ev(
    s,
    `(function(){ return window.cd.getConfig().then(function(c){
        var list = c.countdowns.map(function(it){ return it.id === ${JSON.stringify(
          itemId
        )} ? Object.assign({}, it, {appearance: Object.assign({}, it.appearance, {opacity: 0.8})}) : it });
        return window.cd.updateConfig({countdowns: list}).then(function(){return "ok"});
      }); })()`
  )
  await wait(900)
  write('OPACITY_ITEM_OVERRIDE ' + (await ev(win, OPACITY_PROBE)))
  await ev(
    s,
    `(function(){ return window.cd.getConfig().then(function(c){
        var list = c.countdowns.map(function(it){ return it.id === ${JSON.stringify(
          itemId
        )} ? Object.assign({}, it, {appearance: {}}) : it });
        return window.cd.updateConfig({countdowns: list}).then(function(){return "ok"});
      }); })()`
  )
  await ev(s, `window.cd.updateConfig({appearance:{opacity:1}}).then(function(){return "ok"})`)
  await wait(700)

  // ---- 3b) 编辑页里逐项覆盖不透明度 ----
  await ev(s, navTo('倒数日列表'))
  await wait(1000)
  await ev(
    s,
    `JSON.stringify((function(){var m=document.querySelector('.cd-row__main'); if(!m) return 'no-row'; m.click(); return 'ok';})())`
  )
  await wait(1600)
  const rowSel = (needle) =>
    `[].slice.call(document.querySelectorAll('.field-row')).filter(function(x){return (x.querySelector('.field-row__label')||{}).textContent && x.querySelector('.field-row__label').textContent.indexOf(${JSON.stringify(
      needle
    )})>=0})[0]`
  await ev(
    s,
    `JSON.stringify((function(){var r=${rowSel('启用外观覆盖')}; if(!r) return 'no-row'; var sw=r.querySelector('.el-switch'); if(!sw) return 'no-switch'; sw.click(); return 'on';})())`
  )
  await wait(900)
  write(
    'EDITOR_OVERRIDE_OFF ' +
      (await ev(
        s,
        `JSON.stringify({checkboxes: document.querySelectorAll('.override-row .el-checkbox, .editor-style__head .el-checkbox').length})`
      ))
  )
  await ev(
    s,
    `JSON.stringify((function(){var r=${rowSel('组件不透明度')}||${rowSel('Widget opacity')}; if(!r) return 'no-row'; var cb=r.querySelector('.el-checkbox'); if(!cb) return 'no-checkbox'; cb.click(); return 'ticked';})())`
  )
  await wait(700)
  write(
    'EDITOR_OPACITY_ON ' +
      (await ev(
        s,
        `JSON.stringify((function(){var r=${rowSel('组件不透明度')}||${rowSel('Widget opacity')}; if(!r) return {row:false}; var btn=r.querySelector('.slider-field__value'); if(btn) btn.click(); return {row:true, value: btn? btn.textContent.trim(): null};})())`
      ))
  )
  await wait(400)
  await ev(
    s,
    `JSON.stringify((function(){var r=${rowSel('组件不透明度')}||${rowSel('Widget opacity')}; var i=r.querySelector('.slider-field__input'); if(!i) return 'no-input'; i.value='0.8'; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return 'typed';})())`
  )
  await wait(700)
  await ev(
    s,
    `JSON.stringify((function(){var b=[].slice.call(document.querySelectorAll('button')).filter(function(x){return /保存$|^Save$/.test((x.textContent||'').trim())})[0]; if(!b) return 'no-save'; b.click(); return 'saved';})())`
  )
  await wait(1200)
  write(
    'EDITOR_SAVED ' +
      (await ev(
        s,
        `window.cd.getConfig().then(function(c){
           var it = c.countdowns.filter(function(x){return x.id === ${JSON.stringify(itemId)}})[0];
           return JSON.stringify({appearance: it? it.appearance : null, globalOpacity: c.appearance.opacity});
         })`
      ))
  )
  write('EDITOR_WIDGET ' + (await ev(win, OPACITY_PROBE)))
  // 归零，避免影响后续断言
  await ev(
    s,
    `(function(){ return window.cd.getConfig().then(function(c){
        var list = c.countdowns.map(function(it){ return it.id === ${JSON.stringify(
          itemId
        )} ? Object.assign({}, it, {appearance: {}}) : it });
        return window.cd.updateConfig({countdowns: list}).then(function(){return "ok"});
      }); })()`
  )
  await wait(600)

  // ---- 4) 字体下拉：每条都要完整显示 ----
  await ev(s, navTo('外观'))
  await wait(1200)
  await ev(
    s,
    `JSON.stringify((function(){var w=document.querySelector('.font-select .el-select__wrapper')||document.querySelector('.el-select__wrapper'); if(!w) return 'no-wrapper'; w.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); w.click(); return 'clicked';})())`
  )
  await wait(1200)
  write('FONT_DROPDOWN ' + (await ev(s, FONT_PROBE)))
  await screenshot('03-font-dropdown')
  await ev(s, `document.body.click(); "closed"`)
  await wait(400)

  // ---- 5) 深色主题下的按钮配色 ----
  for (const [label, name] of [
    ['预设主题', 'preset'],
    ['系统集成', 'integration']
  ]) {
    await ev(s, navTo(label))
    await wait(1100)
    const probe = JSON.parse(await ev(s, BUTTON_PROBE))
    const bad = probe.buttons.filter((b) => b.contrast !== null && b.contrast < 4.5)
    write(
      'DARK_BUTTONS ' +
        name +
        ' ' +
        JSON.stringify({ html: probe.html, lowContrast: bad, total: probe.buttons.length })
    )
    await screenshot('04-' + name + '-dark')
  }

  await ev(s, `window.cd.updateConfig({runtime:{theme:"light"}}).then(function(){return "ok"})`)
  await wait(1200)
  await ev(s, navTo('预设主题'))
  await wait(1100)
  const lightProbe = JSON.parse(await ev(s, BUTTON_PROBE))
  write(
    'LIGHT_BUTTONS ' +
      JSON.stringify({
        html: lightProbe.html,
        lowContrast: lightProbe.buttons.filter((b) => b.contrast !== null && b.contrast < 4.5)
      })
  )
  await ev(s, `window.cd.updateConfig({runtime:{theme:"dark"}}).then(function(){return "ok"})`)

  write('done')
  app.exit(0)
})
