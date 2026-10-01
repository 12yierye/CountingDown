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
const probeRoot = path.join(appRoot, '.probe-userdata')
fs.mkdirSync(outDir, { recursive: true })

/**
 * 每次运行用一份**独立**的 userData。
 *
 * 应用的单实例锁是按 userData 目录加的：如果固定复用同一个目录，上一次运行留下的
 * 残留进程（例如调试时被强制中断的那次）会一直握着锁，下一次运行就会在
 * `requestSingleInstanceLock()` 失败后直接 `app.quit()` —— 表现为「跑完了但一条结果都没有」。
 * 顺带也避免了上一次的 GPU 缓存文件还被占用、rmSync 抛 EPERM 的问题。
 */
const userData = path.join(probeRoot, `preview-${Date.now().toString(36)}`)
fs.mkdirSync(userData, { recursive: true })

// 顺手清掉历史运行留下的目录；被占用就跳过，绝不影响本次验证
try {
  for (const entry of fs.readdirSync(probeRoot)) {
    if (!entry.startsWith('preview-')) continue
    const full = path.join(probeRoot, entry)
    if (full === userData) continue
    try {
      fs.rmSync(full, { recursive: true, force: true, maxRetries: 1, retryDelay: 50 })
    } catch (error) {
      /* 上一个实例可能还占着，留着即可 */
    }
  }
} catch (error) {
  /* probeRoot 不可读就算了 */
}

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

/** 只写日志文件。异常处理走这条，避免「报告异常时又踩一次同样的坑」。 */
function appendLog(text) {
  try {
    fs.appendFileSync(logFile, text + '\n')
  } catch (error) {
    /* ignore */
  }
}

/**
 * 下游管道一旦提前关闭（例如 `... | Select-Object -First 5`），stdout 会发出
 * **异步**的 EPIPE 错误事件：`process.stdout.write()` 本身不抛，错误走 'error' 事件，
 * 于是变成 uncaughtException；如果异常处理里再往 stdout 写一次，就再触发一次 EPIPE，
 * 无限递归刷屏并把进程拖死（实测刷出过 59 万字节）。所以这里一次性掐断。
 */
let stdoutBroken = false
process.stdout.on('error', (error) => {
  if (error && error.code === 'EPIPE') stdoutBroken = true
})

const write = (line) => {
  const text = typeof line === 'string' ? line : JSON.stringify(line)
  appendLog(text)
  if (stdoutBroken) return
  try {
    process.stdout.write(text + '\n')
  } catch (error) {
    if (error && error.code === 'EPIPE') stdoutBroken = true
  }
}

let failures = 0
function check(name, ok, detail) {
  if (!ok) failures += 1
  write(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`)
}

process.on('uncaughtException', (error) => {
  // 管道提前关闭不是被测程序的问题，静默忽略，更不要回写 stdout
  if (error && error.code === 'EPIPE') {
    stdoutBroken = true
    return
  }
  appendLog('MAIN_UNCAUGHT ' + (error && error.stack))
})
app.setPath('userData', userData)

const main = require(path.join(appRoot, 'out/main/index.js'))

write('harness started pid=' + process.pid + ' userData=' + userData)
/**
 * 没抢到单实例锁时主进程会立刻 app.quit()，此时下面的 whenReady 根本不会跑，
 * 表现是「命令跑完了但一条 PASS/FAIL 都没有」。留一条痕迹方便一眼看出原因。
 * （正常收尾走 app.exit()，不会触发 will-quit。）
 */
app.on('will-quit', () => write('EARLY_QUIT pid=' + process.pid + ' (single-instance lock held?)'))

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

/**
 * 轮询等待组件窗口达到期望状态，而不是固定 sleep。
 * 固定等待在机器忙的时候（例如同时跑了两份实例）会假失败 —— 实测并发跑时
 * 1.1s 的等待不够，刷出 5 条本不该有的 FAIL。
 */
async function waitForWidget(win, predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  let state = null
  for (;;) {
    state = await widgetState(win)
    if (predicate(state)) return { ok: true, state }
    if (Date.now() >= deadline) return { ok: false, state }
    await wait(120)
  }
}

/**
 * 编辑页现在不再自带预览（全局设置页那份统一预览样板取而代之），
 * 因此「草稿确实发出去了」改为读主进程里的草稿覆盖层：
 * 它是纯内存的，只有编辑页真的发布了草稿才会存在，读它不写盘、也不影响断言。
 */
async function waitForDraftOverlay(expectedName, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  let seen = null
  for (;;) {
    try {
      seen = main.previewOverlay()?.name ?? null
    } catch (error) {
      seen = null
    }
    if (seen === expectedName) return seen
    if (Date.now() >= deadline) return seen
    await wait(120)
  }
}

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

  const live = await waitForWidget(win, (state) => state.title === TYPED)
  write('after typing widget = ' + JSON.stringify(live.state))
  check('widget-follows-draft-name', live.ok, JSON.stringify(live.state.title))
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
  const live2 = await waitForWidget(win, (state) => state.hint === '实时预览副标题')
  write('after hint typing widget = ' + JSON.stringify(live2.state))
  check('widget-follows-draft-hint', live2.ok, JSON.stringify(live2.state.hint))

  // ------------------------------------------------------------ 4) 吸顶操作栏
  // 编辑页已不再自带吸顶预览（全局设置页有统一的预览样板），
  // 但返回 / 保存这条操作栏必须仍然吸顶，且滚到底部时保存按钮依然可见。
  const sticky = await jsonIn(
    s,
    `(function(){var sc=document.querySelector(".settings-content");` +
      `var pv=document.querySelector(".editor-preview");` +
      `var bar=document.querySelector(".editor-sticky");` +
      `if(!sc||!bar)return {found:false};` +
      `sc.scrollTop=sc.scrollHeight;` +
      `return {found:true,hasOldPreview:!!pv,scrollTop:sc.scrollTop,scrollHeight:sc.scrollHeight};})()`
  )
  await wait(500)
  const stickyRect = await jsonIn(
    s,
    `(function(){var bar=document.querySelector(".editor-sticky");if(!bar)return {found:false};` +
      `var r=bar.getBoundingClientRect();var sc=document.querySelector(".settings-content").getBoundingClientRect();` +
      `return {top:Math.round(r.top),bottom:Math.round(r.bottom),viewportBottom:Math.round(window.innerHeight),` +
      `scrollerTop:Math.round(sc.top),saveVisible:(function(){var b=[].slice.call(document.querySelectorAll(".editor-head button"));` +
      `var save=b.filter(function(x){return /保存|Save/.test(x.textContent||"")})[0];if(!save)return false;` +
      `var br=save.getBoundingClientRect();return br.top>=0&&br.bottom<=window.innerHeight;})()};})()`
  )
  write('sticky scroll = ' + JSON.stringify(sticky) + ' rect=' + JSON.stringify(stickyRect))
  check(
    'editor-sticky-bar-pinned',
    stickyRect.found !== false &&
      stickyRect.top >= -2 &&
      stickyRect.bottom <= stickyRect.viewportBottom + 2,
    JSON.stringify(stickyRect)
  )
  check(
    'editor-has-no-sticky-preview',
    sticky.hasOldPreview === false,
    '编辑页不应再有 .editor-preview 容器'
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

  const reverted = await waitForWidget(win, (state) => state.title === ITEM_A.name)
  write('after discard widget = ' + JSON.stringify(reverted.state))
  check('widget-reverted-after-discard', reverted.ok, JSON.stringify(reverted.state.title))
  check('editor-closed', (await evalIn(s, 'document.querySelectorAll(".editor-head").length')) === 0, 'closed')

  // --------------------------------------- 3) 编辑非当前显示项 -> 卡片不变
  const openedB = await jsonIn(s, OPEN_ROW(1))
  await wait(1200)
  await jsonIn(s, TYPE_INTO('.panel-card input.el-input__inner[maxlength="30"]', '第二项改名了'))
  // 「卡片不变」这个断言没法靠轮询等出来，所以先证明草稿**确实发出去了**
  // （读主进程里的草稿覆盖层，纯内存），再去看桌面卡片有没有跟着动。
  const draftOverlay = await waitForDraftOverlay('第二项改名了')
  const afterB = await widgetState(win)
  write(
    'edit non-active row = ' +
      JSON.stringify(openedB) +
      ' draftOverlay=' +
      JSON.stringify(draftOverlay) +
      ' widget=' +
      JSON.stringify(afterB)
  )
  check(
    'non-active-draft-published',
    draftOverlay === '第二项改名了',
    JSON.stringify(draftOverlay)
  )
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
  const styled = await waitForWidget(win, (state) => state.title === '外观实时预览')
  write('appearance draft widget = ' + JSON.stringify(styled.state))
  check('draft-appearance-applied', styled.ok, JSON.stringify(styled.state.title))
  check(
    'draft-background-applied',
    /255,\s*0,\s*85/.test(styled.state.bg) && styled.state.radius.startsWith('30px'),
    `bg=${styled.state.bg} radius=${styled.state.radius}`
  )

  await evalIn(s, 'window.cd.setPreviewItem(null).then(function(){return "ok"})')
  const cleared = await waitForWidget(win, (state) => state.title === ITEM_A.name)
  write('after clearing overlay = ' + JSON.stringify(cleared.state))
  check('overlay-cleared-reverts', cleared.ok, JSON.stringify(cleared.state.title))
  check(
    'overlay-cleared-restores-global-style',
    !/255,\s*0,\s*85/.test(cleared.state.bg),
    JSON.stringify(cleared.state.bg)
  )

  // 设置窗口隐藏时主进程也要丢掉覆盖层
  await evalIn(
    s,
    `window.cd.setPreviewItem(${JSON.stringify(draftWithAppearance)}).then(function(){return "ok"})`
  )
  await waitForWidget(win, (state) => state.title === '外观实时预览')
  s.hide()
  const afterHide = await waitForWidget(win, (state) => state.title === ITEM_A.name)
  write('after hiding settings = ' + JSON.stringify(afterHide.state))
  check('hide-settings-clears-overlay', afterHide.ok, JSON.stringify(afterHide.state.title))

  write(`SUMMARY failures=${failures}`)
  write('done')
  app.exit(failures === 0 ? 0 : 2)
})
