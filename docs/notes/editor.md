# 编辑子页

实时预览、吸顶栏、草稿同步。

## 编辑子页的实时预览（草稿覆盖层）

- **草稿只在主进程内存里**（`src/main/preview.ts`），经独立通道 `widget:preview` 推给组件窗口，
  **既不写盘也不广播给设置窗口**——后者会喂给设置界面的 `useConfig`，把编辑器自己依赖的
  `props.config` 污染掉。放弃编辑时只需清空覆盖层，**不需要「回写旧值」**。
- **只在编辑当前显示项时套用**：`widgetConfig()` 会比较草稿 id 与 `config.activeId`，
  不一致就原样返回持久化配置，卡片不动。
- **清空时机**：编辑器卸载、设置窗口 `hide`/`closed`（主进程兜底）、应用退出。
  设置窗口重新 `show` 时主进程发 `preview:sync`，编辑器重发草稿，补上隐藏期间失效的预览。
- **保存时不会闪回**：`save()` 里先 `emit('save')`（同步触发 `patchConfig` → 发 IPC），
  之后才 `emit('close')` → 卸载 → 发 `preview:set(null)`。同一渲染进程的 IPC 按序处理，
  所以主进程**先写新配置、后清覆盖层**。**不得**把清空挪到 `emit('save')` 之前。
- `setPreviewItem()` 入口做深拷贝，渲染层再过一遍 `toPlain()`：Vue 的响应式 Proxy 直接跨 IPC 会抛
  `An object could not be cloned`。

### 吸顶栏

`.el-card` 自带 `overflow: hidden`（已核对 `node_modules/element-plus/theme-chalk/el-card.css`），
卡内 `position: sticky` **不会生效**。因此「返回 / 标题 / 状态标签 / 保存 + 紧凑预览」整块渲染在
`el-card` **外面**，用 `.editor-sticky` 吸顶，并用 `::before` 在上方补一块同色背景，
盖住滚动容器 padding 造成的缝隙（sticky 的 `top: 0` 相对 padding box 还是 content box 各版本并不一致）。

> 实测补充（Chromium 130 / Electron 33）：`top: -18px` 最终**钉在滚动视口的顶边**（不会被再往上推 18px），
> 所以栏体吸顶时是完整可见的，只是上方圆角与顶边那道 1px 边框会变成「贴边又带线」的怪样子。

**吸顶后只去掉「上方」的圆角与边框**（`is-stuck`）：左/右/下三边边框与下方两个圆角**保留**，
只把 `border-top-color` 置透明、`border-radius` 改成 `0 0 12px 12px`。

- 判定写在 `composables/useStickyStuck.ts`：在栏体**紧前面**放一个零高度锚点（`.editor-anchor`），
  它的 `top` 恒等于「栏体没吸顶时该在的位置」。往下滚时锚点跟着内容上移、栏体被钉住，
  于是 `栏体 top > 锚点 top` 就是吸顶。**不要**改成 `栏体 top <= 滚动容器 top` ——
  那等于把阈值写死成容器顶边，以后谁动一下 `top` 判定就整体偏。
- 用 `border-top-color: transparent` 而不是 `border-top: none`：边框盒尺寸不变，
  切换时不会因为少了 1px 边框让下面的内容上下跳一下（实测切换前后栏体高度都是 48px）。
  像素实测（整窗截图按 CSS 坐标取样）：吸顶时上边=栏体底色、左/右/下=边框色、左上角=边框像素；
  未吸顶时四边都是边框色、左上角=页面底色（圆角处露出来）。
- 时序：`scroll` 走**同步测量**（scroll 事件在绘制前派发，Vue 在微任务里改 class，仍赶在同一帧），
  窗口尺寸变化/栏体高度变化走 rAF。实测「一次滚 200px」后**第一帧**就已是 `is-stuck`，没有闪一帧圆角。
- 监听用 `window.addEventListener('scroll', measure, true)`：scroll 不冒泡，但捕获阶段能收到
  **任意**滚动容器的滚动，不必去找滚动父节点。
- 另外补了 `focus` 与 `visibilitychange` 两处补测：窗口从后台回来时补一次，
  因为后台期间渲染生命周期是停的，scroll 事件可能压根没派发。

**保存按钮不再顺手返回列表**（只保存，留在编辑页）。这条改动带出一个必须一起处理的分支：
「新建 → 保存 → 返回列表」时，列表那边会把「没保存就离开的新建项」当空白项删掉，
所以编辑器内部记一个 `everSaved`，`emit('close', { saved: everSaved })` ——
否则用户刚保存的新项会在点返回时凭空消失（`sticky-check.cjs` 专门守这条）。

### 草稿同步（打字不被回传覆盖）

主进程每次写盘都会广播全量配置。若无条件用广播值重载草稿，打字过程中会被回传覆盖。
现在比较「草稿算出的项」与 `props.item`，等价就跳过，只有真正的外部改动才重载。

### 不要用 computed 初始化 reactive 草稿

`reactive({ month: globalTarget.value.month })` 只在 `setup` 执行一次，而 store 是异步加载的，
computed 之后更新草稿不会跟着变——这正是「目标日期总是回到 1 月 1 日」的根因。
做法是在 `setup` 末尾调用 `syncFromItem(props.item)`，初始化与 `props.item` 变化共用同一条同步路径。
