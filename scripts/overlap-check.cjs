// 精确诊断：设置界面里元素是否互相重叠（重点看滑块 + show-input 与右侧列标签）
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const outDir = path.join(appRoot, '.verify')
fs.mkdirSync(outDir, { recursive: true })
const logFile = path.join(outDir, 'overlap.log')
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

const navTo = (label) =>
  `JSON.stringify((function(){var b=[].slice.call(document.querySelectorAll(".settings-nav__item")).filter(function(x){return (x.textContent||"").trim()===${JSON.stringify(
    label
  )}})[0]; if(!b) return {found:false}; b.click(); return {found:true};})())`

/**
 * 通用重叠检测：收集所有「有实际尺寸的叶子级可见元素」的矩形，
 * 两两比较是否存在面积重叠（忽略父子/祖孙关系）。
 */
const OVERLAP = `JSON.stringify((function(){
  function rect(el){ var r = el.getBoundingClientRect(); return { el: el, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }
  function visible(el){
    var s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.15) return false;
    var r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }
  function describe(el){
    var cls = String(el.className || '').split(' ').filter(Boolean).slice(0, 3).join('.');
    var text = (el.textContent || '').trim().slice(0, 14);
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (text ? ' "' + text + '"' : '');
  }
  var scope = document.querySelector('.settings-content') || document.body;
  // 只取叶子级元素，避免把父容器算进来造成海量误报
  var nodes = [].slice.call(scope.querySelectorAll('*')).filter(function(el){
    if (!visible(el)) return false;
    // el-select 的 filterable 隐藏输入框会被拉满整行，且运行时不可见
    if (el.classList.contains('el-select__input')) return false;
    // 滑块自身的轨道/已填充条/按钮本来就叠在一起，属正常结构
    if (el.classList.contains('el-slider__bar')) return false;
    if (el.classList.contains('el-slider__button')) return false;
    if (el.classList.contains('el-slider__button-wrapper')) return false;
    // SVG 图标内部的图形本来就互相叠放（例如 copy 图标的两条路径）
    if (el.ownerSVGElement) return false;
    var kids = [].slice.call(el.children).filter(visible);
    return kids.length === 0;
  });
  var rects = nodes.map(rect);
  var overlaps = [];
  for (var i = 0; i < rects.length; i++) {
    for (var j = i + 1; j < rects.length; j++) {
      var a = rects[i], b = rects[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      var ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      var oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (ox > 1.5 && oy > 1.5) {
        overlaps.push({
          a: describe(a.el),
          b: describe(b.el),
          ox: Math.round(ox),
          oy: Math.round(oy),
          area: Math.round(ox * oy)
        });
      }
    }
  }
  overlaps.sort(function(x, y){ return y.area - x.area; });

  // 另外单独量一下滑块的结构尺寸
  var sliderDump = [].slice.call(scope.querySelectorAll('.el-slider')).slice(0, 4).map(function(sl){
    var row = sl.closest('.field-row');
    var wrap = sl.querySelector('.el-slider__runway');
    var btn = sl.querySelector('.el-slider__button-wrapper');
    var input = sl.querySelector('.el-input-number');
    var ra = wrap ? wrap.getBoundingClientRect() : null;
    var ba = btn ? btn.getBoundingClientRect() : null;
    var ia = input ? input.getBoundingClientRect() : null;
    var rowRect = row ? row.getBoundingClientRect() : null;
    var nextLabel = null;
    if (row && row.nextElementSibling) {
      var nl = row.nextElementSibling.querySelector('.field-row__label');
      if (nl) nextLabel = nl.getBoundingClientRect();
    }
    return {
      label: row ? (row.querySelector('.field-row__label') || {}).textContent : null,
      row: rowRect ? { l: Math.round(rowRect.left), r: Math.round(rowRect.right) } : null,
      runway: ra ? { l: Math.round(ra.left), r: Math.round(ra.right), w: Math.round(ra.width) } : null,
      buttonRight: ba ? Math.round(ba.right) : null,
      input: ia ? { l: Math.round(ia.left), r: Math.round(ia.right), w: Math.round(ia.width) } : null,
      nextLabelLeft: nextLabel ? Math.round(nextLabel.left) : null,
      nextLabelTop: nextLabel ? Math.round(nextLabel.top) : null
    };
  });

  return JSON.stringify({
    overlaps: overlaps.slice(0, 20),
    overlapCount: overlaps.length,
    sliders: sliderDump,
    scope: { w: Math.round(scope.getBoundingClientRect().width), scrollW: scope.scrollWidth }
  });
})())`

app.whenReady().then(async () => {
  await wait(4000)
  main.openSettingsWindow()
  await wait(4500)
  const s = settings()
  if (!s) {
    write('no settings window')
    app.exit(1)
    return
  }
  s.setBounds({ x: 60, y: 40, width: 1120, height: 820 })
  await wait(1400)

  for (const [label, name] of [
    ['外观', 'appearance'],
    ['布局', 'layout'],
    ['日期与文案', 'target'],
    ['倒数日列表', 'list']
  ]) {
    await ev(s, navTo(label))
    await wait(1100)
    write('=== ' + name + ' ===')
    const raw = await ev(s, OVERLAP)
    if (typeof raw === 'string' && raw.startsWith('{')) {
      const parsed = JSON.parse(raw)
      write('  overlapCount=' + parsed.overlapCount + ' scopeW=' + parsed.scope.w + ' scrollW=' + parsed.scope.scrollW)
      for (const item of parsed.overlaps) {
        write('  OVERLAP ox=' + item.ox + ' oy=' + item.oy + ' area=' + item.area + '  A=' + item.a + '  B=' + item.b)
      }
      if (parsed.sliders.length) {
        for (const sl of parsed.sliders) write('  slider ' + JSON.stringify(sl))
      }
    } else {
      write('  ' + raw)
    }
  }

  // 窄窗口 / 默认窗口尺寸下再各量一次外观页
  for (const [w, h, tag] of [
    [1000, 720, 'default'],
    [880, 640, 'narrow']
  ]) {
    s.setBounds({ x: 60, y: 40, width: w, height: h })
    await wait(1300)
    await ev(s, navTo('外观'))
    await wait(1100)
    write('=== appearance@' + tag + '(' + w + 'x' + h + ') ===')
    const rawNarrow = await ev(s, OVERLAP)
    if (typeof rawNarrow === 'string' && rawNarrow.startsWith('{')) {
      const parsed = JSON.parse(rawNarrow)
      write('  overlapCount=' + parsed.overlapCount + ' scopeW=' + parsed.scope.w)
      for (const item of parsed.overlaps) {
        write('  OVERLAP area=' + item.area + '  A=' + item.a + '  B=' + item.b)
      }
      for (const sl of parsed.sliders) write('  slider ' + JSON.stringify(sl))
    } else {
      write('  ' + rawNarrow)
    }
  }
  s.setBounds({ x: 60, y: 40, width: 1120, height: 820 })
  await wait(1200)

  // 编辑子页（外观覆盖展开）
  await ev(s, navTo('倒数日列表'))
  await wait(800)
  await ev(
    s,
    'JSON.stringify((function(){var b=[].slice.call(document.querySelectorAll(".cd-row__actions button"))[0]; if(b){b.click(); return "ok"} return "no-btn";})())'
  )
  await wait(1500)
  await ev(
    s,
    'JSON.stringify((function(){var sw=[].slice.call(document.querySelectorAll(".el-switch")).filter(function(x){var r=x.closest(".field-row");return r && /单独设置此项外观/.test(r.textContent||"")})[0]; if(sw){sw.click(); return "on"} return "not-found";})())'
  )
  await wait(1600)
  write('=== editor(appearance on) ===')
  const raw = await ev(s, OVERLAP)
  if (typeof raw === 'string' && raw.startsWith('{')) {
    const parsed = JSON.parse(raw)
    write('  overlapCount=' + parsed.overlapCount)
    for (const item of parsed.overlaps) {
      write('  OVERLAP ox=' + item.ox + ' oy=' + item.oy + ' area=' + item.area + '  A=' + item.a + '  B=' + item.b)
    }
    for (const sl of parsed.sliders) write('  slider ' + JSON.stringify(sl))
  } else {
    write('  ' + raw)
  }

  write('done')
  app.exit(0)
})
