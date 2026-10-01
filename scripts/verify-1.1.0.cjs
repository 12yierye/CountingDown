// 1.1.0 变更验证：显示格式 / 分隔符 / 文字透明度 / 天数单位 / 全局预览 /
//                偏移方向 / 点击穿透 / 托盘菜单 / 预设保存与查看参数
const { app, BrowserWindow, Tray, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
const probeRoot = path.join(appRoot, '.probe-userdata')
fs.mkdirSync(outDir, { recursive: true })

const userData = path.join(probeRoot, `v110-${Date.now().toString(36)}`)
fs.mkdirSync(userData, { recursive: true })

try {
  for (const entry of fs.readdirSync(probeRoot)) {
    if (!entry.startsWith('v110-')) continue
    const full = path.join(probeRoot, entry)
    if (full === userData) continue
    try {
      fs.rmSync(full, { recursive: true, force: true, maxRetries: 1, retryDelay: 50 })
    } catch (error) {
      /* 上一次的实例可能还占着 */
    }
  }
} catch (error) {
  /* ignore */
}

/**
 * 目标日期取「明天」，这样无论今天几号，天/时/分/秒都有确定的值，
 * 显示格式（分隔符、单位）的断言才有意义。
 */
const tomorrow = new Date(Date.now() + 86_400_000)
const pad = (n) => String(n).padStart(2, '0')
const tomorrowIso = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T23:59`

const ITEM = {
  id: 'probe_110',
  name: '元旦',
  enabled: true,
  target: { mode: 'once', date: tomorrowIso, month: 1, day: 1 },
  text: {
    hint: '1 月 1 日',
    futureText: '还有 {days} 天',
    todayText: '就在今天！',
    pastText: '已远去',
    unit: '天',
    showHint: 'inherit',
    showStatus: 'inherit',
    showUnit: 'inherit'
  },
  separator: { enabled: false, hm: '', ms: '' },
  appearance: {}
}

fs.writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify(
    {
      config: {
        countdowns: [ITEM],
        activeId: ITEM.id,
        behavior: {
          displayMode: 'days',
          showDaysInPrecise: true,
          separatorHM: '时',
          separatorMS: '分',
          showPastDays: false,
          alwaysOnTop: true
        },
        runtime: {
          widgetVisible: true,
          toggleHotkey: '',
          language: 'zh-CN',
          window: { corner: 'top-right', cornerPreset: 'top-right', transparent: true }
        }
      }
    },
    null,
    '\t'
  )
)

const logFile = path.join(outDir, 'changes-110.log')
fs.writeFileSync(logFile, 'start ' + new Date().toISOString() + '\n')

let stdoutBroken = false
process.stdout.on('error', (error) => {
  if (error && error.code === 'EPIPE') stdoutBroken = true
})

const write = (line) => {
  const text = typeof line === 'string' ? line : JSON.stringify(line)
  try {
    fs.appendFileSync(logFile, text + '\n')
  } catch (error) {
    /* ignore */
  }
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
  if (error && error.code === 'EPIPE') {
    stdoutBroken = true
    return
  }
  write('MAIN_UNCAUGHT ' + (error && error.stack))
})

app.setPath('userData', userData)

// Tray 是只读 getter，无法替换构造器；从原型方法里抓实例与菜单
let capturedTray = null
let capturedMenu = null
const originalSetContextMenu = Tray.prototype.setContextMenu
Tray.prototype.setContextMenu = function patched(menu) {
  capturedTray = this
  capturedMenu = menu
  return originalSetContextMenu.call(this, menu)
}

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
    return 'EVAL_FAIL ' + String(error)
  }
}

/** 读取组件窗口里卡片的实际渲染文本 */
const CARD_TEXT = `JSON.stringify((function(){
  var card = document.querySelector('.cd-card');
  if (!card) return { missing: true };
  var title = card.querySelector('.cd-card__title');
  var precise = card.querySelector('.cd-card__precise');
  var count = card.querySelector('.cd-card__count');
  var hint = card.querySelector('.cd-card__hint');
  var status = card.querySelector('.cd-card__status');
  function parts(root){
    if (!root) return null;
    return Array.prototype.map.call(root.querySelectorAll('.cd-card__precision-part'), function(p){
      var n = p.querySelector('.cd-card__number');
      var s = p.querySelector('small');
      return { value: n ? n.textContent : '', label: s ? s.textContent : '' };
    });
  }
  return {
    title: title ? title.textContent.trim() : null,
    count: count ? count.textContent.replace(/\\s+/g,' ').trim() : null,
    hasUnit: !!(count && count.querySelector('.cd-card__unit')),
    parts: parts(precise),
    hint: hint ? hint.textContent.trim() : null,
    status: status ? status.textContent.trim() : null,
    titleColor: title ? getComputedStyle(title).color : null,
    hintColor: hint ? getComputedStyle(hint).color : null,
    cardBg: getComputedStyle(card).backgroundColor
  };
})())`

async function readCard(win) {
  const raw = await ev(win, CARD_TEXT)
  if (typeof raw !== 'string' || raw.startsWith('EVAL_FAIL')) return { error: raw }
  try {
    return JSON.parse(raw)
  } catch (error) {
    return { error: 'parse fail ' + raw }
  }
}

async function patch(win, body) {
  return ev(win, `window.cd.updateConfig(${JSON.stringify(body)}).then(function(){return 'ok'}).catch(function(e){return 'ERR '+e})`)
}

/**
 * 探针脚本：给定屏幕坐标，返回该点当前归属的顶层窗口标题。
 * 用真实的 WindowFromPoint，因此它如实反映「点击会落到谁身上」。
 *
 * 脚本落成临时 .ps1 用 -File 执行：`-Command` 传中文 + 中文控制台代码页会把
 * 输出变成乱码，判定「是不是组件窗口」时完全不可靠。
 */
const PROBE_SCRIPT = `param([int]$X, [int]$Y)
$sig = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class WinProbe {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public static List<IntPtr> List() {
    var outp = new List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      if (GetWindowTextLengthW(h) <= 0) return true;
      outp.Add(h);
      return true;
    }, IntPtr.Zero);
    return outp;
  }
  public static string Title(IntPtr h) {
    var sb = new StringBuilder(1024);
    GetWindowTextW(h, sb, 1024);
    return sb.ToString();
  }
  public static void HideTopmostOthers() {
    foreach (var h in List()) {
      string t = Title(h);
      if (t.IndexOf("Visual Studio Code") >= 0 || t.IndexOf("Microsoft Edge") >= 0 ||
          t.IndexOf("Google Chrome") >= 0) {
        ShowWindow(h, 6);
      }
    }
  }
}
'@
Add-Type -TypeDefinition $sig
try { [WinProbe]::HideTopmostOthers() } catch { }
$p = New-Object WinProbe+POINT
$p.X = $X
$p.Y = $Y
$best = ''
for ($i = 0; $i -lt 4; $i++) {
  [WinProbe]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 200
  $h = [WinProbe]::WindowFromPoint($p)
  $root = [WinProbe]::GetAncestor($h, 2)
  $title = [WinProbe]::Title($root)
  if ($title -eq $best -and $title -ne '') { break }
  $best = $title
}
$hex = ''
foreach ($ch in $best.ToCharArray()) { $hex += ('{0:X4} ' -f [int]$ch) }
Write-Output ('TITLE ' + $hex.Trim())
`

let probeFile = null

/** 探针结果缓存：同一坐标的重复查询走了 350ms 稳定循环，没必要每次都付这个代价 */
const probeCache = new Map()

/**
 * 返回该屏幕坐标当前归属的顶层窗口标题。
 *
 * 返回的标题可能是乱码（控制台代码页问题），所以断言只看编码前的字符：
 * 这里把标题转成 UTF-16 码点串，再用码点匹配「倒数日 / 设置」，避免编码影响判定。
 */
function windowAt(x, y, useCache = true) {
  const key = `${Math.round(x)},${Math.round(y)}`
  if (useCache && probeCache.has(key)) return probeCache.get(key)
  let result = { raw: '', text: '' }
  try {
    if (!probeFile) probeFile = path.join(userData, 'probe-window.ps1')
    fs.writeFileSync(probeFile, '\uFEFF' + PROBE_SCRIPT, 'utf8')
    const out = require('node:child_process').execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        probeFile,
        '-X',
        String(Math.round(x)),
        '-Y',
        String(Math.round(y))
      ],
      { encoding: 'utf8', timeout: 30000 }
    )
    const raw = String(out).replace(/^\uFEFF/, '').trim()
    const match = /TITLE\s+([0-9A-Fa-f ]*)/.exec(raw)
    const codepoints = (match ? match[1].trim().split(/\s+/) : []).filter(Boolean).map((h) => parseInt(h, 16))
    result = { raw, text: String.fromCodePoint(...codepoints) }
  } catch (error) {
    result = { raw: 'PROBE_FAIL ' + String(error), text: '' }
  }
  if (useCache) probeCache.set(key, result)
  return result
}

/** 该点归属的窗口是不是组件窗口（标题为「倒数日」，不含「设置」） */
function isWidgetWindow(x, y, useCache = true) {
  const { text } = windowAt(x, y, useCache)
  return text.includes('倒数日') && !text.includes('设置')
}

function isSettingsWindow(x, y, useCache = true) {
  return windowAt(x, y, useCache).text.includes('设置')
}

/** 移动到该点并返回归属窗口；用于「当前归属」与「穿透后归属」的对比 */
function settleAt(x, y) {
  probeCache.delete(`${Math.round(x)},${Math.round(y)}`)
  return windowAt(x, y)
}

app.whenReady().then(async () => {
  await wait(4500)
  const win = widget()
  if (!win) {
    write('FAIL 没有组件窗口')
    app.exit(1)
    return
  }

  /* ---------------- 1. days 模式的单位开关 ---------------- */
  let card = await readCard(win)
  check('days 模式默认显示天数单位', card.hasUnit === true, JSON.stringify(card))

  await patch(win, { text: { showUnit: false } })
  await wait(700)
  card = await readCard(win)
  check('全局关闭天数单位后大数字后面不再有「天」', card.hasUnit === false, JSON.stringify(card))

  // 单项三态覆盖优先于全局：单项强制显示
  await patch(win, { countdowns: [{ ...ITEM, text: { ...ITEM.text, showUnit: 'show' } }] })
  await wait(700)
  card = await readCard(win)
  check('单项 showUnit=show 覆盖掉全局的关闭', card.hasUnit === true, JSON.stringify(card))

  await patch(win, { text: { showUnit: true }, countdowns: [ITEM] })
  await wait(700)

  /* ---------------- 2. 三种时分秒模式的格式 ---------------- */
  await patch(win, { behavior: { displayMode: 'days-hours' } })
  await wait(700)
  card = await readCard(win)
  {
    const labels = (card.parts || []).map((p) => p.label)
    const text = (card.parts || []).map((p) => `${p.value}${p.label}`).join(' ')
    check(
      '天+时 显示 D天H时 且没有任何冒号',
      labels.length === 2 && labels[0] === '天' && labels[1] === '时' && !text.includes(':'),
      `${text} (${JSON.stringify(labels)})`
    )
  }

  await patch(win, { behavior: { displayMode: 'days-hours-minutes' } })
  await wait(700)
  card = await readCard(win)
  {
    const labels = (card.parts || []).map((p) => p.label)
    const text = (card.parts || []).map((p) => `${p.value}${p.label}`).join(' ')
    check(
      '天+时分 为 D天H时M分 且没有冒号，末段不带分隔符',
      labels.length === 3 &&
        labels[0] === '天' &&
        labels[1] === '时' &&
        labels[2] === '分' &&
        !text.includes(':'),
      `${text} (${JSON.stringify(labels)})`
    )
  }

  // 「时与分之间」这一档在两种模式下必须是同一个设置，不能只在其中一种生效
  await patch(win, { behavior: { separatorHM: '时', separatorMS: '|' } })
  await wait(700)
  card = await readCard(win)
  {
    const labels = (card.parts || []).map((p) => p.label)
    check(
      '天+时分 模式使用「时与分之间」分隔符',
      labels[1] === '时' && labels[2] === '|',
      JSON.stringify(labels)
    )
  }

  await patch(win, { behavior: { displayMode: 'precise' } })
  await wait(700)
  card = await readCard(win)
  {
    const labels = (card.parts || []).map((p) => p.label)
    const text = (card.parts || []).map((p) => `${p.value}${p.label}`).join(' ')
    check(
      '天+时分秒 为 D天H时M分S，末段不带分隔符',
      labels.length === 4 &&
        labels[0] === '天' &&
        labels[1] === '时' &&
        labels[2] === '|' &&
        labels[3] === '' &&
        !text.includes(':'),
      `${text} (${JSON.stringify(labels)})`
    )
  }

  /* ---------------- 3. 自定义分隔符（全局） ---------------- */
  await patch(win, { behavior: { separatorHM: ':', separatorMS: ':' } })
  await wait(700)
  card = await readCard(win)
  {
    const labels = (card.parts || []).map((p) => p.label)
    check(
      '全局分隔符换成冒号后立即生效',
      labels[1] === ':' && labels[2] === ':' && labels[3] === '',
      JSON.stringify(labels)
    )
  }

  await patch(win, { behavior: { separatorHM: '/', separatorMS: ' 秒 ' } })
  await wait(700)
  card = await readCard(win)
  {
    const labels = (card.parts || []).map((p) => p.label)
    check('分隔符支持任意自定义文本', labels[1] === '/' && labels[2] === ' 秒 ', JSON.stringify(labels))
  }

  /* ---------------- 4. 单项覆盖分隔符 ---------------- */
  await patch(win, {
    behavior: { separatorHM: '时', separatorMS: '分' },
    countdowns: [{ ...ITEM, separator: { enabled: true, hm: '-', ms: '~' } }]
  })
  await wait(700)
  card = await readCard(win)
  {
    const labels = (card.parts || []).map((p) => p.label)
    check(
      '单项分隔符覆盖掉全局',
      labels[1] === '-' && labels[2] === '~',
      JSON.stringify(labels)
    )
  }

  await patch(win, { countdowns: [ITEM] })
  await wait(700)
  card = await readCard(win)
  {
    const labels = (card.parts || []).map((p) => p.label)
    check('取消单项覆盖后回到全局分隔符', labels[1] === '时' && labels[2] === '分', JSON.stringify(labels))
  }

  /* ---------------- 5. 文字透明度与背景透明度相互独立 ---------------- */
  await patch(win, { behavior: { displayMode: 'days' } })
  await wait(700)
  card = await readCard(win)
  const bgBefore = card.cardBg
  const titleBefore = card.titleColor

  await patch(win, {
    appearance: {
      textAlpha: 0.4,
      title: { fontSize: 16, color: '#ffffff', weight: 500, letterSpacing: 0, opacity: 0.5 }
    }
  })
  await wait(700)
  card = await readCard(win)
  {
    const alpha = (color) => {
      const m = /rgba?\(([^)]+)\)/.exec(color || '')
      if (!m) return null
      const p = m[1].split(',').map((x) => parseFloat(x))
      return p.length > 3 ? p[3] : 1
    }
    const titleAlpha = alpha(card.titleColor)
    check(
      '文字透明度 = 总开关 × 单项透明度（0.4 × 0.5 = 0.2）',
      titleAlpha !== null && Math.abs(titleAlpha - 0.2) < 0.02,
      `${card.titleColor} -> ${titleAlpha}`
    )
    check('背景颜色不受文字透明度影响', card.cardBg === bgBefore, `${bgBefore} -> ${card.cardBg}`)
    check('调文字透明度之前标题色不同', titleBefore !== card.titleColor, `${titleBefore} -> ${card.titleColor}`)
  }

  // 背景透明度只影响背景
  await patch(win, { appearance: { background: { alpha: 0.3 } } })
  await wait(700)
  card = await readCard(win)
  {
    const alpha = (color) => {
      const m = /rgba?\(([^)]+)\)/.exec(color || '')
      if (!m) return null
      const p = m[1].split(',').map((x) => parseFloat(x))
      return p.length > 3 ? p[3] : 1
    }
    check(
      '背景透明度独立生效且不影响文字透明度',
      Math.abs(alpha(card.cardBg) - 0.3) < 0.02 && Math.abs(alpha(card.titleColor) - 0.2) < 0.02,
      `bg=${card.cardBg} title=${card.titleColor}`
    )
  }

  /* ---------------- 6. 显示模式与分隔符覆盖的 UI ---------------- */
  await patch(win, {
    appearance: { textAlpha: 1, background: { alpha: 0.78 }, title: { fontSize: 16, color: '#b9dcff', weight: 500, letterSpacing: 0, opacity: 1 } }
  })
  await wait(500)

  main.openSettingsWindow()
  await wait(4500)
  const s = settings()
  if (!s) {
    check('设置窗口打开', false, 'missing')
  } else {
    const nav = async (label) => {
      await ev(
        s,
        `(function(){var btns=Array.prototype.slice.call(document.querySelectorAll('.settings-nav__item'));var hit=btns.find(function(b){return b.textContent.indexOf(${JSON.stringify(label)})>=0});if(hit){hit.click();return 'ok';}return 'missing';})()`
      )
      await wait(700)
    }

    // 外观页：确认「组件不透明度」已经不存在，且文字透明度存在
    await nav('外观')
    const appearanceText = await ev(s, `document.querySelector('.settings-content').innerText`)
    check(
      '外观页不再有「组件不透明度」设置项',
      typeof appearanceText === 'string' && !appearanceText.includes('组件不透明度'),
      'checked settings-content text'
    )
    check(
      '外观页出现「文字透明度」',
      typeof appearanceText === 'string' && appearanceText.includes('文字透明度'),
      'checked settings-content text'
    )
    check(
      '透明度滑块标签是「透明度」而不是 α',
      typeof appearanceText === 'string' && !appearanceText.includes('α'),
      'no greek alpha anywhere on the appearance panel'
    )

    // 实时预览：标签与预览容器之间要有可见间距，别贴着
    const previewGap = await ev(
      s,
      `JSON.stringify((function(){
         var label = document.querySelector('.preview-wrap__label');
         var card = document.querySelector('.preview-wrap .cd-card');
         if (!label || !card) return { found:false };
         var lr = label.getBoundingClientRect();
         var cr = card.getBoundingClientRect();
         return { found:true, gap: Math.round(cr.top - lr.bottom), label: label.textContent.trim(), cards: document.querySelectorAll('.preview-wrap .cd-card').length };
       })())`
    )
    {
      const parsed = JSON.parse(previewGap)
      check(
        '「实时预览」与预览容器之间留有间距',
        parsed.found === true && parsed.gap >= 10,
        JSON.stringify(parsed)
      )
      check(
        '全局预览只渲染一张卡片',
        parsed.found === true && parsed.cards === 1,
        JSON.stringify(parsed)
      )
    }

    // 行为页：显示模式选项文案必须是真实格式
    await nav('行为')
    const behaviorHtml = await ev(
      s,
      `Array.prototype.map.call(document.querySelectorAll('.el-radio-button__inner'), function(e){return e.textContent.trim();}).join(' | ')`
    )
    check(
      '显示模式选项展示真实格式（D天H时 等）',
      typeof behaviorHtml === 'string' &&
        /天 \+ 时 \+ 分/.test(behaviorHtml) === false &&
        behaviorHtml.includes('天') &&
        behaviorHtml.includes('时'),
      String(behaviorHtml)
    )
    const behaviorText = await ev(s, `document.querySelector('.settings-content').innerText`)
    check(
      '行为页提供两个分隔符设置项',
      typeof behaviorText === 'string' &&
        behaviorText.includes('天与小时之间') &&
        behaviorText.includes('时与分'),
      'checked settings-content text'
    )

    // 布局页：偏移量标签方向、鼠标点击穿透
    await nav('布局')
    const layoutLabels = await ev(
      s,
      `JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.settings-content .field-row__text'), function(e){return e.textContent.trim()}))`
    )
    {
      const parsed = typeof layoutLabels === 'string' ? JSON.parse(layoutLabels) : []
      check(
        '右上角基准时偏移量标签为「向左偏移 / 向下偏移」',
        parsed.includes('向左偏移') && parsed.includes('向下偏移') && !parsed.includes('向上偏移'),
        String(layoutLabels)
      )
    }
    const layoutHtml = await ev(s, `document.querySelector('.settings-content').innerText`)
    check(
      '布局页有「鼠标点击穿透」开关',
      typeof layoutHtml === 'string' && layoutHtml.includes('鼠标点击穿透'),
      'checked settings-content text'
    )

    // 系统集成页：托盘菜单内容 + 没有预览
    await nav('系统集成')
    const integrationText = await ev(s, `document.querySelector('.settings-content').innerText`)
    check(
      '系统集成页可以配置右键菜单内容',
      typeof integrationText === 'string' && integrationText.includes('右键菜单内容'),
      'checked settings-content text'
    )
    check(
      '系统集成页的快捷键标题不再写「（显示 / 隐藏）」',
      typeof integrationText === 'string' && integrationText.includes('全局快捷键'),
      'checked settings-content text'
    )
    const previewOnIntegration = await ev(s, `!!document.querySelector('.settings-preview')`)
    check('系统集成页不再显示预览', previewOnIntegration === false, String(previewOnIntegration))

    await nav('关于')
    const previewOnAbout = await ev(s, `!!document.querySelector('.settings-preview')`)
    check('关于页不再显示预览', previewOnAbout === false, String(previewOnAbout))

    // 预设页：保存模态框的三个来源 + 查看参数
    await nav('预设主题')
    const presetText = await ev(s, `document.querySelector('.settings-content').innerText`)
    check(
      '预设卡片有「查看参数」入口',
      typeof presetText === 'string' && presetText.includes('查看参数'),
      'checked settings-content text'
    )
    const viewButtons = await ev(
      s,
      `Array.prototype.filter.call(document.querySelectorAll('.preset-footer__actions button'), function(b){return b.textContent.indexOf('查看参数')>=0}).length`
    )
    check('内置与自定义预设都能查看参数', typeof viewButtons === 'number' && viewButtons >= 5, `buttons=${viewButtons}`)

    // 打开查看参数对话框，确认不套用也能读到具体数值
    await ev(
      s,
      `(function(){var b=Array.prototype.find.call(document.querySelectorAll('.preset-footer__actions button'), function(x){return x.textContent.indexOf('查看参数')>=0});if(b)b.click();return 'ok';})()`
    )
    await wait(900)
    const detailText = await ev(
      s,
      `(function(){var d=document.querySelector('.el-dialog');return d?d.innerText:'';})()`
    )
    check(
      '查看参数对话框展示外观参数与文案',
      typeof detailText === 'string' &&
        detailText.includes('背景透明度') &&
        detailText.includes('大数字') &&
        detailText.includes('还有 {days} 天'),
      String(detailText).slice(0, 300)
    )
    const appearanceUnchanged = await ev(
      s,
      `window.cd.getConfig().then(function(c){return JSON.stringify(c.appearance.title)})`
    )
    check(
      '查看参数不会改动任何设置',
      typeof appearanceUnchanged === 'string' && appearanceUnchanged.includes('#b9dcff'),
      String(appearanceUnchanged)
    )
    // 关掉对话框
    await ev(
      s,
      `(function(){var b=Array.prototype.find.call(document.querySelectorAll('.el-dialog__footer button'), function(x){return x.textContent.trim()==='关闭'});if(b)b.click();return 'ok';})()`
    )
    await wait(600)

    // 保存预设：点开后必须先问「保存哪一份」
    await ev(
      s,
      `(function(){var b=Array.prototype.find.call(document.querySelectorAll('.panel-card__header button'), function(x){return x.textContent.indexOf('保存当前外观')>=0});if(b)b.click();return 'ok';})()`
    )
    await wait(900)
    const saveDialog = await ev(
      s,
      `(function(){var d=document.querySelector('.el-dialog');return d?d.innerText:'';})()`
    )
    check(
      '保存预设先弹出模态框询问来源',
      typeof saveDialog === 'string' &&
        saveDialog.includes('当前全局外观') &&
        saveDialog.includes('某个倒数日的外观覆盖') &&
        saveDialog.includes('手动调整所有参数'),
      String(saveDialog).slice(0, 300)
    )

    // 文案与格式化：过期后显示的问号说明
    await nav('日期与文案')
    const targetText = await ev(s, `document.querySelector('.settings-content').innerText`)
    check(
      '「过期后显示」已改名，且不再把「已过去 N 天」写在标题里',
      typeof targetText === 'string' &&
        targetText.includes('过期后显示') &&
        !targetText.includes('过期后显示“已过去 N 天”'),
      'checked settings-content text'
    )
  }

  /* ---------------- 7. 托盘菜单：可配置内容 + 设置/退出常驻 ---------------- */
  {
    const labels = () => (capturedMenu ? capturedMenu.items.map((i) => String(i.label || `<${i.type}>`)) : [])
    check('托盘菜单可捕获', Boolean(capturedTray), 'tray instance')
    check(
      '托盘菜单默认包含全部条目',
      labels().some((l) => l.includes('吸附')) && labels().some((l) => l.includes('设置')),
      labels().join(' | ')
    )

    await ev(widget(), `window.cd.updateConfig({runtime:{trayMenu:{resetPosition:false, startAtLogin:false}}}).then(function(){return window.cd.refreshTray()}).then(function(){return 'ok'})`)
    await wait(900)
    check(
      '关掉「吸附到右上角」与「开机自动启动」后菜单里不再出现',
      !labels().some((l) => l.includes('吸附')) && !labels().some((l) => l.includes('开机')),
      labels().join(' | ')
    )
    check(
      '「设置」与「退出」始终保留',
      labels().some((l) => l.includes('设置')) && labels().some((l) => l.includes('退出')),
      labels().join(' | ')
    )

    await ev(widget(), `window.cd.updateConfig({runtime:{trayMenu:{resetPosition:true}}})`)
    await wait(700)
    check('重新打开后条目回来', labels().some((l) => l.includes('吸附')), labels().join(' | '))
  }

  /* ---------------- 8. 偏移量方向 ---------------- */
  {
    const area = screen.getPrimaryDisplay().workArea
    await ev(widget(), `window.cd.updateConfig({runtime:{window:{corner:'top-right',cornerPreset:'top-right',offsetX:0,offsetY:0}}})`)
    await wait(900)
    const zero = widget().getBounds()

    await ev(widget(), `window.cd.updateConfig({runtime:{window:{offsetX:120}}})`)
    await wait(900)
    const left = widget().getBounds()
    check(
      '右上角基准下正偏移向左移动（负值才向右）',
      zero.x - left.x === 120,
      `x: ${zero.x} -> ${left.x} (期望左移 120)`
    )
    check('向右偏移不该改变纵向位置', zero.y === left.y, `y: ${zero.y} -> ${left.y}`)

    await ev(widget(), `window.cd.updateConfig({runtime:{window:{offsetX:-120}}})`)
    await wait(900)
    const right = widget().getBounds()
    check('负偏移向右移动', right.x - zero.x === 120, `x: ${zero.x} -> ${right.x}`)

    // 贴上边：正值向下
    await ev(widget(), `window.cd.updateConfig({runtime:{window:{corner:'top-left',cornerPreset:'top-left',offsetX:0,offsetY:0}}})`)
    await wait(900)
    const topLeftZero = widget().getBounds()
    await ev(widget(), `window.cd.updateConfig({runtime:{window:{offsetY:90}}})`)
    await wait(900)
    const topLeftDown = widget().getBounds()
    check(
      '左上角基准下正偏移向下移动',
      topLeftDown.y - topLeftZero.y === 90,
      `y: ${topLeftZero.y} -> ${topLeftDown.y}`
    )
    check(
      '左上角基准下正偏移向右移动',
      topLeftZero.x === topLeftDown.x,
      `x: ${topLeftZero.x} -> ${topLeftDown.x}`
    )
    check('窗口停在期望的屏幕范围内', topLeftZero.x >= area.x - 1, JSON.stringify({ area, topLeftZero }))
  }

  /* ---------------- 9. 鼠标点击穿透 ---------------- */
  {
    // 把组件挪到左上角：右上角常年被编辑器/浏览器占着，测出来的是它们而不是组件
    await ev(
      widget(),
      `window.cd.updateConfig({runtime:{window:{corner:'top-left',cornerPreset:'top-left',offsetX:0,offsetY:0,clickThrough:false}}}).then(function(){return 'ok'})`
    )
    await wait(1400)
    const wb = widget().getBounds()

    /**
     * 取样点定在卡片左上角内侧：这个位置基本不会被别的窗口压住，
     * 于是「该点归属谁」就只取决于组件的鼠标穿透状态，判定不会受桌面其他窗口干扰。
     */
    const cardRect = JSON.parse(
      await ev(
        widget(),
        `JSON.stringify((function(){var r=document.querySelector('.cd-card').getBoundingClientRect();return {left:Math.round(r.left),top:Math.round(r.top)};})())`
      )
    )
    const spot = { x: wb.x + cardRect.left + 6, y: wb.y + cardRect.top + 6 }

    // 先把指针挪到窗口外的空白处，避免上一次悬停状态干扰判定
    windowAt(wb.x + wb.width + 300, wb.y + wb.height + 120)

    const before = await ev(widget(), `window.cd.setInteractive(true).then(function(){return 'ok'})`)
    check('穿透关闭时允许渲染层恢复命中', before === 'ok', String(before))

    const ownWindow = settleAt(spot.x, spot.y)
    check(
      '关闭穿透时组件窗口接收该点的鼠标输入',
      ownWindow.text.includes('倒数日') && !ownWindow.text.includes('设置'),
      `取样点(${spot.x},${spot.y}) -> "${ownWindow.text}"`
    )

    // 打开穿透 + 渲染层反复请求命中：组件仍不该接收
    await ev(
      widget(),
      `window.cd.updateConfig({runtime:{window:{clickThrough:true}}}).then(function(){return window.cd.setInteractive(true)}).then(function(){return 'ok'})`
    )
    await wait(1400)
    const otherWindow = settleAt(spot.x, spot.y)
    check(
      '开启穿透后该点不再归属组件（点击落到组件后面）',
      !otherWindow.text.includes('倒数日'),
      `取样点(${spot.x},${spot.y}) -> "${otherWindow.text}"（开启前为 "${ownWindow.text}"）`
    )
    const stageDuring = await ev(
      widget(),
      `document.querySelector('.cd-stage').dataset.interactive`
    )
    check('开启穿透后渲染层也不再认为组件可点', stageDuring === 'false', `dataset.interactive=${stageDuring}`)

    const on = await ev(widget(), `window.cd.getConfig().then(function(c){return String(c.runtime.window.clickThrough)})`)
    check('开启点击穿透后配置写入', on === 'true', String(on))
    check('开启点击穿透后原生窗口不可聚焦', widget().isFocusable() === false, String(widget().isFocusable()))

    await ev(widget(), `window.cd.updateConfig({runtime:{window:{clickThrough:false}}}).then(function(){return 'ok'})`)
    await wait(1600)
    const stageAfter = await ev(
      widget(),
      `document.querySelector('.cd-stage').dataset.interactive`
    )
    check(
      '关闭穿透后命中状态立刻恢复（指针还停在卡片上）',
      stageAfter === 'true',
      `dataset.interactive=${stageAfter}`
    )
    const restored = settleAt(spot.x, spot.y)
    check(
      '关闭穿透后该点重新归属组件窗口',
      restored.text.includes('倒数日') && !restored.text.includes('设置') && widget().isFocusable() === true,
      `取样点(${spot.x},${spot.y}) -> "${restored.text}" focusable=${widget().isFocusable()}`
    )
  }

  /* ---------------- 10. 编辑页不再有吸顶预览 ---------------- */
  if (s) {
    await ev(
      s,
      `(function(){var btns=Array.prototype.slice.call(document.querySelectorAll('.settings-nav__item'));var hit=btns.find(function(b){return b.textContent.indexOf('倒数日列表')>=0});if(hit)hit.click();return 'ok';})()`
    )
    await wait(800)
    // 点第一行的名字进入编辑页
    await ev(
      s,
      `(function(){var m=document.querySelector('.cd-row__main');if(m)m.click();return 'ok';})()`
    )
    await wait(1200)
    const sticky = await ev(
      s,
      `JSON.stringify({sticky:!!document.querySelector('.editor-sticky'), preview:!!document.querySelector('.editor-sticky .preview')})`
    )
    check(
      '编辑页操作栏吸顶但不再包含预览',
      typeof sticky === 'string' && JSON.parse(sticky).sticky === true && JSON.parse(sticky).preview === false,
      String(sticky)
    )
    const editorText = await ev(s, `document.querySelector('.settings-content').innerText`)
    check(
      '编辑页有「显示天数单位」设置项',
      typeof editorText === 'string' && editorText.includes('显示天数单位'),
      'checked editor text'
    )
    check(
      '编辑页可以单独覆盖分隔符',
      typeof editorText === 'string' && editorText.includes('单独覆盖分隔符'),
      'checked editor text'
    )
    // 展开外观覆盖：找到「启用外观覆盖」那一行的开关再点
    await ev(
      s,
      `(function(){
         var rows = Array.prototype.slice.call(document.querySelectorAll('.settings-content .field-row'));
         var row = rows.find(function(r){ var t = r.querySelector('.field-row__text'); return t && t.textContent.indexOf('启用外观覆盖')>=0; });
         if (!row) return 'no-row';
         var sw = row.querySelector('.el-switch');
         if (!sw) return 'no-switch';
         sw.click();
         return 'ok';
       })()`
    )
    await wait(1200)
    const duplicateTitles = await ev(
      s,
      `(function(){
         var boxes = Array.prototype.slice.call(document.querySelectorAll('.override-group'));
         var textGroup = boxes.find(function(b){ var t=b.querySelector('.override-group__title'); return t && t.textContent.indexOf('文字样式')>=0; });
         if (!textGroup) return 'no-group';
         var heads = Array.prototype.filter.call(textGroup.querySelectorAll('.text-style-editor__head'), function(h){ return !!h.querySelector('.text-style-editor__title'); });
         return String(heads.length);
       })()`
    )
    check(
      '外观覆盖里已展开的样式编辑器不再重复显示标题',
      duplicateTitles === '0',
      `重复标题数量=${duplicateTitles}`
    )

    // 勾选「大数字样式」的覆盖，展开后标题也不该再出现一次
    await ev(
      s,
      `(function(){
         var boxes = Array.prototype.slice.call(document.querySelectorAll('.override-group'));
         var textGroup = boxes.find(function(b){ var t=b.querySelector('.override-group__title'); return t && t.textContent.indexOf('文字样式')>=0; });
         if (!textGroup) return 'no-group';
         var labels = Array.prototype.slice.call(textGroup.querySelectorAll('.el-checkbox'));
         var target = labels.find(function(l){ return l.textContent.indexOf('大数字样式')>=0; });
         if (!target) return 'no-checkbox';
         var input = target.querySelector('input');
         if (input && !input.checked) target.click();
         return 'ok';
       })()`
    )
    await wait(1000)
    const bigNumberDup = await ev(
      s,
      `(function(){
         var boxes = Array.prototype.slice.call(document.querySelectorAll('.override-group'));
         var textGroup = boxes.find(function(b){ var t=b.querySelector('.override-group__title'); return t && t.textContent.indexOf('文字样式')>=0; });
         if (!textGroup) return 'no-group';
         var editors = textGroup.querySelectorAll('.text-style-editor');
         var titled = Array.prototype.filter.call(editors, function(e){ return !!e.querySelector('.text-style-editor__title'); });
         var withOpacity = Array.prototype.filter.call(editors, function(e){ return !!e.querySelector('.el-slider'); });
         return JSON.stringify({ editors: editors.length, titled: titled.length, withOpacity: withOpacity.length });
       })()`
    )
    {
      const parsed = typeof bigNumberDup === 'string' && bigNumberDup.startsWith('{') ? JSON.parse(bigNumberDup) : null
      check(
        '勾选覆盖后展开的样式编辑器没有重复标题且包含透明度滑块',
        parsed !== null && parsed.titled === 0 && parsed.editors >= 1 && parsed.withOpacity >= 1,
        String(bigNumberDup)
      )
    }
  }

  write(failures === 0 ? 'ALL CHECKS PASSED' : `FAILURES: ${failures}`)
  app.exit(failures === 0 ? 0 : 1)
})
