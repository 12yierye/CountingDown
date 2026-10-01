// 编辑实时预览验证：
//   1) 编辑当前桌面显示项 -> 组件窗口实时跟着草稿变，且未写盘
//   2) 放弃修改 -> 组件窗口回到编辑前
//   3) 编辑非当前显示项 -> 组件窗口不变
//   4) 吸顶预览：滚到底部仍在视口内
//   5) 新建项放弃编辑 -> 空白项被删除
//   6) 清空覆盖层 -> 组件窗口回落到持久化配置（含单项外观覆盖）
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
const userData = path.join(appRoot, '.probe-userdata')
fs.mkdirSync(outDir, { recursive: true })
fs.rmSync(userData, { recursive: true, force: true })
fs.mkdirSync(userData, { recursive: true })

const ITEM_A = {
  id: 'probe_item_a',
  name: '编辑前名称',
  enabled: true,
  target: { mode: 'once', date: '2030-12-31T23:59', month: 12, day: 31 },
  text: { hint: '编辑前副标题', futureText: '', todayText: '', pastText: '', unit: '' },
  appearance: {}
}
const ITEM_B = {
  id: 'probe_item_b',
  name: '第二项',
  enabled: true,
  target: { mode: 'annual', date: '', month: 6, day: 1 },
  text: { hint: '', futureText: '', todayText: '', pastText: '', unit: '' },
  appearance: {}
}

fs.writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify(
    {
      config: {
        countdowns: [ITEM_A, ITEM_B],
        activeId: ITEM_A.id,
        runtime: { widgetVisible: true, toggleHotkey: '', language: 'zh-CN' }
      }
    },
    null,
    '\t'
  )
)

const logFile = path.join(outDir, 'preview.log')
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

let failures = 0
function check(name, ok, detail) {
  if (!ok) failures += 1
  write(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`)
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

async function evalIn(win, expression) {
  if (!win) return 'NO_WINDOW'
  try {
    return await win.webContents.executeJavaScript(expression)
  } catch (error) {
    return 'EVAL_FAIL ' + error
  }
}

async function jsonIn(win, expression) {
  const raw = await evalIn(win, `JSON.stringify(${expression})`)
  try {
    return JSON.parse(raw)
  } catch (error) {
    return { parseError: String(raw) }
  }
}

/** 组件窗口当前渲染出的标题 / 副标题 / 背景 */
const WIDGET_STATE =
  '({title:(document.querySelector(".cd-card__title")||{}).textContent||"",' +
  ' hint:(document.querySelector(".cd-card__hint")||{}).textContent||"",' +
  ' bg:(document.querySelector(".cd-card")?getComputedStyle(document.querySelector(".cd-card")).backgroundColor:""),' +
  ' radius:(document.querySelector(".cd-card")?getComputedStyle(document.querySelector(".cd-card")).borderRadius:"")})'

const widgetState = (win) => jsonIn(win, WIDGET_STATE)

/** 读回磁盘上的配置（probe 自己的 userData，不影响真实用户配置） */
function persisted() {
  try {
    return JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8')).config
  } catch (error) {
    return null
  }
}

function persistedItem(id) {
  const cfg = persisted()
  return cfg ? (cfg.countdowns || []).find((item) => item.id === id) || null : null
}

/** 用原生 setter 往受控输入框里打字，和 verify-list.cjs 同一套做法 */
const TYPE_INTO = (selector, text) =>
  `(function(){var el=document.querySelector(${JSON.stringify(selector)});` +
  `if(!el)return {found:false};` +
  `var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;` +
  `setter.call(el,${JSON.stringify(text)});` +
  `el.dispatchEvent(new Event("input",{bubbles:true}));` +
  `return {found:true,value:el.value};})()`

const CLICK_BUTTON = (pattern) =>
  `(function(){var bs=[].slice.call(document.querySelectorAll("button"));` +
  `var b=bs.filter(function(x){return ${pattern}.test(x.textContent||"")})[0];` +
  `if(!b)return {found:false,all:bs.map(function(x){return (x.textContent||"").trim().slice(0,10)})};` +
  `b.click();return {found:true,text:(b.textContent||"").trim()};})()`

/** 模板里第一个可点的行（打开该项的编辑子页） */
const OPEN_ROW = (index) =>
  `(function(){var rows=document.querySelectorAll(".cd-row__main");` +
  `if(rows.length<=${index})return {found:false,count:rows.length};` +
  `rows[${index}].click();return {found:true,count:rows.length};})()`

const EDITOR_STATE =
  '({editor:!!document.querySelector(".editor-head"),' +
  ' sticky:!!document.querySelector(".editor-sticky"),' +
  ' nameInput:!!document.querySelector(".panel-card input.el-input__inner[maxlength=\\"30\\"]"),' +
  ' liveTag:(function(){var t=[].slice.call(document.querySelectorAll(".editor-head .el-tag"));' +
  'var m=t.filter(function(x){return /实时预览|Live on desktop/.test(x.textContent||"")});' +
  'return m.length?m[0].textContent.trim():"";})()})'

app.whenReady().then(async () => {
  await wait(4000)

  const win = widget()
  check('widget-window-exists', Boolean(win), win ? 'ok' : 'missing')
  if (!win) {
    await wait(200)
    app.exit(1)
    return
  }

  const before = await widgetState(win)
  write('initial widget = ' + JSON.stringify(before))
  check('initial-title-is-persisted', before.title === ITEM_A.name, JSON.stringify(before.title))

  // ---------------------------------------------------------------- 打开编辑子页
  main.openSettingsWindow()
  await wait(4500)
  const s = settings()
  check('settings-window-exists', Boolean(s), s ? 'ok' : 'missing')
  if (!s) {
    await wait(200)
    app.exit(1)
    return
  }
  s.show()
  s.focus()

  const opened = await jsonIn(s, OPEN_ROW(0))
  await wait(1200)
  write('open-row = ' + JSON.stringify(opened))
  const editorState = await jsonIn(s, EDITOR_STATE)
  write('editor state = ' + JSON.stringify(editorState))
  check('editor-opened', editorState.editor === true, JSON.stringify(editorState))
  check('sticky-bar-present', editorState.sticky === true, JSON.stringify(editorState))
  check(
    'live-preview-tag-shown',
    /实时预览/.test(editorState.liveTag || ''),
    JSON.stringify(editorState.liveTag)
  )

  // ------------------------------------------------- 1) 实时跟随 + 未写盘
  const TYPED = '实时预览中的新名称'
  await jsonIn(s, TYPE_INTO('.panel-card input.el-input__inner[maxlength="30"]', TYPED))
  await wait(1100)

  const live = await widgetState(win)
  write('after typing widget = ' + JSON.stringify(live))
  check('widget-follows-draft-name', live.title === TYPED, JSON.stringify(live.title))
  check(
    'draft-not-persisted',
    (persistedItem(ITEM_A.id) || {}).name === ITEM_A.name,
    JSON.stringify((persistedItem(ITEM_A.id) || {}).name)
  )

  // 副标题同样实时。用 maxlength 定位：名称 30 / 副标题 60 / 三段状态文案 40 / 单位 6，
  // 而日期选择器的输入框没有 maxlength，所以比按下标取输入框稳。
  await jsonIn(
    s,
    TYPE_INTO('.panel-card input.el-input__inner[maxlength="60"]', '实时预览副标题')
  )
  await wait(1100)
  const live2 = await widgetState(win)
  write('after hint typing widget = ' + JSON.stringify(live2))
  check('widget-follows-draft-hint', live2.hint === '实时预览副标题', JSON.stringify(live2.hint))

  // ------------------------------------------------------------ 4) 吸顶预览
  const sticky = await jsonIn(
    s,
    `(function(){var sc=document.querySelector(".settings-content");` +
      `var pv=document.querySelector(".editor-preview");` +
      `if(!sc||!pv)return {found:false};` +
      `sc.scrollTop=sc.scrollHeight;` +
      `return {found:true,scrollTop:sc.scrollTop,scrollHeight:sc.scrollHeight};})()`
  )
  await wait(500)
  const stickyRect = await jsonIn(
    s,
    `(function(){var pv=document.querySelector(".editor-preview");if(!pv)return {found:false};` +
      `var r=pv.getBoundingClientRect();var sc=document.querySelector(".settings-content").getBoundingClientRect();` +
      `return {top:Math.round(r.top),bottom:Math.round(r.bottom),viewportBottom:Math.round(window.innerHeight),` +
      `scrollerTop:Math.round(sc.top),saveVisible:(function(){var b=[].slice.call(document.querySelectorAll(".editor-head button"));` +
      `var save=b.filter(function(x){return /保存|Save/.test(x.textContent||"")})[0];if(!save)return false;` +
      `var br=save.getBoundingClientRect();return br.top>=0&&br.bottom<=window.innerHeight;})()};})()`
  )
  write('sticky scroll = ' + JSON.stringify(sticky) + ' rect=' + JSON.stringify(stickyRect))
  check(
    'sticky-preview-pinned',
    stickyRect.found !== false &&
      stickyRect.top >= -2 &&
      stickyRect.bottom <= stickyRect.viewportBottom + 2,
    JSON.stringify(stickyRect)
  )
  check('sticky-save-button-visible', stickyRect.saveVisible === true, JSON.stringify(stickyRect.saveVisible))

  // --------------------------------------------------- 2) 放弃修改 -> 还原
  const back = await jsonIn(s, CLICK_BUTTON('/返回列表|Back to list/'))
  await wait(900)
  const dialog = await jsonIn(
    s,
    `(function(){var box=document.querySelector(".el-message-box");if(!box)return {found:false};` +
      `var bs=[].slice.call(box.querySelectorAll("button"));` +
      `var discard=bs.filter(function(x){return /放弃修改|Discard/.test(x.textContent||"")})[0];` +
      `if(!discard)return {found:true,buttons:bs.map(function(x){return (x.textContent||"").trim()})};` +
      `discard.click();return {found:true,clicked:true};})()`
  )
  write('back=' + JSON.stringify(back) + ' discardDialog=' + JSON.stringify(dialog))
  await wait(1200)

  const reverted = await widgetState(win)
  write('after discard widget = ' + JSON.stringify(reverted))
  check('widget-reverted-after-discard', reverted.title === ITEM_A.name, JSON.stringify(reverted.title))
  check('editor-closed', (await evalIn(s, 'document.querySelectorAll(".editor-head").length')) === 0, 'closed')

  // --------------------------------------- 3) 编辑非当前显示项 -> 卡片不变
  const openedB = await jsonIn(s, OPEN_ROW(1))
  await wait(1200)
  await jsonIn(s, TYPE_INTO('.panel-card input.el-input__inner[maxlength="30"]', '第二项改名了'))
  await wait(1100)
  const afterB = await widgetState(win)
  write('edit non-active row = ' + JSON.stringify(openedB) + ' widget=' + JSON.stringify(afterB))
  check(
    'non-active-edit-keeps-widget',
    afterB.title === ITEM_A.name,
    JSON.stringify(afterB.title)
  )
  const liveTagB = await jsonIn(s, EDITOR_STATE)
  check(
    'no-live-tag-for-non-active',
    (liveTagB.liveTag || '') === '',
    JSON.stringify(liveTagB.liveTag)
  )

  // 返回列表 -> 放弃修改
  await jsonIn(s, CLICK_BUTTON('/返回列表|Back to list/'))
  await wait(900)
  await jsonIn(
    s,
    `(function(){var box=document.querySelector(".el-message-box");if(!box)return {found:false};` +
      `var bs=[].slice.call(box.querySelectorAll("button"));` +
      `var d=bs.filter(function(x){return /放弃修改|Discard/.test(x.textContent||"")})[0];` +
      `if(d)d.click();return {found:true};})()`
  )
  await wait(1000)

  // ------------------------------- 5) 新建项放弃编辑 -> 空白项被删除
  // 注意：编辑子页打开时列表根本不在 DOM 里，所以行数只能在「非编辑态」量。
  // 「新建」会把空白项立刻写进列表（编辑器依赖 props.item 来自 config.countdowns），
  // 因此这里用磁盘上的项数来观察「加进去 -> 又删掉」这条路径。
  const rowsBefore = await evalIn(s, 'document.querySelectorAll(".cd-row").length')
  const itemsBefore = (persisted().countdowns || []).length
  const newClick = await jsonIn(s, CLICK_BUTTON('/新建倒数日|New countdown/'))
  await wait(1200)
  const itemsDuring = (persisted().countdowns || []).length
  const newEditor = await jsonIn(s, EDITOR_STATE)
  await jsonIn(s, CLICK_BUTTON('/返回列表|Back to list/'))
  await wait(1200)
  const itemsAfter = (persisted().countdowns || []).length
  const rowsAfter = await evalIn(s, 'document.querySelectorAll(".cd-row").length')
  write(
    `new-item flow: rowsBefore=${rowsBefore} itemsBefore=${itemsBefore} itemsDuring=${itemsDuring} ` +
      `itemsAfter=${itemsAfter} rowsAfter=${rowsAfter} newEditor=${JSON.stringify(newEditor)} ` +
      `click=${JSON.stringify(newClick)}`
  )
  check('new-item-editor-opened', newEditor.editor === true, JSON.stringify(newEditor))
  check('new-item-added', itemsDuring === itemsBefore + 1, `${itemsBefore} -> ${itemsDuring}`)
  check(
    'new-item-blank-removed',
    itemsAfter === itemsBefore && rowsAfter === rowsBefore,
    `items ${itemsDuring} -> ${itemsAfter}, rows ${rowsBefore} -> ${rowsAfter}`
  )
  check(
    'new-item-not-persisted',
    (persisted().countdowns || []).every((i) => i.id === ITEM_A.id || i.id === ITEM_B.id),
    JSON.stringify((persisted().countdowns || []).map((i) => i.id))
  )

  // 空列表新建：这条空白项会被 normalizeConfig 选成 activeId，放弃时必须一并回退
  await evalIn(s, 'window.cd.updateConfig({countdowns:[], activeId:""}).then(function(){return "ok"})')
  await wait(900)
  const emptyBase = persisted()
  write('emptied list = ' + JSON.stringify({ count: emptyBase.countdowns.length, activeId: emptyBase.activeId }))
  await jsonIn(s, CLICK_BUTTON('/新建倒数日|New countdown/'))
  await wait(1200)
  const emptyDuring = persisted()
  await jsonIn(s, CLICK_BUTTON('/返回列表|Back to list/'))
  await wait(1200)
  const emptyAfter = persisted()
  write(
    'empty-list flow during=' +
      JSON.stringify({ count: emptyDuring.countdowns.length, activeId: emptyDuring.activeId }) +
      ' after=' +
      JSON.stringify({ count: emptyAfter.countdowns.length, activeId: emptyAfter.activeId })
  )
  check(
    'empty-list-new-item-selected',
    emptyDuring.countdowns.length === 1 && emptyDuring.activeId === emptyDuring.countdowns[0].id,
    JSON.stringify({ count: emptyDuring.countdowns.length, activeId: emptyDuring.activeId })
  )
  check(
    'empty-list-discard-rolls-back-active-id',
    emptyAfter.countdowns.length === 0 && emptyAfter.activeId === '',
    JSON.stringify({ count: emptyAfter.countdowns.length, activeId: emptyAfter.activeId })
  )

  // 把列表还原，后面的覆盖层直通检查才有项可看
  await evalIn(
    s,
    `window.cd.updateConfig(${JSON.stringify({ countdowns: [ITEM_A, ITEM_B], activeId: ITEM_A.id })}).then(function(){return "ok"})`
  )
  await wait(900)

  // ------------------- 6) 覆盖层直通：外观覆盖实时生效 + 清空即回落
  const draftWithAppearance = {
    ...ITEM_A,
    name: '外观实时预览',
    appearance: { background: { color: '#ff0055', radius: 30 } }
  }
  await evalIn(
    s,
    `window.cd.setPreviewItem(${JSON.stringify(draftWithAppearance)}).then(function(){return "ok"})`
  )
  await wait(1000)
  const styled = await widgetState(win)
  write('appearance draft widget = ' + JSON.stringify(styled))
  check('draft-appearance-applied', styled.title === '外观实时预览', JSON.stringify(styled.title))
  check(
    'draft-background-applied',
    /255,\s*0,\s*85/.test(styled.bg) && styled.radius.startsWith('30px'),
    `bg=${styled.bg} radius=${styled.radius}`
  )

  await evalIn(s, 'window.cd.setPreviewItem(null).then(function(){return "ok"})')
  await wait(1000)
  const cleared = await widgetState(win)
  write('after clearing overlay = ' + JSON.stringify(cleared))
  check('overlay-cleared-reverts', cleared.title === ITEM_A.name, JSON.stringify(cleared.title))
  check(
    'overlay-cleared-restores-global-style',
    !/255,\s*0,\s*85/.test(cleared.bg),
    JSON.stringify(cleared.bg)
  )

  // 设置窗口隐藏时主进程也要丢掉覆盖层
  await evalIn(
    s,
    `window.cd.setPreviewItem(${JSON.stringify(draftWithAppearance)}).then(function(){return "ok"})`
  )
  await wait(800)
  s.hide()
  await wait(1000)
  const afterHide = await widgetState(win)
  write('after hiding settings = ' + JSON.stringify(afterHide))
  check('hide-settings-clears-overlay', afterHide.title === ITEM_A.name, JSON.stringify(afterHide.title))

  write(`SUMMARY failures=${failures}`)
  write('done')
  app.exit(failures === 0 ? 0 : 2)
})
