// DOM 级视觉审查：对比度 / 裁切 / 对齐 / 触达尺寸 / 空态
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
fs.mkdirSync(outDir, { recursive: true })
const logFile = path.join(outDir, `domcheck-${process.argv.find((a) => a.startsWith('--theme='))?.split('=')[1] ?? 'default'}.log`)
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

/** 注入到页面里执行的检查函数（返回 JSON 字符串） */
const CHECKS = `(function(){
  var results = { issues: [], stats: {} };

  function parseColor(value) {
    var m = /rgba?\\(([^)]+)\\)/.exec(value || '');
    if (!m) return null;
    var p = m[1].split(',').map(function(x){ return parseFloat(x); });
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  function channel(c) {
    var s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }

  function luminance(c) {
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  }

  function contrast(fg, bg) {
    var l1 = luminance(fg), l2 = luminance(bg);
    var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  /** 逐层合成半透明背景，避免把 rgba 背景当成纯白 */
  function effectiveBg(el) {
    var layers = [];
    var node = el;
    while (node && node.nodeType === 1) {
      var c = parseColor(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.01) {
        layers.push(c);
        if (c.a >= 0.99) break;
      }
      node = node.parentElement;
    }
    if (!layers.length) return { r: 255, g: 255, b: 255, a: 1 };
    var base = layers[layers.length - 1];
    var out = { r: base.r, g: base.g, b: base.b, a: 1 };
    for (var i = layers.length - 2; i >= 0; i--) {
      var top = layers[i];
      out = {
        r: top.r * top.a + out.r * (1 - top.a),
        g: top.g * top.a + out.g * (1 - top.a),
        b: top.b * top.a + out.b * (1 - top.a),
        a: 1
      };
    }
    return out;
  }

  /** 渐变背景无法从 backgroundColor 读出，跳过（避免误报） */
  function hasGradient(el) {
    var node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      var bg = getComputedStyle(node).backgroundImage;
      if (bg && bg !== 'none' && bg.indexOf('gradient') >= 0) return true;
      node = node.parentElement;
    }
    return false;
  }

  function visible(el, style) {
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.15) return false;
    var r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  function textNodes() {
    var out = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = walker.nextNode())) {
      var text = (n.nodeValue || '').trim();
      if (!text) continue;
      var el = n.parentElement;
      if (!el) continue;
      var style = getComputedStyle(el);
      if (!visible(el, style)) continue;
      out.push({ el: el, text: text });
    }
    return out;
  }

  // 1) 文本对比度（跳过实心彩色底上的白字：分段按钮选中态、实心标签等）
  function isSolidFilled(el) {
    var node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      if (/el-radio-button__inner|el-button--|el-tag--|el-alert--/.test(String(node.className))) return true;
      node = node.parentElement;
    }
    return false;
  }

  var low = [];
  textNodes().forEach(function(item) {
    if (isSolidFilled(item.el)) return;
    if (hasGradient(item.el)) return;
    var style = getComputedStyle(item.el);
    var fg = parseColor(style.color);
    if (!fg) return;
    var bg = effectiveBg(item.el);
    var ratio = contrast(fg, bg);
    var size = parseFloat(style.fontSize);
    var large = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
    var need = large ? 3 : 4.5;
    if (ratio < need) {
      low.push({
        text: item.text.slice(0, 18),
        cls: String(item.el.className).slice(0, 42),
        size: size,
        ratio: Math.round(ratio * 100) / 100,
        need: need,
        fg: style.color,
        bg: 'rgba(' + bg.r + ',' + bg.g + ',' + bg.b + ',' + bg.a + ')',
        parentBg: getComputedStyle(item.el.parentElement || document.body).backgroundColor
      });
    }
  });
  if (low.length) results.issues.push({ kind: 'contrast', items: low.slice(0, 12), total: low.length });

  // 2) 横向裁切（内容超出父容器）
  var clipped = [];
  [].slice.call(document.querySelectorAll('body *')).forEach(function(el) {
    var style = getComputedStyle(el);
    if (!visible(el, style)) return;
    var over = el.scrollWidth - el.clientWidth;
    if (over > 2 && (style.overflowX === 'hidden' || style.overflowX === 'clip')) {
      clipped.push({ cls: String(el.className).slice(0, 48), over: over, overflowX: style.overflowX });
    }
  });
  if (clipped.length) results.issues.push({ kind: 'clipped', items: clipped.slice(0, 10), total: clipped.length });

  // 3) 横向溢出（连容器都装不下，会出现横向滚动）
  var scroller = document.querySelector('.settings-content');
  if (scroller && scroller.scrollWidth - scroller.clientWidth > 2) {
    results.issues.push({ kind: 'pageOverflow', value: scroller.scrollWidth - scroller.clientWidth });
  }

  // 4) 可点击元素触达尺寸（< 24px 认为偏小；应用内用于开关分组的方形复选框是刻意做小的）
  var small = [];
  [].slice.call(document.querySelectorAll('button, .el-switch, .el-radio, .el-checkbox')).forEach(function(el) {
    var style = getComputedStyle(el);
    if (!visible(el, style)) return;
    if (el.classList.contains('el-checkbox') && el.closest('.inline-group')) return;
    var r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 20) {
      small.push({ cls: String(el.className).slice(0, 46), w: Math.round(r.width), h: Math.round(r.height) });
    }
  });
  if (small.length) results.issues.push({ kind: 'smallTarget', items: small.slice(0, 10), total: small.length });

  // 5) 左标签与右控件垂直对齐
  var misaligned = [];
  [].slice.call(document.querySelectorAll('.field-row')).forEach(function(row) {
    var label = row.querySelector('.field-row__label');
    var control = row.querySelector('.field-row__control');
    if (!label || !control) return;
    var lr = label.getBoundingClientRect(), cr = control.getBoundingClientRect();
    var diff = Math.abs(lr.top - cr.top);
    if (diff > 8) misaligned.push({ label: (label.textContent || '').trim().slice(0, 14), diff: Math.round(diff) });
  });
  if (misaligned.length) results.issues.push({ kind: 'labelMisalign', items: misaligned.slice(0, 10), total: misaligned.length });

  // 6) 空态 / 占位异常
  var empty = [];
  [].slice.call(document.querySelectorAll('.el-card, .cd-row, .preset__item')).forEach(function(el) {
    var text = (el.textContent || '').trim();
    if (!text) empty.push(String(el.className).slice(0, 40));
  });
  if (empty.length) results.issues.push({ kind: 'emptyBlock', items: empty.slice(0, 6), total: empty.length });

  // 7) 关键控件是否被压扁/消失
  var collapsed = [];
  [].slice.call(document.querySelectorAll('.el-card__body, .panel-card, .preview, .cd-rows, .settings-nav')).forEach(function(el) {
    var r = el.getBoundingClientRect();
    if (r.height < 8 || r.width < 40) collapsed.push({ cls: String(el.className).slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
  });
  if (collapsed.length) results.issues.push({ kind: 'collapsed', items: collapsed.slice(0, 6), total: collapsed.length });

  results.stats.textNodes = textNodes().length;
  results.stats.buttons = document.querySelectorAll('button').length;
  results.stats.cards = document.querySelectorAll('.el-card').length;
  var rootStyle = getComputedStyle(document.documentElement);
  results.stats.tokens = {
    htmlClass: document.documentElement.className,
    theme: document.documentElement.dataset.theme,
    primary: rootStyle.getPropertyValue('--el-text-color-primary').trim(),
    regular: rootStyle.getPropertyValue('--el-text-color-regular').trim(),
    secondary: rootStyle.getPropertyValue('--el-text-color-secondary').trim(),
    navItem: (function () {
      var el = document.querySelector('.settings-nav__item');
      return el ? getComputedStyle(el).color : 'n/a';
    })()
  };
  return JSON.stringify(results);
})()`

/** 组件窗口专用检查 */
const WIDGET_CHECKS = `(function(){
  var issues = [];
  var card = document.querySelector('.cd-card');
  var stage = document.querySelector('.cd-stage');
  if (!card || !stage) return JSON.stringify({ issues: [{ kind: 'noCard' }] });
  var cr = card.getBoundingClientRect();
  var sr = stage.getBoundingClientRect();

  function parseColor(value) {
    var m = /rgba?\\(([^)]+)\\)/.exec(value || '');
    if (!m) return null;
    var p = m[1].split(',').map(function(x){ return parseFloat(x); });
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function channel(c) { var s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
  function lum(c) { return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b); }
  function ratio(fg, bg) { var a = lum(fg), b = lum(bg), hi = Math.max(a,b), lo = Math.min(a,b); return (hi + 0.05) / (lo + 0.05); }

  // 卡片必须完全落在窗口内
  var overflow = {
    left: Math.round(cr.left), top: Math.round(cr.top),
    right: Math.round(sr.width - cr.right), bottom: Math.round(sr.height - cr.bottom)
  };
  if (overflow.left < 0 || overflow.top < 0 || overflow.right < 0 || overflow.bottom < 0) {
    issues.push({ kind: 'cardOutsideWindow', overflow: overflow });
  }
  issues.push({ kind: 'insets', value: overflow });

  // 文本不得溢出卡片
  ['.cd-card__title', '.cd-card__number', '.cd-card__hint', '.cd-card__status', '.cd-card__precise'].forEach(function(sel){
    var el = document.querySelector(sel);
    if (!el) return;
    var r = el.getBoundingClientRect();
    if (r.right > cr.right + 1 || r.left < cr.left - 1 || r.bottom > cr.bottom + 9999) {
      issues.push({ kind: 'textOutsideCard', sel: sel });
    }
  });

  // 卡片内文本对比度（对卡片背景）
  var bg = parseColor(getComputedStyle(card).backgroundColor) || { r: 0, g: 0, b: 0 };
  ['.cd-card__title', '.cd-card__number', '.cd-card__unit', '.cd-card__hint', '.cd-card__status'].forEach(function(sel){
    var el = document.querySelector(sel);
    if (!el) return;
    var fg = parseColor(getComputedStyle(el).color);
    if (!fg) return;
    var rt = ratio(fg, bg);
    if (rt < 3) issues.push({ kind: 'widgetContrast', sel: sel, ratio: Math.round(rt * 100) / 100 });
  });

  return JSON.stringify({
    issues: issues,
    card: { w: Math.round(cr.width), h: Math.round(cr.height) },
    windowSize: { w: Math.round(sr.width), h: Math.round(sr.height) },
    texts: ['.cd-card__title','.cd-card__number','.cd-card__unit','.cd-card__hint','.cd-card__status'].map(function(sel){
      var el = document.querySelector(sel);
      return el ? { sel: sel, text: (el.textContent || '').trim() } : null;
    }).filter(Boolean)
  });
})()`

const navTo = (label) =>
  `JSON.stringify((function(){var b=[].slice.call(document.querySelectorAll(".settings-nav__item")).filter(function(x){return (x.textContent||"").trim()===${JSON.stringify(
    label
  )}})[0]; if(!b) return {found:false}; b.click(); return {found:true};})())`

app.whenReady().then(async () => {
  await wait(4000)
  const theme = (process.argv.find((a) => a.startsWith('--theme='))?.split('=')[1] ?? 'dark')
  const win = widget()
  await ev(win, `window.cd.updateConfig({runtime:{theme:${JSON.stringify(theme)}}}).then(function(){return "ok"})`)
  await wait(1200)
  write('WIDGET theme=' + theme + ' ' + (await ev(win, WIDGET_CHECKS)))

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

  const pages = ['倒数日列表', '日期与文案', '外观', '布局', '行为', '预设主题', '系统集成', '关于']
  for (const label of pages) {
    await ev(s, navTo(label))
    await wait(1000)
    write('PAGE ' + label + ' ' + (await ev(s, CHECKS)))
  }

  // 窄窗口下的表现
  s.setBounds({ x: 60, y: 40, width: 900, height: 700 })
  await wait(1200)
  await ev(s, navTo('外观'))
  await wait(900)
  write('PAGE 外观@900px ' + (await ev(s, CHECKS)))

  // 编辑子页
  await ev(s, navTo('倒数日列表'))
  await wait(800)
  await ev(
    s,
    'JSON.stringify((function(){var b=[].slice.call(document.querySelectorAll(".cd-row__actions button"))[0]; if(b){b.click(); return "ok"} return "no-btn";})())'
  )
  await wait(1500)
  write('PAGE 编辑子页 ' + (await ev(s, CHECKS)))

  // 单项外观覆盖展开态
  await ev(
    s,
    'JSON.stringify((function(){var sw=[].slice.call(document.querySelectorAll(".el-switch")).filter(function(x){var r=x.closest(".field-row");return r && /单独设置此项外观|Customize appearance/.test(r.textContent||"")})[0]; if(sw){sw.click(); return "on"} return "not-found";})())'
  )
  await wait(1500)
  write('PAGE 编辑子页(外观覆盖) ' + (await ev(s, CHECKS)))
  write('  appearanceOverrides=' + (await ev(s, 'document.querySelectorAll(".editor-style").length')))

  write('done')
  app.exit(0)
})
