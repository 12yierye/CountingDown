# 开发笔记 / NOTES

README 只讲「怎么用」。这里放实现细节、踩过的坑与实测数据——改代码前值得先扫一眼，
很多地方看着可以简化，其实是被这些坑逼出来的。

---

## 目录结构

```
src/
├─ main/                 Electron 主进程（Node 侧）
│  ├─ index.ts           应用启动、IPC 注册（含列表项选中/启停/排序）、安全策略
│  ├─ windows.ts         组件窗口 / 设置窗口、四角定位、点击穿透
│  ├─ preview.ts         编辑草稿覆盖层（桌面实时预览，纯内存不落盘）
│  ├─ tray.ts            托盘图标与右键菜单
│  ├─ hotkey.ts          全局快捷键注册
│  └─ config-store.ts    electron-store 持久化 + 旧配置迁移 + 变更广播
├─ preload/index.ts      contextBridge 暴露的唯一 IPC 门面（window.cd）
├─ shared/               主进程与渲染进程共享
│  ├─ types.ts           全部配置类型（唯一类型来源）
│  └─ defaults.ts        默认配置、迁移、覆盖合并、倒计时计算、预设主题
└─ renderer/
   ├─ widget.html         桌面卡片页
   └─ settings.html       设置界面页
      └─ src/
         ├─ widget/      卡片渲染进程（自绘，不引入 UI 库，保证轻量）
         ├─ list/        倒数日列表页 + 单项编辑子页
         ├─ settings/    全局设置（侧边两级导航 + 面板 + 实时预览）
         ├─ components/  ColorField / TextStyleEditor / CountdownPreview / PresetGallery ...
         └─ i18n/        中英文案
```

---

## 依赖安装的坑（换机器时可对照排查）

1. pnpm 12 默认把 store 放在 `%LOCALAPPDATA%\pnpm\store`；若该目录不可写会报
   `Failed to write cafs ... 拒绝访问`。仓库内 `.npmrc` 已指定 `store-dir=.pnpm-store`，
   必要时也可显式传参：`pnpm install --store-dir .\.pnpm-store`。
2. pnpm 12 不再读取 `package.json` 的 `pnpm` 字段，构建脚本白名单改由
   `pnpm-workspace.yaml` 的 `allowBuilds` 控制——本仓库已放行 `electron` 与 `esbuild`。
   若这两个包缺少已下载的二进制（`node_modules/electron/dist/electron.exe` 不存在），
   重新执行一次 `pnpm install` 即可，Electron 会走 `ELECTRON_MIRROR` 镜像下载。
3. 若手动清理过 `node_modules`，记得保留 `pnpm-workspace.yaml`，否则 `allowBuilds` 丢失会导致
   Electron 二进制不再自动下载。
4. **`electron-vite dev` 报 `Error: Electron uninstall`** = `node_modules/electron/dist` 是空的
   （postinstall 没跑，常见于拷贝来的 `node_modules` 或中断的安装）。补装：
   ```powershell
   $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
   node node_modules/electron/install.js
   ```
   成功的标志：`node_modules/electron/path.txt` 内容为 `electron.exe`，
   `node_modules/electron/dist/version` 与 `package.json` 里的版本一致（当前 33.4.11）。
   注意 `electron.exe --version` 在 `ELECTRON_RUN_AS_NODE=1` 下打印的是 Node 版本，不能用来判断。
5. **启动时报 `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`**：
   Electron 被当成纯 Node 跑了，进程里 `electron.app` 是 undefined。检查环境变量
   **`ELECTRON_RUN_AS_NODE`** 是否为 `1`（部分 IDE / 自动化工具会注入），清掉再启动。
   自动化脚本同理：`unset ELECTRON_RUN_AS_NODE` 后再运行 `electron.exe scripts/xxx.cjs`。

---

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

---

## 组件渲染模式（重要）

Windows 上透明窗口依赖系统「透明效果」，而且**分层窗口在 `showInactive()` 之后有时不会重绘**，
DWM 会用不透明底填充它——表现就是「组件一显示就出现一块浅色大背板，隐藏就消失」，
而**右键托盘弹出菜单（原生菜单会触发一次桌面重新合成）后背板又消失**。

程序做了三层处理：

1. **显示后强制重绘**：统一的显示入口 `showWidgetWindow()` 在 `showInactive()` 之后做一次 1px 位移抖动
   （`nudgeRepaint`）。所有显示路径（启动、托盘左键、快捷键、设置里的「显示倒数日」、模式切换重建）
   都走这个入口，避免有的路径有修复、有的没有。
2. **自动检测系统透明效果**：启动时读 `HKCU\...\Themes\Personalize\EnableTransparency`；
   关闭时透明窗口会被画成不透明白块，此时自动切到**不透明兜底模式**（整个窗口即卡片 + 系统窗口圆角）。
3. **手动开关**：「全局设置 → 布局 → 使用透明窗口」，切换会重建组件窗口
   （`transparent` 只能在创建时指定），系统不支持时会给出提示。

两种模式共用同一套外观配置，区别只是窗口是否缩进 24px 以及要不要自己画阴影/边框。

> **`setIgnoreMouseEvents` 的致命顺序**：一旦在窗口**首次显示之前**调用它，Windows 会让分层窗口丢掉
> 逐像素透明，整窗被画成一块不透光的浅色背板（624×600 的白色方块），之后再怎么调用都救不回来，
> 只能重建窗口。所以命中状态只在窗口已显示时才落到原生窗口上（见 `applyIgnoreMouse`）。
>
> 排查记录：`capturePage()` 抓到的窗口一直是透明的（可见像素只覆盖卡片区域），说明问题出在
> 「窗口内容正确但系统合成不对」，而不是 CSS。因此没有去改绘制，而是补上强制重绘与不透明兜底。

---

## 点击穿透

透明窗口用 `setIgnoreMouseEvents(true, { forward: true })` 让指针事件穿透到桌面；
由于本机实测 `forward` 并不派发事件，主进程改为**每 80ms 轮询一次光标屏幕坐标**并推送给渲染层，
渲染层用 `window.screenX/Y` 换算成窗口内坐标做命中测试，指针落在卡片上时通过 IPC 临时恢复鼠标事件，
离开立即恢复穿透——因此卡片的透明区域不会挡住桌面图标。

---

## 卡片定位与拖动

- **卡片定位**：`.cd-stage` 只负责四角对齐，卡片外层 `.cd-shrink` 绝对定位在 `24px` 安全区内
  （`top/right/bottom/left: 24px`）。窗口尺寸取 `624×600`，正好等于「安全区 576×552 + 2×24」，
  因此卡片到屏幕边缘的距离在四个方向都是 24px。
- **拖动**：
  1. 渲染层在卡片上 `pointerdown` 时上报**卡片相对窗口的位置**，主进程据此进入拖动；
  2. 主进程按 16ms 轮询光标（透明窗口收不到可靠的鼠标移动事件），窗口位置 = 按下时的窗口位置 + 光标位移，
     并保证**卡片始终完整留在工作区内**（不是整窗留在工作区——窗口 624×600 比卡片大得多，
     按整窗限制的话卡片在纵向只能移动 480px，根本拖不到屏幕另一半）；
  3. 拖动期间强制保持命中，否则光标一旦甩出卡片，点击穿透会让拖动直接断掉；
     `pointerup` / `pointercancel` / 窗口失焦都会结束拖动；
  4. 松手时按卡片中心选择**最近的角落**，再把窗口摆到「新角落 + 新偏移量」能还原出同一落点的位置，
     所以松手时卡片不会跳；偏移量随后写回配置，设置面板里的数值与参考基准立刻同步。

换算出的偏移量始终落在布局面板滑块的量程内，并且 `computeCornerPosition()` 能精确还原窗口位置
（回归脚本 `scripts/drag-check.cjs` 用真实鼠标消息拖动并断言 `ROUNDTRIP.ok`）。

---

## 关键实现说明

- **永不进入任务栏**：组件窗口创建时 `skipTaskbar: true`，并且在每次显示后又调用一次
  `setSkipTaskbar(true)`；`window-all-closed` 不退出应用，靠托盘常驻。
- **总是浮在最前**：`setAlwaysOnTop(true, 'screen-saver')`，可在设置或托盘菜单关闭。
- **当天/过期判定**：不带时刻的日期按「整天」语义（当天 = 就在今天）；带时刻的日期到点即视为已过。
- **每年重复**：`annual` 模式只存月/日，若今年已过会自动滚动到明年，因此跨年无需手动维护。
- **超大内容的等比缩放**：组件窗口固定 624×600，安全区为 576×552。当「精确模式 + 超大字号」等内容
  天然宽于安全区时（实测 110px 字号「95天02:46:11」需要 673px），渲染层会按 `available / natural`
  给卡片容器加 `zoom`（**不是** `transform: scale`，因为 zoom 才会真正缩小布局盒子）。
  - **测量必须用布局尺寸**：zoom 作用在 `.cd-shrink` 上，`getBoundingClientRect()` 给的是缩放后的视觉尺寸，
    而 `scrollWidth` / `offsetWidth` 不随 zoom 变化。早先用视觉宽度与可用宽度比较，收敛点会偏大
    （约 `√(可用/自然)`），于是**显示到秒时文字比卡片还宽、卡片也顶出安全区**。
    现在按行取布局尺寸算出「内容自然宽度 + 卡片内边距与边框」作为缩放基准，一次算准。
  - **卡片的宽度上限按缩放换算**：`zoom ≠ 1` 时 Chromium 下 `.cd-shrink` 的布局宽度与视觉宽度不再严格等比，
    只靠 `max-width: 100%` 会允许卡片比安全区宽出几像素；因此缩小后额外把卡片的 `max-width` 设成
    `可用宽度 / zoom`（布局 px）。
  - **卡片不得窄于内容**：`.cd-card` 带 `min-width: fit-content`，用户把「卡片宽度」设得比内容还窄时
    宁可卡片变宽，也不让文字溢出到背景之外。
- **卡片横向对齐**：卡片自身用 `align-items: center` 居中对齐，避免 flex 拉伸导致命中区域覆盖整条窗口宽度
  （改动 `.cd-stage`/`.cd-card` 对齐时请留意）。

---

## 应用图标与名称

| 场景 | 任务栏图标 | 任务管理器「名称」 |
| --- | --- | --- |
| `pnpm dev`（开发） | 倒数日图标（窗口已显式指定 `resources/icon.ico`） | **Electron** |
| `pnpm run dist` / `dist:dir`（打包版） | 倒数日图标 | **倒数日** |

- dev 下进程本身就是 `node_modules` 里的 `electron.exe`，任务管理器「名称」列读的是可执行文件的版本信息
  （`FileDescription`），因此那里必然显示 `Electron`——**只有打包版才能改**。窗口图标已经显式指向
  `resources/icon.ico`，所以 dev 下任务栏图标是正确的。
- `make-icons.ps1` 产出 **16 / 24 / 32 / 48 / 64 / 128 / 256** 七层 ICO：≤128 用经典 DIB 层，
  256 用 PNG 压缩层（体积小，Vista 以后都支持）。**不能用 `Bitmap.GetHicon()` + `Icon.Save()` 糊弄**：
  那样只会写出一层 256×256，任务栏 16/24px 让系统缩放下来会发糊；而且实测 `Icon.Save()` 对**所有**尺寸
  都写 PNG 层，小尺寸下并非所有外壳组件都认。
- **该脚本必须以 UTF-8 with BOM 保存**。Windows PowerShell 5.1 读无 BOM 的 `.ps1` 会按 ANSI 解码，
  脚本里的中文会变成乱码——`-f` 格式化字符串里混入乱码会直接抛
  「Input string was not in a correct format」。
- 打包时 `build.win.icon` 与 `build.nsis` 的安装包 / 卸载 / 安装头图标都指向该 ICO；
  `build.win.executableName` 用 ASCII 的 `CountingDown`，而任务管理器显示的名称来自 `productName`（倒数日）。
- `electron-builder` 会自动把 `directories.buildResources`（即 `resources/`）从 `files` 里排除，
  但本仓库的 `resources/**/*` 确实进了 `app.asar`；打包后 `appIconPath()` / `resolveTrayImage()` 命中的是
  `.../resources/app.asar/resources/*`，靠 Electron 打过补丁的 `fs` 与 `nativeImage` 读取（已实测可加载）。

---

## 视觉与可读性修正

专门做了一遍显示质量排查（Element Plus 默认灰阶在浅色主题下大面积低于 WCAG AA）：

| 问题 | 处理 |
| --- | --- |
| 浅色主题下正文/次要文字对比度仅 2.5–3.1:1 | 覆盖 `--el-text-color-*`，改为 `#1f2329 / #4a5160 / #5b6474`（≥4.5:1） |
| 彩色实心按钮上的白字（主色、成功、危险、警告）对比度不足 | 浅色主题加深彩色底、深色主题把彩色底上的文字改为深色，两类都 ≥4.5:1 |
| **深色主题下 plain 按钮黑字压黑底**（预设主题的「套用」、系统集成的「退出程序」实测仅 1.09–1.25:1） | 深色文字规则改为只作用于**实心**按钮（`:not(.is-plain):not(.is-text):not(.is-link)`，顺带修掉浅色主题下同样存在的白字压浅底） |
| 未选中的分段按钮文字默认 `#a8abb2` 太浅 | 浅色 `#4a5160` / 深色 `#a9b4c6` |
| `el-alert__title`、`el-checkbox__label`、`el-input__count-inner`、`el-tag` 里硬编码的灰/蓝/绿/红 | 逐个按具体组件覆盖为可读色 |
| 预设主题卡片预览的樱花粉/纸质便签配色过浅（最低 2.59:1） | 加深这两套预设的 title/hint/count/status，全部 ≥4.5:1 |
| 「字体族」下拉的选项被缩写成一串「…」，几乎每条都看不出区别 | 下拉项改为显示**整串 CSS `font-family`**（允许换行）；已选值仍用 `text-overflow: ellipsis` 收尾 |
| 复选框方块 14px、命中区太小 | 命中区放大到 20×20 |
| 列表为空时桌面组件完全“隐身” | 增加空态提示卡片（「还没有倒数日 / 在设置里新增一项…」），同样支持点击穿透 |
| 顶栏常驻「已保存」标签占位且无信息量 | 改为写入后短暂闪现 1.4s 的保存提示 |
| 布局/行为页内容少时面板被拉伸 | `.settings-content` 改为 `flex-direction: column` + 内容贴顶 |
| 外观页四段文字样式单列过长、滑块过宽 | 宽屏时按 `minmax(330px, 1fr)` 自动排成两列 |
| 默认深色卡片副标题/标题对比度偏低（3.0–3.5:1） | 默认值提到 `#a7b3cc` / `#b9c4dc`（约 5:1），预设主题同步 |
| 外观页「卡片宽度」把说明写进了标签里 | 标签只留「卡片宽度」，说明收进右侧「?」tooltip（i18n `appearance.widthHint`） |
| 编辑子页「外观覆盖」平铺在卡片里，与全局外观页分区观感不一致 | 按类别包进 `.override-group`，底色与描边复用全局外观页 `.text-style-editor` 同款 |

### 说明统一收进问号

原来的补充说明有两种呈现：标签右侧的「?」tooltip **和** 控件下方额外一行的灰色小字。
后者既占高度又把表单切得很碎，现在统一成前者：

- `FieldRow` 的 `hint` 只渲染成标签右侧的「?」图标 tooltip（`QuestionFilled`，不再是灰底小圆点），
  控件下方的 `field-row__note` 已删除；确实需要常显示的提示用 `#note` 插槽传入。
- 卡片/分区标题右侧也提供同样的「?」，承接原来独立成行的说明。
- 因此这些页面上原本的 `el-alert` 与说明段落已经全部移除（实测各页 `bottomNotes: []`、`alerts: 0`）。

### 深色主题图标对比度

`.el-button.is-text`（列表里的编辑/复制/删除图标按钮、各处链接按钮）在深色主题下用的是
Element Plus 的次要灰，暗到几乎看不见。现在深色主题下统一提到 `#c6cedd`（实测
`rgb(198, 206, 221)`，对深色底 ≥ 8:1），hover 用主色，禁用态单独给一个可见的灰。

### 外观覆盖（逐个勾选）

编辑页的「外观覆盖」是一个**总开关 + 逐项复选框**的结构：

- 总开关关闭时不写任何覆盖，`appearance` 保持 `{}`，控件区完全不渲染；
- 打开后每项左侧出现复选框（字体、不透明度、背景色、圆角/内边距、边框、阴影、四段文字样式），
  **勾选哪项才显示哪项的输入控件**，未勾选的继续跟随全局；
- 勾选时以当前全局值作为起点，取消勾选即删除该字段；
- 因为勾选框本身就是「是否覆盖」的开关，所以不再需要「恢复全局设置」按钮。

实测：总开关关 → `checkboxes: 0, styleEditors: 0`；开 → `checkboxes: 7, styleEditors: 0`；
勾选「大数字样式」→ `styleEditors: 1`；保存后只写入 `{"count": {...}}`，未勾选项不落盘。

### 单位字不受显示模式限制

`UnitLabelField` 的四个输入框**永远可编辑**。曾经它写的是
`:disabled="disabled || !slot.on"`，于是「只显示天数」模式下时/分/秒三格是禁用的、根本点不进去 ——
但换显示模式后它们立刻生效，用户没理由被当前模式锁住手。

现在的分工：

- `dayOn / hourOn / minuteOn / secondOn` **只**驱动标灰（`.units__slot.is-off`，`opacity: .6`），
  **不得**再参与 `disabled`。加控件或改表单时别把这个 prop 当成「能不能改」的开关。
- 标灰格的 `cursor` 必须是 `text` 而不是 `not-allowed`，否则用户以为点不动。
- 文案（i18n `behavior.unitsHint`）说的是「淡一档提示，但照样可以填写」，与行为一致。

实测（`scripts/units-check.cjs`，13 条断言全过）：`displayMode: 'days'` 下
`disabled: 0` / `off: 3`，往「时」格里打字 `h` 能落盘成 `units.hour === 'h'`，
切到「天 + 时」后该值仍在；编辑子页的「单位字覆盖」同样 `disabled: 0`。

### 预设「手动调整所有参数」= 模态框里的草稿

预设页的保存来源有三条，接收端靠 `PresetSaveMode`（`'global' | 'item' | 'manual'`）分派：

| saveMode | 写自定义预设 | 还写什么 |
| --- | --- | --- |
| `global` | ✅ | **覆盖全局 `appearance`**（这个来源的字面语义就是如此） |
| `item` | ✅ | 写回那个倒数日的 `appearance` 覆盖 |
| `manual` | ✅ | 什么都不写 —— 只加预设 |

- 之前是 `target: 'global' | 'item'` + `tune: boolean` 两个字段，但「手动调整」与
  「当前全局外观」**都会发 `target='global'`**，接收端分不出来。改这块时最容易犯的错，
  就是顺手把「写全局外观」整段删掉 —— 那会把 `global` 来源一起弄坏。
  `scripts/preset-sources-check.cjs` 专门守住这两条。
- `manual` 的一切改动都落在一份 `JSON.parse(JSON.stringify(...))` 的**深拷贝草稿**上（`PresetTuneDialog`），
  取消即丢弃；确定时才 `patchConfig({ customPresets })`。草稿与全局配置之间不能留任何共享引用，
  否则「改草稿」就等于「改全局」。
- 外观表单本身抽在 `AppearanceFields.vue`（纯表现层：`v-model:appearance`，不读配置、不落盘），
  全局外观页 `AppearancePanel.vue` 退化成薄壳；模态框传 `dense` 用平铺分组外壳。
  **不要**把全局外观页那个「一改就 patch 落盘」的组件塞进模态框 —— 那样点取消也已经写盘了。

> **`<component :is>` 不能和 `v-else` 凑宿主标签**：想用一个组件在「el-card / section」两种外壳间切换，
> `:is` 与 `#header` 那套写法会报 `v-else/v-else-if has no adjacent v-if`，而且 **`vue-tsc` 查不出来**，
> 只有真正 `pnpm run build` 才会炸。所以外壳单独抽成了 `AppearanceGroup.vue`。
> 同理，模板里 `@click` 写多行语句也会在构建期报解析错误 —— 用具名函数。

实测（`scripts/preset-tune-check.cjs`，36 条断言全过）：模态框里 17 滑块 / 1 数字输入 / 7 取色器 /
4 段文字样式 / 4 个平铺分组 / 1 张实时预览；拖滑块后磁盘 `appearance` 逐字段不变、
`customPresets` 数量不变；确定后 `customPresets` +1 且新预设是草稿那一份（圆角 51 vs 全局 18），
全局仍是 18；取消后两个数字都不动。名称空着点「保存预设」原地报错、不新增预设。
另有几何断言：预览不压表单（间距 16px）、表单无横向溢出、弹窗与底部按钮都收在视口内。

### 预设系统的第二轮整理（2026-10）

第一版能跑，但「潦草」在三个地方：**同一张卡片被手搓了三遍**（列表缩略图、详情弹窗、
调参弹窗各一套），缩略图还是假的（硬编码 `128` / `5 月 20 日`，不渲染状态行与单位字）；
**套用后没有任何「正在使用」的反馈**；**每张卡挤三个按钮，却不能重命名或覆盖**。

现在的做法：

- **缩略图直接用真组件**：`<CountdownPreview sample still :scale="thumbScale(...)" />`。
  `still` 是新加的 prop，关掉每秒重算的 interval（一次渲染十几份，没必要各跑一个定时器）。
  `thumbScale = min(0.52, 44 / count.fontSize)` —— 按「大数字不超过 44px」缩放，
  超大字号不会撑破 118px 画布。`PresetDetailDialog` 里那张大图同样换成真组件。
- **使用中标记**：逐字段比较（`sameAppearance`），**不要用 `JSON.stringify` 比较** ——
  两份外观对象的键序不一定一致，会出现「明明是同一套却不打标」。
- **操作收敛**：卡片只留「套用 / 查看参数 / ⋮」，重命名、用当前外观更新、复制、删除收进下拉。
  内置预设也能「复制为我的预设」，得到一个可编辑的起点。
- **保存弹窗**：三个来源从「三个单选 + 一段会变的灰字」改成三块可点击的说明卡；
  新增显式的「保存后立即套用到全局」（默认不勾），保存动作不再偷偷改全局。
  来源语义没动（`global` 仍写一次全局外观，实际是同值 no-op；`item` 仍把该项覆盖写成合并结果），
  `preset-sources-check.cjs` 守住的那两条继续成立。
- 预设仍然**只保存外观**，页面底部现在明说了「文案、显示模式与单位字不随预设切换」。

> 与脚本的兼容点（改这块时别踩）：
> 1. 保存弹窗底部那个按钮的文案必须**包含「手动调整参数」**（`bugs-check` / `preset-tune-check`
>    按这个子串点它），所以写的是「下一步：手动调整参数…」而不是「下一步」。
> 2. `.preset-footer__actions` 里必须仍有文字为「查看参数」的 `button`
>    （`verify-1.1.0` 数它 ≥ 5），所以没有把它收进下拉。
> 3. 详情弹窗仍要展示文案行（测试断言里有 `还有 {days} 天`）。

---

### 三个踩过的坑（都已被 `scripts/bugs-check.cjs` 守住）

**1. 「未保存的更改」误报 = JSON 键顺序不一致。**
`CountdownEditor` 判断脏不脏比的是 `JSON.stringify(snapshot)`，**键顺序不同就是不同的字符串**。
`normalizeItem()` 写出的 `units` 是 `{ ...normalizeUnits(...), enabled: true }`（四个字在前、
`enabled` 在最后），而 `computeItem()` 曾经写成 `{ enabled: true, day, ... }` ——
于是**开着「单位字覆盖」的项每次进编辑页都显示未保存**，点返回还会弹「放弃修改」。
改这类快照比较的两侧时，必须逐字段对齐键顺序（或者别用 JSON 字符串当快照）。

**2. 组件窗口被销毁后，「显示」永久失效。**
`setWidgetVisible()` 从前是 `const win = getWidgetWindow(); if (!win) return visible` ——
用户从任务栏把组件窗口关掉之后，窗口对象已经是 null，于是点托盘、按快捷键、改配置全都只是
把 `runtime.widgetVisible` 这个**期望值**翻来翻去，卡片再也不会回来。
现在：窗口缺失时 `showWidget()` 先重建再显示；`toggleWidgetVisible()` 用
**窗口当前是否真的可见**判断（不是期望值），避免「第一次点击没反应、要点两次」。
托盘菜单文案也改成看 `isWidgetWindowAlive()`，否则窗口没了菜单还写着「隐藏倒数日」，
用户根本找不到「显示」这个入口。

> 排查提示：这两个函数一度是「只有测试用」的导出，被 bundler 当成死代码 tree-shake 掉了，
> 探针里 `main.isWidgetWindowAlive` 直接是 `undefined`。**测试脚手架要用到的入口必须在主流程里
> 真的被调用**，不能靠 `export` 留着。也因此探针改成了只断言可观察行为（窗口对象 + 托盘菜单文案），
> 不再依赖内部函数导出。

**3. `el-dialog` 的高度分配：别碰 `display`，也别指望「外框限高 + 内部百分比」。**
弹窗右下角按钮溢出到容器外面，根因是 `.el-dialog` 为 `box-sizing: border-box`，
`max-height: 88vh` 限的是**含 16px 内边距与标题栏的外框**：外框 599px，而
header 40 + body 503 + footer 48 = 607，footer 正好被顶到边框外 8px。

试过并**全部否决**的写法：
- `display: flex` 放在 `.el-dialog.tune-dialog` 上 → 特异性高过元素自带的 `display: none`，
  弹窗「关掉」后仍占屏；
- 改用 `:not([style*="display: none"])` 条件变体 → 背靠背连跑时出现关闭后 computed display
  仍是 `flex`（inline style 里却没有 display），隐藏被静默破坏，**比原问题更糟**；
- 给内部那层（`.tune-dialog__inner`）写 `max-height: 100%` → 无效，其包含块的 height 是 auto，
  百分比无从解析，那层照样长成自然高度 1743px，footer 被推到弹窗外 **1248px**；
- 给外框补 `height: fit-content` → `fit-content` 只是近似 definite，仍不生效。

现在的写法：**只给 `.el-dialog__body` 一个明确的高度上限**
（`max-height: max(160px, calc(88vh - 112px))`，112px ≈ 标题栏 40 + footer 48 + 上下内边距 32），
让它自己滚。外框被正文撑到合适高度，完全不需要任何 display / height hack。
实测 1000×720 / 900×660 / 880×600 三种窗口下 footer 与按钮都在弹窗内 ≥8px。

> 另外两处同类坑：
> - class 绑定在 `.el-dialog` **自身**（`class="el-dialog tune-dialog"`），只能用
>   `.el-dialog.tune-dialog`；写成后代选择器 `.tune-dialog .el-dialog` 永远选不中（我踩了两次）；
> - 组件 `<style scoped>` 盖不到元素封装出来的内部节点，这类结构性覆盖必须写在 `settings.css`。

**4. 预览的样板标题要传取值函数。**
`useCountdownCard({ sampleTitle })` 从前只接受字符串，`props.title || '元旦'` 在 setup 时求值一次，
之后 props 变化不再反映 —— 表现为「预设调参弹窗里输入预设名，右侧预览标题纹丝不动」。
现在 `sampleTitle` 也接受 `() => string`，`CountdownPreview` 传的就是取值函数。

### 标签式切换的边框（`el-radio-button`）

Element Plus 默认**不是**每个标签各画一圈边框，而是靠 `margin-left: -1px` + `box-shadow`
把相邻标签的边框拼在一起（第一段的左边框只由 `box-shadow` 提供），并且给首/中/尾标签分别设了单边圆角。
这带来两个坑：

1. 父容器只要有 `overflow: hidden`（早先为修滑块溢出加的），**首标签的左边框就被裁掉**，
   看起来就是「边框被吞了」；换行布局下相邻标签还会叠边。
2. 圆角被拆成 `4px 0 0 4px` / `0 4px 4px 0`，最后一个是直角。

现在的做法（`settings.css` 里统一覆盖）：

- 每个标签都是**独立圆角小按钮**：真实 `1px` 边框 + `6px` 圆角，`box-shadow: none`，标签间 `6px` 间距；
- 标签高度统一 `26px`（`.is-compact` 为 `24px`），字号 `12.5px`；
- `.el-radio-group` 允许换行并留 `8px` 行距；
- 圆角那条规则要用 `.el-radio-group .el-radio-button:first-child .el-radio-button__inner`
  这种**更高特异性**的选择器，否则压不过 Element Plus 自带的单边圆角规则；
- `.row__control` 上**不能**再留 `overflow: hidden`，滑块自己的溢出交给 `.slider-field` 处理。

实测（外观 / 日期与文案 / 行为 / 关于 / 编辑子页，共 88 个标签）：圆角全部 `6px`、边框 `1px`、
裁切 0、标签重叠 0、组内溢出 0。

### 滑块与颜色控件重构（左右重叠问题）

现象：外观页里左侧滑块的数值、右列设置项的文字会挤在一起，数值框里还出现滚动条。

量出来的根因有三条，都不是「文字本身重叠」：

| 根因 | 实测 | 处理 |
| --- | --- | --- |
| `el-slider` 的 `show-input` 内部是完整 `el-input-number`（**最小 130px**，自带滚动条） | 两列网格里轨道只剩 `101px`，输入框 `130px` 与轨道挤在一行 | 新增 `SliderField.vue`：**关掉 show-input**，改成同一行内一个只读数值块（44px 起） |
| 两列网格 `gap: 0 22px` 左侧为 0 | 左列控件右缘 `640`、右列标签左缘 `662`，只剩 22px | 列间距改为 `36px`，最小列宽 `280px → 320px` |
| `ColorField` 把色块/十六进制/透明度滑块/百分比硬塞在一行 | 默认 1000px 窗口下「78%」与右列「卡片宽度」重叠 **20×14px** | 透明度滑块另起一行（`α` + 滑块 + 百分比） |

重构后实测：**1120 / 1000 / 880 三种窗口宽度、外观/布局/日期文案/列表/编辑子页全部 `overlapCount = 0`**，
滑块轨道从 `101px` 恢复到 `195–636px`，`input: null`（不再有数字输入框）。

> 另外两类重叠是误报，已在检查脚本里过滤：Element Plus `filterable` 下拉的隐藏输入框会被拉满整行
> （运行时不可见）；`el-slider__bar` 与滑块按钮本来就叠在一起；SVG 图标内部的路径本来就互相叠放。

---

## 设置界面的信息架构（2026-10 重构）

这一轮改的是「为什么设置看起来繁琐」，而不是加功能。根因有三条：**按代码模块分组、
所有控件同时展开、预览固定占掉 240px 高度**。对应的改法如下。

### 预览从固定顶条挪到右侧竖栏

`.settings-preview` 从前是 `.settings-content` 的兄弟节点，在滚动容器**外面**，
所以永远占着顶栏下方约 240px：默认 1000×720 窗口里表单可视高度只剩 **383px**，
滚到「文字样式」时预览还在，但表单只剩一条缝。

现在结构是 `.settings-body { display:flex }` + `.settings-content`（滚动）+ `.settings-rail`
（248px，`border-left`）。默认窗口同步放大到 **1200×760**（最小 960×620），
1200 下侧栏与两列外观表单能同时放下（内容区要扣掉 10px 滚动条 + 40px 内边距，
1180 会差 2px 掉回单列）。窄于 1100px 时侧栏和它的开关一起隐藏 ——
窗口已经够窄了，再把宽度分给预览只会更难填。

- 侧栏显隐状态存 `localStorage['cd.settings.preview']`，**不写进配置**（这是界面偏好，不是应用设置）。
- 顶栏的预览按钮只在 `showPreview` 的页面出现（日期与文案 / 外观 / 布局 / 行为）。

### 外观页按使用频率分两层

`AppearanceFields` 的 `advanced` prop（默认 false）只决定次要参数的显隐：

| 层 | 内容 | 默认 |
| --- | --- | --- |
| 常用 | 字体族、背景色、背景透明度、圆角、卡片宽度、文字透明度、四段字号/颜色 | 显示 |
| 高级 | 内边距、边框宽度/颜色、阴影强度/颜色、字重、字距、单段透明度 | 折叠 |

- 折叠只影响渲染，**不影响数据**：隐藏字段原样留在 `appearance` 里。
- 入口只有一个：表单最上方 `.advanced-bar` 里的开关（`[data-cd-advanced]`，给脚本用）。
  以前「展开」藏在边框分区、「收起」又跑到文字分区标题右侧 —— 同一个概念两个位置两套文案；
  现在收起时边框分区整组不渲染，说明写在开关旁边（列清楚它会带出哪几项）。
- 背景透明度是「背景」这一级的独立一行，**不**再嵌进取色器弹层：
  `ColorField` 已把 alpha 能力整个删掉，透明度统一由 `SliderField` 承担。嵌在弹层里时
  多数人根本不知道有这根滑条。
- `PresetTuneDialog` 传 `advanced`（静态 true）：那个弹窗的语义就是「手动调整所有参数」，
  `preset-tune-check.cjs` 的 17 个滑块断言因此不受影响。
- 预设条与「预设主题」页的区别：这里只套用、不管理（改名 / 删除 / 存新预设仍在预设页）。
  套用后按 Ctrl+Z 可退回 —— 这是敢把「一键换肤」放在首屏的前提。

### 分组重置

`AppearanceGroup` 增加了 `#actions` 插槽，每个分组标题右侧有「重置」。
重置映射在 `AppearancePanel.resetGroup()`：字体 / 背景（色 + 透明度 + 圆角 + 内边距 + 宽度）/
边框与阴影 / 文字（textAlpha + 四段样式）。比「恢复默认设置」温和，且同样可撤销。

### 侧栏：折叠分组 + 搜索

8 个平级入口收成 4 组（倒数日 / 外观与风格 / 窗口与系统 / 关于），当前组自动展开。

- 子项用 **`v-show` 而不是 `v-if`**：所有自动化脚本都靠 `.settings-nav__item` 的文字定位，
  `v-if` 会让折叠组里的「布局」「行为」直接不在 DOM 里。
- 组标题是 `.settings-nav__head`，刻意不复用 `.settings-nav__item`，免得脚本把它当成页面入口。
- 搜索框按 `label + keywords` 过滤；keywords 写在 `SettingsApp.groups` 里（中英文都覆盖），
  搜索时强制展开所有匹配项。组标题在搜索态不可折叠。

### 撤销 / 重做（Ctrl+Z / Ctrl+Shift+Z）

全局设置是「改一下立刻落盘」，从前改坏了只能点「恢复默认设置」。

- 快照是**整份配置**，恢复走新增的 `config:replace` → `replaceConfig()`。
  不能复用 `updateConfig`：它是深合并，取消某个外观覆盖后删掉的字段会在撤销时「复活」。
  `replaceConfig` 以 `createDefaultConfig()` 为底重新合并，旧结构里多出来的键会被丢掉。
- **500ms 内的连续改动合并成一步**。拖一次滑块会触发几十次 patch，不合并的话按一次 Ctrl+Z
  只退一个像素。
- 输入框内的 Ctrl+Z 不拦截（`isTextTarget` 判断 INPUT/TEXTAREA/SELECT/contentEditable），
  交还给 Chromium 的原生文本撤销。
- **主进程的应用菜单去掉了 `role: 'undo' / 'redo'`**：菜单快捷键会抢在渲染层之前处理，
  留着的话设置页永远收不到 Ctrl+Z。剪切/复制/粘贴不受影响。

### 顶栏「重置本页」

`重置本页` 只恢复当前页面的配置片段（日期与文案 / 外观 / 布局 / 行为 / 系统集成），
列表页、预设页、关于页不显示。布局页若 `transparent` 变了，会额外调
`window.cd.setTransparency()` 重建组件窗口 —— 直接 patch 那个字段不会重建窗口。

### 编辑页常驻预览

从前只有「正在编辑桌面显示项」时才能通过桌面卡片看到效果，改别的项等于盲调。
`useCountdownCard` 新增 `item?: () => CountdownItem | null` 选项，
`CountdownPreview` 新增 `item` prop：传了它就完全按这一项的解析结果渲染（标题/日期/文案/外观），
不再走 `activeId`。

编辑页布局是 `.editor-body { grid-template-columns: minmax(0,1fr) clamp(240px,30%,360px) }`，
预览列 `position: sticky; top: 62px`（吸在 `.editor-sticky` 下面），窄于 1150px 时隐藏。
列宽用百分比夹上下限：固定 260px 在宽屏里空、在窄屏里把表单挤扁。

### 预览自动缩放（内容不出格）

卡片宽度可以设到 680、字号可以拉到 140，而预览列只有两百多像素 —— 不处理就直接溢出栏外。

`CountdownPreview` 的做法是量**未经变换**的布局尺寸再等比缩：

- `.preview__content` 用 `width: max-content` + `offsetWidth/offsetHeight`（不受 transform 影响）量自然尺寸；
- 可用宽 = `clientWidth - padding`，可用高 = **`max-height` 的解析值 - padding**。
  高度这里千万不能读 `clientHeight`：外层盒子高度是按缩放结果回填的，拿它当输入会
  「缩一点 → 盒子变矮 → 再缩一点」来回震荡。`max-height` 是外部常量，天然稳定。
- 缩放后把盒子高度设成 `contentHeight * scale`（`.preview__box`），下面那行说明文字不会被空白推走；
  不这么做会看到卡片缩在上半截、下面空一大块。
- `scale` prop > 0（预设缩略图）时整条自动逻辑关掉，仍按固定比例、从中心缩放，和以前一致。

`.preview--fit` 的 `max-height` 由使用方给：编辑页 `min(52vh, 480px)`，设置页右侧竖栏 `min(56vh, 460px)`。

### 文案变量

`defaults.ts` 导出 `TEXT_VARIABLES` / `textVariables()`，`useCountdownCard` 里对
副标题与三条状态文案统一走 `applyTemplate`：

| 变量 | 值 |
| --- | --- |
| `{days}` | 相差天数（绝对值） |
| `{year}` `{month}` `{day}` | 实际生效日期的年 / 月 / 日（数字） |
| `{week}` | 星期几，跟随界面语言（周五 / Fri） |
| `{date}` | 完整日期（带时刻的目标会附上 HH:mm） |

日期类变量取的是 `ComputedResult.effective`（annual 模式会自动滚到下一次），
不是用户填的原始字段 —— 否则 `{year}` 在跨年后会停在去年。
界面上用 `TextVariables.vue` 把这份清单渲染成一排按钮，点一下追加到文案末尾，
用户不用记语法也不会拼错；副标题与状态文案共用同一套。

### 滑动条抓手

`el-slider` 的抓手 20px、轨道 6px，值落在最左/最右时抓手有半个圆伸到轨道外。
以前 `TextStyleEditor` 给 `.slider-field` 和 `.el-slider` 加了 `overflow: hidden` 去压内部溢出，
结果抓手在两端被切成半个圆。现在：

- 去掉那两条 `overflow: hidden`；
- `.slider-field__slider` 左右各留 8px padding、`overflow: visible`，抓手缩到 14px；
- 抓手加一圈 `color-mix()` 的淡色晕影，压在端点时轮廓依然完整。

`ui-check.cjs` 会顺着抓手往上遍历所有祖先，只要有一个 `overflow != visible` 且抓手越界就判失败。

### 在线更新（自己实现，没引 electron-updater）

更新源就是打包时生成的 `release/latest.yml` + 安装包，传到任意静态直链即可
（GitHub Releases 的 `releases/latest/download/latest.yml`、对象存储、自己的服务器都行）。
默认值在 `src/shared/update.ts` 的 `DEFAULT_UPDATE_FEED`，运行时可被
`runtime.update.feedUrl` 覆盖（改这一项时主进程会自动把上次的检查结果清空）。

- **纯函数在 `src/shared/update.ts`**：`parseUpdateFeed`（兼容 latest.yml 与 JSON）、
  `compareVersions`、`resolveFeedUrl`、`formatBytes`。`scripts/updater-check.cjs` 用
  `release/latest.yml` 的真实内容跑断言，不需要 Electron。
- **状态机在 `src/main/updater.ts`**：`idle / checking / latest / available / downloading /
  ready / error / disabled` 八个 phase，主进程唯一持有，通过 `update:state` 推给设置窗口。
  设置窗口关掉再开，看到的还是上次结果，不会退回「没检查过」。
- **三步分开**：检查 → 用户点下载 → 用户点安装。不静默下载 80MB，也不在装完之后才弹窗；
  没有代码签名，安装时系统本来就会拦一次，让用户自己按下那个按钮更诚实。
- **网络这一层专门加固过**（第一版「极易失败」，全是 `Fetch Failed` 这类原始错误）：
  - 更新源可以写多个地址（空格/逗号/换行分隔），按顺序试；有多个候选时每个只试一次，
    把时间留给下一个候选，而不是在第一个上死等两轮。
  - 单地址时自动重试一次（网络抖动），404 这类确定性失败不重试。
  - 超时 12s；下载失败会从头再来一次（80MB 的包断一次就白下太亏）。
  - 检查走 `session.fromPartition('update-feed')`，代理单独配置（`runtime.update.proxy`，
    留空跟系统、`direct` 直连、或 `http://127.0.0.1:7890`）。只有更新请求走这个代理。
  - 错误用 `humanize()` 翻成人话：ERR_CONNECTION_RESET → 「连接被重置，可能是网络被拦截」，
    ERR_NAME_NOT_RESOLVED → 「域名解析失败，检查 DNS 或代理」，HTTP 404 → 「更新源不存在」……
    原始错误码只留在 console。
  - 失败态给两个出口：「检查更新」重试 + 「手动下载」打开 release 页（`releasePageOf` 从
    feed 地址推出来），并提示可以配代理。
  - 静默检查失败**不**把界面染红（phase 留在 idle，只在文案里带一句），否则用户什么都没做
    就先看到一条错误。手动点的那次才进 `error`。
  - 已经下完但没装的包会被复用：再次检查发现本地文件大小对得上，直接回到 `ready`。
- 下载用 `net.request`（吃系统代理）+ `pipeline` 过一层 Transform 边下边算 sha512，
  校验不过直接删包 —— 这东西是要被执行（run）的，不能只信 content-length。
- 启动 12s 后静默查一次（`autoCheck` 为真、非开发模式）；发现新版本只发一条系统通知，
  不代替用户点下载。
- **更新源能在界面上换**（关于页「软件更新」卡片底部一行）：官方 GitHub +
  4 个第三方镜像（gh-proxy.com / gh-proxy.net / gitproxy.click / ghproxy.link）+ 自定义 + 不使用。
  发布流程见 `docs/release-checklist.md`。选预设直接写 `runtime.update.feedUrl`；「自定义」只是把地址栏交给你，
  输入框在**失焦或回车**时才落盘 —— 每敲一个字符都 patch 一次的话，主进程会跟着重置一遍更新状态。
  - `UPDATE_FEED_PRESETS` 与 `presetIdOf()` 在 `src/shared/update.ts`：当前地址对得上哪个预设、
    对不上算 custom、空串算 off，都是纯函数，`updater-check.cjs` 覆盖到每一个镜像。
  - 下拉项由预设表 `v-for` 生成，加镜像只改 `shared/update.ts` 一处 + 一条 i18n 文案。
  - **镜像的代价写在界面上**，不藏在文档里：清单和安装包同源，第三方可以同时伪造两者，
    sha512 在这条链路上等于没有。它解决的是「连不上」，不是「不安全」。
  - 换源后主进程的 `watchUpdateConfig` 会把上次结果清空（phase → idle），所以不自动重查，
    由用户点「检查更新」再走一遍。
- 关于页第一张卡就是「软件更新」：`phase` 直接映射成文案与按钮，进度条铺在说明下面。
  弹窗干不了这件事——检查/下载/安装是有中间态的链，弹窗一关就看不到进度了。

#### 排查「检查更新总是失败」：`npm run doctor`

`scripts/update-doctor.cjs` 分三层给结论，每层都能单独定位：

1. **DNS**：域名是否被解析到 `127.0.0.1`（hosts 屏蔽的典型症状，`dns.lookup` 读的就是 hosts）；
2. **HTTP**：更新源能不能取到，404 直接指向「latest.yml 没传」；
3. **资产**：`latest.yml` 里那个安装包在不在、`content-length` 与 `size` 是否一致（只发 HEAD，不下 110MB）。

用法：`npm run doctor`（读配置文件里的源，没有就用默认）或
`npm run doctor -- <url>`（临时指定，多个用空格/逗号分隔）。判定按「最坏的一层」出，不让用户自己拼结论。

2026-10 实测到两类真实原因，**都不是程序 bug**：

| 现象 | 真实原因 | 证据 |
| --- | --- | --- |
| 立刻失败，Electron 报 `Fetch Failed` | 本机 hosts 把 `github.com` 等 23 个域名写到 `127.0.0.1` | 同一个 `net.request`，加 `--host-resolver-rules` 指到 `20.205.243.166` 后拿到 GitHub 的真实 HTTP 响应 |
| 网络通了仍然失败，提示「更新源不存在」 | Release 里只有 `.exe`，没传 `latest.yml` | `.../releases/download/v1.2.1/CountingDown_Setup_1.2.1.exe` → 200（116102692 字节，与本地一致）；`.../latest.yml` → 404 |

**发布清单**（少一个都白搭）：`CountingDown_Setup_x.y.z.exe`、`latest.yml`、（可选）`.blockmap`。
文件名不能改——`latest.yml` 的 `path` / `files[].url` 必须与实际资产同名，否则装完解析不到地址。

排查顺序建议：先 `npm run doctor`，再看是不是 404（发布问题）而不是超时（网络问题）。
两者混在一起时，人很容易把「文件没传」误判成「被墙」。


### 安装包（NSIS）界面重构

默认的 NSIS 界面是灰白空页，跟应用的视觉完全两回事。现在四页全是自己的东西：

- **欢迎页是自绘的**。electron-builder 的辅助安装器**根本没有**内置欢迎页
  （`assistedInstaller.nsh` 里只有 `!ifmacrodef customWelcomePage`），所以要么从目录页开始，
  要么自己画。这里用 `customWelcomePage` 画了一页：页面主体只有一张
  `installerWelcome.bmp`（520×225，脚本生成），图上就是图标 + 名称 + 版本 + 三条「装完之后」，
  页面上不放任何控件 —— 控件一个没有，就不会错位。
- **「为谁安装」那一页去掉了**：`perMachine: false` 时 electron-builder 一定会插一页
  「仅为我 / 所有用户」。一个倒计时组件不需要问这个。定义 `customInstallMode` 宏、
  设 `$isForceCurrentInstall = 1`，那一页的 PRE 回调会自己 `Abort`，安装模式仍是 per-user、不弹 UAC。
- 安装位置页与完成页改成自己的文案；进度条用 `MUI_INSTFILESPAGE_PROGRESSBAR colored`。
- `installerSidebar.bmp`（164×314）/ `installerHeader.bmp`（150×57）继续用在完成页与页头，
  由 `scripts/make-installer-art.ps1` 生成（`npm run art`）。
  **必须是 24 位无 alpha 的 BMP**；PowerShell 5.1 按 ANSI 读 `.ps1`，脚本里有中文就必须存
  **UTF-8 with BOM**，`Get-Content` 读 package.json 也要显式 `-Encoding UTF8`。
- 两个踩过的坑：
  1. `nsis.include` 的路径是相对 **buildResources**（`resources/`）解析的，
     写 `"resources/installer.nsh"` 会先去找 `resources/resources/...`，最后才回落到项目根 —— 能用但没必要。
  2. 自定义 include 是在 `installer.nsi` **之前**注入的，那时 MUI2 / LogicLib / nsDialogs 都还没 include。
     所以在 include 里直接写 `Function` 会报「`${If}` 未定义」；函数必须写在 `!macro customWelcomePage` 里面，
     等宏展开（那时依赖都已就位）再定义。
- **改完能看见**：`scripts/grab-installer.cjs` 会启动安装包，用 `desktopCapturer` 抓「倒数日 安装」
  这个窗口的缩略图，存成 `.verify/installer-page1.png`，然后 taskkill 掉。第一页能这样验，
  后面几页要模拟点「下一步」才能翻，那会真的把应用装到本机，所以没做。
- 其余 `nsis` 选项：`perMachine: false`（按用户装，不弹 UAC）、`allowElevation`、
  `createDesktopShortcut: "always"`（覆盖安装也重建快捷方式）、`menuCategory: false`、
  `uninstallDisplayName`、`deleteAppDataOnUninstall: false`（卸载保留配置）、
  `differentialPackage: true`、`language: 2052`。`publisherName` 已移除（新版标 deprecated）。

### 安装器：自己写的（installer/）

NSIS 能改的只有图片和文案，控件全是 Win32 原生，撑不起「整个窗口重构」。所以第二轮直接换了实现：
`installer/` 是一个 **C# WinForms（net48）** 的自写安装器，窗口、按钮、勾选、进度条全部自绘。

- **为什么是 net48**：Windows 10/11 自带 .NET Framework 4.8，用户不用先装运行时；
  编出来只有 **36 KB**。换成自带 Electron 的安装器要多 ~90MB，换 .NET 8 self-contained 要多 ~70MB。
- **界面**：720×460 无边框窗口（`Region` 圆角 + 细边框），自绘标题栏（可拖动、双击不最大化）、
  渐变图标、`CheckRow`、`FlatButton`、`ThinProgress`。四个状态：选项 / 安装中 / 完成 / 失败。
- **payload 格式**：`exe + payload.zip + (int64 长度, "CDSETUP1")`。安装时从自己的文件尾部
  把 zip 段抠出来落到临时文件，再用 `ZipArchive` 逐条解压（能报进度，也做了 zip-slip 防护）。
- **卸载**：把自身复制成 `<安装目录>\Uninstall.exe`；运行时复制到 `%TEMP%` 再由副本去删目标目录。
  ⚠️ `--purge` **不能**无条件自删：从安装包本身跑 `--purge`（测试/手动清理）时自删会把安装包删掉 ——
  第一次就踩了，现在只在 exe 位于临时目录时才自删。
- **卸载删不干净**：`Directory.Delete(root, true)` 一把梭不行（一个文件被占就整体中止）。
  改成逐文件删 + 24 轮重试，最后如果目录空了但删不掉，`MoveFileEx(DELAY_UNTIL_REBOOT)` 兜底。
- **注册表**：`HKCU\...\Uninstall\CountingDown`（DisplayName/Version/Icon/UninstallString/EstimatedSize）
  + 可选 `HKCU\...\Run` 自启（`--hidden`）。
- **静默模式** `--silent --dir <目标>`：在线更新走这条，不再让用户看第二遍安装向导
  （`src/main/updater.ts` 的 `installUpdate` 已改成传这两个参数）。
- **打包**：`npm run dist` = `electron-vite build` → `electron-builder --dir` → `scripts/build-installer.cjs`，
  后者写 BuildInfo 版本号、`dotnet build`、用**系统 bsdtar**（`C:\Windows\System32\tar.exe`）压 zip、
  拼接到 exe 尾部、算 sha512 写 `latest.yml`。
  > Git Bash 里的 `tar` 是 GNU tar，会把 `H:\...` 当远程主机，报 `cannot connect to H: resolve failed`。
- **体积代价**：zip(deflate) 压出来 110.7 MB，原来 NSIS(LZMA) 是 82.6 MB —— **多 28MB**。
  想省回来就得改用 xz + 系统 `tar.exe` 解压（约 82MB），但进度条会变粗、还多一个外部依赖，暂时没做。
- **验证**：`scripts/setup-e2e`（.verify 里）启动安装器 → 等文件数稳定 → 截图 → 清理；
  `--silent` 路径另测过：装 733 个文件 / 273MB，卸载后目录清空。
  > 测试里「装完立刻 purge」会剩几十个文件（刚写完的目录还有句柄挂着），隔几秒再跑一次就干净了；
  > 真实卸载不会这么急，但这条记下来免得下次误判成 bug。

### 安装器的过场与动画

界面：**三步向导**（主界面 → 安装位置 + 三个开关 → 确认清单），底栏按钮随步骤在
「取消 / 下一步」和「上一步 / 安装」之间切换。

所有动画由 `Anim.cs` 驱动，**按真实时间算进度再套缓动**，不是「每帧加几像素」。

| 位置 | 时长 / 曲线 | 说明 |
| --- | --- | --- |
| 翻页 | 320ms `InOutCubic` | **先把两页拍成位图再滑动位图**，见下 |
| 窗口出现 / 关闭 | 220ms / 160ms `OutCubic` | 动 `Form.Opacity`，淡入淡出 |
| 按钮、标题栏角标悬停 | 120ms `OutCubic` | 颜色用 `Mix.Between` 插值，不是瞬间变色 |
| 进度条 | 指数逼近 `1-e^(-dt*11)` | 目标值跳变时显示值滑过去，不会一节一节蹦 |
| 状态文字切换 | 200ms `OutCubic` | 旧字淡出、新字淡入 |
| 完成页打勾 | 460ms `OutBack` | 0.72 → 1 缩放 + 勾线 alpha 淡入 |

**翻页为什么必须走位图**：早先是直接改 `Panel.Left` 让两页滑。Panel 里的 TextBox、按钮
都是真实子窗口，每帧移动一次就要重排重绘一次，观感就是「一帧一帧硬拽」。
现在翻页时先 `DrawToBitmap` 把两页各拍一张，隐藏真实控件，每帧只 `DrawImageUnscaled`
两张图 —— 一次绘制、零子窗口移动。

**动画驱动有两条腿**：`Application.Idle`（队列一空就跑，正常就是满帧）+ 8ms 的
WinForms Timer（Idle 在某些情况下迟迟不触发）。两者都调 `Pump()`，内部按 4ms 去重。

**每帧要 `Invalidate()+Update()`，不能只 `Invalidate()`**：只标脏的话，消息循环会把
多帧合并成一帧（实测 320ms 只画了 3 次）。同步 `Update()` 保证每帧都落一次。

**帧率自检 `--shot bench`**：连翻两次页，统计滑动期间的帧间隔。
本机实测 **avg 14.3ms（70fps）、p95 20.2ms、max 23.6ms**。
（第一版量出来是 1.7fps —— 那是统计代码写在 `OnPaint` 末尾、而滑动分支 early return 了，
量的是空气。改到开头才拿到真数字。）

**最小化要原生动画**：无边框窗体默认没有 `WS_MINIMIZEBOX`，最小化是「啪」地消失。
在 `CreateParams` 里补 `WS_MINIMIZEBOX | WS_SYSMENU`，DWM 才会走系统那套缩放淡出。

**图标一致**：`<ApplicationIcon>..\resources\icon.ico</ApplicationIcon>` 写进 exe，
窗体再 `Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath)` 兜一层，
任务栏 / Alt+Tab / 资源管理器看到的是同一个「27」图标。
`.verify/icon-check.cjs` 用 `app.getFileIcon` 把两个 exe 的图标都抓出来比对过：
raw 与打包后都是 48x48 / 1940 字节 / 1912 个不透明像素，完全一致。

**截图用 `--shot step1|step2|step3|installing|done|bench`**：离屏 `DrawToBitmap` 直接写 PNG。
`desktopCapturer` 那套抓图会拿到上一帧，做素材别指望它。

### NSIS 的天花板（下次别再试了）

想要「现代安装器」那种观感，NSIS 做不到，原因是硬约束不是配置问题：

- 按钮行、目录输入框、单选/复选、进度条都是 **Win32 原生控件**，只能改文字和尺寸，
  改不了圆角、颜色、hover。所谓「美化」只能做背景图 + 页头横幅 + 文案。
- 页面骨架由 electron-builder 的 `assistedInstaller.nsh` 决定，能用的是
  `customWelcomePage` / `customFinishPage` / `customPageAfterChangeDir` / `customInstallMode` 这几个宏，
  以及 `MUI_*` 那批 define。想改页面顺序就得自己写 `.nsi`（`nsis.script` 支持），
  但那样要自己接上 electron-builder 的解包、快捷方式、卸载注册逻辑，风险远大于收益。
- 全幅背景图要靠猜页面尺寸（本机实测页面主体约 533×245，随 DPI 变化），
  所以欢迎页做成了「一张图 + 不留控件」，而不是在图上摆控件。
- 真要做成现代 UI，只有一条路：自己写安装器（Electron/WPF/WebView2），
  代价是多一个 ~90MB 的可执行文件，并且解包、快捷方式、卸载注册、更新衔接全部自己实现。
  对一个 80MB 的桌面小组件来说，这笔账不划算。

### 设置界面左上角的标识

以前是一块写着「CD」的渐变方块，跟任务栏/开始菜单里的图标完全不是一个东西。
现在直接 `import appIconUrl from '../../../../resources/icon.png'`，用真图标（Vite 会把
PNG 打包进 `out/renderer/assets/`，CSP 的 `img-src 'self'` 放行）。
`ui-check.cjs` 断言它是 `IMG` 且 `naturalWidth > 0`，防止哪天又变回色块。

### 设置界面的信息架构（这一轮的调整）

- 「日期与文案」从「倒数日」组挪到「外观与风格」组，紧挨「外观」—— 它改的是卡片上显示什么。
- 页面标题「全局日期设置」→「默认日期」，编辑页里的「跟随全局日期设置」→「跟随默认日期」。
- 全局页卡片头上那些「跟随全局」标签全部删掉：那是**全局**设置页，没有比它更「全局」的东西可跟。
- 列表行不再显示「此项已覆盖外观」—— 属于调试信息，用户不需要在列表里看到。
- 侧栏左下角只留「关于」：关闭按钮删掉（窗口右上角和 Esc 都能关，再摆一个纯占位），
  「关于」从导航组里搬到这儿，少一个只有一项的分组；「恢复默认设置」也搬进「关于」页。
  `AboutPanel` 仍是 `v-else` 兜底分支，所以 `currentLabel` 单独给 `section === 'about'` 补了标题。
- 「关于」页尾部两张卡片：重置设置（恢复默认设置）与退出程序（彻底退出），
  都用 `.danger-row`：左边一句后果说明、右边一个按钮。这类操作必须把后果摆在明面上，
  不该藏在 FieldRow 的问号 tooltip 里。恢复默认设置的重置逻辑仍在 `SettingsApp`
  （要一并清空撤销栈），AboutPanel 只 `emit('reset')`。
- 「彻底退出」从「系统」搬到「关于」并改名（原来叫「退出程序」）：
  系统页放的是配置类开关，而这是结束整个进程 —— 语义上属于「关于这个程序」，
  放远一点也免得手滑。


### 备份 / 恢复与到期提醒

- `config:export` / `config:import`：主进程走 `dialog` + `src/main/backup.ts`。
  备份文件带 `app / version / exportedAt / config` 外壳；导入兼容「只有 config」和「直接是配置」，
  只校验 `countdowns` 是数组，其余字段交给 `mergeConfig` 兜底。导入后重建组件窗口并重排托盘。
- `src/main/reminders.ts`：每 15 分钟检查一次，`computeCountdown` 结果为 `today` 的启用项弹一次
  系统通知，`notified` 记录 `id → 日期`，同一天不重复。`runtime.notifyOnToday` 是开关（默认 true）。
  内存记录在重启后清空是有意的：否则关掉应用再打开就永远收不到当天提醒。

### 这一轮改到的验证脚本

- `appearance-check.cjs`：卡片数 4 → 5（多了「一键配色」），并先点 `[data-cd-advanced]`
  再数控件；`.settings-preview` → `.settings-rail`。
- 其余脚本仍按 `.settings-nav__item` 文字定位，折叠不影响它们（`v-show` 保证节点在 DOM 里）。

> **本轮未能实跑 GUI 脚本**：本机 `node_modules/electron/dist/electron.exe` 不存在
> （Electron 二进制未下载），只完成了 `tsc` / `vue-tsc` / `electron-vite build` 三道静态验证。
> 复跑前先 `pnpm install` 让 Electron 走镜像补下二进制，再按下面的「验证脚本」逐条执行。

---

## 1.2.0 的结构调整

### 顶栏动作区统一

四个动作固定为「图标 + 文字 + plain」，顺序 **撤销 / 重置本页 / 预览 / 显示倒数日**。
不再按页面出现或消失 —— 不适用时置灰（重置本页在列表/预设/关于页、预览在无预览的页面），
避免同一个位置时而只有图标、时而带文字。撤销栈空时按钮也置灰。

### 显示模式下放到单项

- `CountdownItem.displayMode: DisplayMode | ''`（空串 = 跟随全局），
  `ResolvedCountdown.displayMode` 是解析后的结果。
- `useCountdownCard` 的 `precisionMode` 改从 `resolved` 取，不再直接读 `config.behavior`。
- 编辑页新增「显示」分区，选项里有「跟随全局（当前：…）」；`computeItem` 与 `snapshotOf` 都要带上它，
  否则脏标记会误报。
- **单位字的全局设置搬到了「日期与文案」**（行为页只留显示格式）；编辑页的单项单位字覆盖不动。

### 布局并入行为，「系统集成」改名「系统」

- 侧栏删掉「布局」，`SectionId` 里也删掉 `'layout'`；行为页渲染 `BehaviorPanel` + `LayoutPanel`，
  外面包一层 `.panel-stack`（`.settings-content > *` 是 `flex: none`，包一层不影响布局）。
- 窗口类开关收进 LayoutPanel 的「窗口」卡片：**始终显示在最前 / 允许拖动 / 鼠标点击穿透 / 窗口透明**。
  「置顶」从此和窗口类设置待在一起，不再孤零零躺在行为页。
- 行为页的「重置本页」同时重置 `behavior` 与 `runtime.window`；透明值变了还要走
  `setTransparency()` 重建窗口，直接 patch 那个字段不会重建。

### 通知拆成两层

- `runtime.notifications`：总开关（相当于通知权限），默认 `true`。
- `CountdownItem.notifyOnToday`：**默认 false，不跟随全局**，在编辑页里逐项打开。
- `reminders.ts` 先看总开关，再看单项开关；旧的 `runtime.notifyOnToday` 不再读取。

### 托盘菜单

- **真 bug**：`buildMenu` 里「显示 / 隐藏倒数日」是无条件 `push` 的，`trayMenu.toggleVisible`
  从来没人读 —— 所以在设置里取消勾选毫无反应。现在包在 `if (tray.toggleVisible !== false)` 里。
- 新增 `TrayMenuConfig.clickThrough`：托盘右键多一个「鼠标点击穿透」勾选项，
  「系统」页也有对应的「这个菜单项要不要显示」开关（和其它菜单项一致）。

### 组件窗口不进任务栏

- `createWidgetWindow` 里拦截 `close`：非退出流程时 `preventDefault()` + `hide()` + `widgetVisible=false`。
  即使外壳给了它任务栏按钮，从那里关掉也只会隐藏，不会销毁窗口（销毁后托盘文案会错乱）。
- `show` 事件里再补一次 `enforceSkipTaskbar()`：任务栏按钮的注册发生在 show 之后，
  只在创建时设一次并不可靠。

### 其它

- **移除外观页顶部的一键配色**：与「预设主题」页职责重复，入口只留在预设页；相关 i18n 与 CSS 一并删掉。
- **透明窗口文案改写**成因果句：「开启后卡片外围能透出桌面……如果卡片后面出现一块浅色方块，关掉它即可」。
- 预设缩略图/详情全部走真组件（`CountdownPreview` 的 `still` + `scale`），不再手搓假卡片。
- 脚本同步：`布局` / `系统集成` 的导航目标改为 `行为` / `系统`；`units-check` 的单位字目标页改为
  `日期与文案`，显示模式改由 `updateConfig` 写入；`visual-audit` 的页面表同步。

> 本轮同样只过了 `tsc` / `vue-tsc` / `electron-vite build`，GUI 脚本需要在本机跑
> （沙箱拦 `reg.exe`，且注入了 `ELECTRON_RUN_AS_NODE=1`）。

---

## 1.2.1：安装向导三步化与动画重做

版本号只影响两处：`package.json` 的 `version`，以及 `installer/BuildInfo.cs`
（后者由 `scripts/build-installer.cjs` 在构建时按 `package.json` 改写，**不要手改**）。

界面的细节（位图滑动、双路驱动、帧统计位置、图标一致性、`WS_MINIMIZEBOX`）都写在
「安装器：自己写的（installer/）」那一节里，这里只记结论性的取舍：

- **动画一律按「已过时间 / 总时长」算进度再套缓动**，不存在「每帧加几像素」的写法。
  后者在慢机器上变慢动作、快机器上一闪而过，时长不可控。
- **滑动必须贴位图**：Panel 里的控件都是真实子窗口，每帧移动要重排重绘，观感是一格一格。
- **每帧 `Invalidate() + Update()`**：只标脏会被消息循环合并（实测 320ms 只画 3 帧）。
- **统计代码的位置会被 early return 骗到**：`OnPaint` 末尾记帧间隔，滑动分支提前返回就一帧都记不到，
  第一版量出 1.7fps 是「量了空气」。要记就记在最前面。
- 向导页数 3 页（主界面 / 安装位置 / 确认），`_step` 与 `PageAt()`、`ApplyPhase()` 一一对应；
  页码变化后 `UpdateFooterText()` 决定「取消 / 上一步」和「下一步 / 安装」。

---

## 配置文件

由 `electron-store` 持久化在 `%APPDATA%\countingdown\config.json`
（`src/shared/types.ts` 是唯一的类型来源）：

```jsonc
{
  "countdowns": [
    {
      "id": "cd_xxx",
      "name": "元旦",
      "enabled": true,
      "target": { "mode": "annual", "date": "", "month": 1, "day": 1 },  // once 模式下 date 为空 = 跟随全局
      "text":     { "hint": "", "futureText": "", "todayText": "", "pastText": "", "unit": "" }, // 空串 = 跟随全局
      "appearance": {}                // 只出现被覆盖的字段，如 { "opacity": 0.8, "background": { "color": "#ff0055", "radius": 30 } }
    }
  ],
  "activeId": "cd_xxx",               // 当前显示在桌面上的项（只会指向 enabled 的项）
  "target":     { "mode": "annual|once", "date": "YYYY-MM-DD[THH:mm]", "month": 1, "day": 1 }, // 全局默认日期
  "text":       { "hint", "futureText", "todayText", "pastText", "unit" },                     // 全局默认文案
  "appearance": { "fontFamily", "opacity", "background": {...}, "title": {...}, "count": {...}, "hint": {...}, "status": {...} },
  "behavior":   { "displayMode", "showDaysInPrecise", "showPastDays", "alwaysOnTop" },
  "runtime": {
    "widgetVisible", "toggleHotkey", "startAtLogin", "language", "theme",
    "window": {
      "corner": "top-right",          // 对齐方向（拖动后会变成最近的角落）
      "cornerPreset": "top-right",    // 偏移量的参考基准，'custom' 表示用 anchorX/anchorY
      "anchorX": 0, "anchorY": 0,
      "offsetX": 0, "offsetY": 0,
      "allowDrag": true,              // 是否允许直接拖动组件
      "transparent": true             // 是否使用透明窗口（系统不支持时自动退回不透明）
    }
  },
  "customPresets": [ { "id", "name", "createdAt", "appearance" } ]
}
```

主进程写盘后会把最新配置广播给所有窗口，因此**托盘菜单的改动会立刻反映到设置界面与桌面卡片**。
首次启动会自动迁移旧版「单个倒数日」结构：转成列表第一项、文案上提为全局默认、
旧版 `behavior.opacity` 搬到 `appearance.opacity`，不丢设置。

---

## 已验证项

以下行为在本机（Windows 11 / Electron 33.4.11）实际运行验证通过：

| 项目 | 结果 |
| --- | --- |
| `pnpm dev` / `pnpm run build` / `pnpm run typecheck` | 全部通过 |
| **单位字不受显示模式限制**：只显示天数模式下 4 格全可编辑（`disabled: 0`），打字能落盘 | ✅ `units-check.cjs` |
| **开启单位字覆盖后不再误报未保存**：重进编辑页 `dirty: false`，落盘键序 `[day,hour,minute,second,enabled]` | ✅ `bugs-check.cjs` |
| **组件窗口被销毁后能叫回来**：关闭 → 托盘变「显示倒数日」→ 点击重建并可见、仍不进任务栏 | ✅ `bugs-check.cjs` |
| **新建预设名称只问一次**：保存弹窗手动模式下无名称框，模态框里输入即时反映到预览标题 | ✅ `bugs-check.cjs` |
| 预设调参弹窗收在视口内（`dialogBottom 633 / footerBottom 641 < 视口 681`）、预览不压表单、无横向溢出 | ✅ DOM 几何测量 |
| **调参弹窗的底部按钮在弹窗容器内**（三种窗口高度下 `footerOverElDialog` 与 `buttonOverElDialog` 均 ≤ -8px） | ✅ `tunefit-check.cjs` |
| **取消后弹窗确实隐藏**（不是「看着没了但仍在屏幕占位」） | ✅ `tunefit-check.cjs` |
| **外观页抽取后行为不变**：4 分组 / 17 滑块 / 1 数字输入 / 7 取色器 / 4 段样式，拖滑块仍立刻写全局 | ✅ `appearance-check.cjs` |
| **手动调整预设不碰全局**：模态框里拖动后磁盘 `appearance` 逐字段不变、预设数不变 | ✅ `preset-tune-check.cjs` |
| **手动调整只多预设**：确定后 `customPresets` +1 且存的是草稿那份（圆角 51 vs 全局 18） | ✅ `preset-tune-check.cjs` |
| **手动调整可无痕取消**：取消后预设数与 `appearance` 都不动 | ✅ `preset-tune-check.cjs` |
| **另外两个保存来源未回归**：`global` 仍覆盖全局（44）、`item` 仍写该项覆盖（`#ff0055`/30） | ✅ `preset-sources-check.cjs` |
| 外观页浅色审计在改动前后完全一致（`clipped=2/3`、`contrast=7`） | ✅ 基线对比 |
| 组件窗口出现在主屏右上角（624×600，工作区 1920×1032，`x=1276, y=20`） | ✅ 截图确认 |
| 四角停靠：左上 `20,20` / 左下 `20,412` / 右下 `1276,412` / 右上 `1276,20` | ✅ 自动化验证 |
| 卡片到窗口安全区的四向间距均为 24px | ✅ DOM 测量 |
| 组件窗口不进入任务栏（任务栏只出现设置窗口） | ✅ 截图确认 |
| **卡片上没有任何悬浮按钮**（`.cd-toolbar` 0 个、stage 内 `button` 0 个） | ✅ 自动化验证 |
| 点击穿透：光标离开卡片 → `interactive=false`，落在卡片上 → `interactive=true` | ✅ 自动化验证 |
| **旧配置自动迁移**：单个倒数日 → 列表 1 项，名称/全局文案保留，`activeId` 已设置 | ✅ 自动化验证 |
| **切换列表项**：桌面卡片标题与天数同步变化 | ✅ 自动化验证 |
| **单项外观覆盖生效**：覆盖 `background.color/radius` 后卡片变 `rgba(255,0,85,.78)` / `30px`；切回未覆盖项恢复全局 | ✅ 自动化验证 |
| 设置界面：首屏为列表、导航两级、列表页无预览 | ✅ 自动化验证 |
| 托盘图标存在、右键菜单完整、左键切换显示隐藏 | ✅ 自动化验证 |
| 全局快捷键 `ScrollLock` 注册成功 | ✅ 自动化验证 |
| **深色主题 12 个页面/状态全部 0 个对比度问题** | ✅ DOM 审计 |
| 组件 6 种状态（默认/长文本/精确/超大字号/空态/透明覆盖）均无裁切、无界面溢出 | ✅ DOM 测量 |
| 超大字号（110px + 精确模式）自动缩放到安全区内（自然宽 653px → zoom 约 0.9） | ✅ DOM 测量 |
| **控件零重叠**：1120×820 / 1000×720 / 880×640 三种窗口下各页 `overlapCount = 0` | ✅ DOM 几何测量 |
| **编辑实时预览**：改名称/副标题时桌面卡片同步变化，且 `config.json` 里仍是旧值（未写盘） | ✅ `preview-check.cjs` |
| **放弃修改即还原**：点「返回列表 → 放弃修改」后桌面卡片回到编辑前 | ✅ `preview-check.cjs` |
| **单项外观覆盖实时生效**：草稿 `background.color=#ff0055 / radius=30` 立刻反映到卡片，清空覆盖层后回到全局 | ✅ `preview-check.cjs` |
| **编辑非当前显示项不影响桌面**：只在编辑页预览里变化 | ✅ `preview-check.cjs` |
| **吸顶预览**：表单滚到底（`scrollTop=533`）后编辑页预览仍在视口内（`top=112`），保存按钮同样可见 | ✅ DOM 几何测量 |
| **吸顶栏只去掉上方圆角与上边框**：未吸顶 `12px` 四角 + 四边 `1px` 实色；`scrollTop=80` 时 `0 0 12px 12px` + `border-top-color: transparent`（左/右/下仍是实色），栏体贴住滚动视口顶边、切换前后高度都是 48px；回顶后原样恢复 | ✅ `sticky-check.cjs`（深/浅两套主题）+ 像素取样 |
| **滚动第一帧就是吸顶态**：一次滚 200px 后读第一帧的 class / 圆角 / 边框色，已是 `is-stuck` / `0px` / `rgba(0,0,0,0)` | ✅ `sticky-check.cjs` |
| **列表滚到中途再进编辑页**：一挂载就判定为吸顶（`barTop == 滚动容器顶边`），不需要用户再滚一下 | ✅ `sticky-check.cjs` |
| **保存按钮不再返回列表**：点保存后编辑页仍在、不渲染列表、草稿已落盘、脏标记变「已保存」；新建项「保存→返回」不会被当空白项删掉 | ✅ `sticky-check.cjs` |
| **文案变量**：副标题写 `{month} 月 {day} 日 · {week}` 渲染成 `1 月 1 日 · 周五`（与 Node 侧独立算出的星期一致）；点变量按钮能追加到输入框 | ✅ `ui-check.cjs` |
| **预览不越界**：卡片宽度 680 + 字号 120 时自动缩到 0.31，`overflowLeft/Right/Bottom` 全为 0；默认设置下缩放 0.99（几乎 1:1） | ✅ `ui-check.cjs` |
| **高级参数只有一处入口**：默认收起（无边框/字重/字距），开关打开后三者一起出现 | ✅ `ui-check.cjs` |
| **背景透明度与背景颜色同级且相邻** | ✅ `ui-check.cjs` |
| **滑动条抓手不被裁**：抓手 14px，沿祖先链检查所有 `overflow != visible` 的盒子都没切到它 | ✅ `ui-check.cjs` |
| **导航与文案**：日期与文案在「外观与风格」组；标题为「默认日期」；全局页无「跟随全局」标签；列表无「已覆盖外观」 | ✅ `ui-check.cjs` |
| **左下角**：只剩「关于」一个入口（无「关闭」、无「恢复默认设置」；导航组里不再有关于分组，点它顶栏标题变「关于」） | ✅ `ui-check.cjs` |
| **关于页承载两个重操作**：恢复默认设置（点开确认框、取消后设置项数量不变）与彻底退出 | ✅ `ui-check.cjs` |
| **彻底退出只在关于页**：关于页有「彻底退出」按钮，系统页没有任何退出入口 | ✅ `ui-check.cjs` |
| **更新卡片四态**：available 显示「下载更新」；downloading 显示 42% 与进度条 42%；ready 显示「重启并安装」；error 显示错误文案与更新源地址 | ✅ `ui-check.cjs`（内存状态机） |
| **更新源解析**：真实 `release/latest.yml` → 版本 / 相对地址补全 / sha512 / 体积；JSON 源带上多行发布说明；空串与乱码返回 null | ✅ `updater-check.cjs` |
| **设置界面左上角用真图标**：`.settings-brand__logo` 是 `<img>` 且 `naturalWidth > 0`（不是写着 CD 的色块） | ✅ `ui-check.cjs` |
| **安装包界面资源**：两张 BMP 均为 164×314 / 150×57、24bpp、BI_RGB；`electron-builder` 打包通过（`publisherName` 的 deprecated 警告已清） | ✅ 手工核对 + `release/pack2.log` |
| **新建项放弃编辑即删除**：项数 2 → 3 → 2，磁盘不残留空白项；空列表新建时 `activeId` 也回退 | ✅ `preview-check.cjs` |
| **隐藏设置窗口会丢弃草稿覆盖层** | ✅ `preview-check.cjs` |
| **应用图标**：`resources/icon.ico` 含 16/24/32/48/64/128/256 七层且结构合法 | ✅ ICO 目录解析 |
| **窗口图标就是倒数日图标**：读真实窗口 `WM_GETICON` 的 32×32 位图，与 `resources/icon.ico` 逐像素一致 | ✅ Win32 取值比对 |
| **打包产物**：`ProductName=倒数日`、`FileDescription=倒数日 CountingDown`（任务管理器「名称」列取的就是它） | ✅ 版本信息核对 |
| **打包后图标资源可解析**：`app.asar/resources/icon.ico`、`tray.png` 均能加载成 NativeImage | ✅ 路径解析核对 |

### 验证脚本

`scripts/` 下的脚本可复跑（结果写入 `.verify/`）：

```powershell
node_modules\electron\dist\electron.exe scripts\verify.cjs         # 四角定位 / 点击穿透 / 设置窗口
node_modules\electron\dist\electron.exe scripts\verify-tray.cjs    # 托盘图标 / 菜单 / 左键切换
node_modules\electron\dist\electron.exe scripts\verify-list.cjs    # 旧配置迁移 / 列表切换 / 覆盖 / 编辑子页
node_modules\electron\dist\electron.exe scripts\dom-check.cjs --theme=light   # 设置界面视觉审计（浅色）
node_modules\electron\dist\electron.exe scripts\dom-check.cjs --theme=dark    # 设置界面视觉审计（深色）
node_modules\electron\dist\electron.exe scripts\widget-check.cjs   # 组件 6 种状态的尺寸/裁切测量
node_modules\electron\dist\electron.exe scripts\overlap-check.cjs  # 控件两两重叠检测（多窗口宽度）
node_modules\electron\dist\electron.exe scripts\preview-check.cjs  # 编辑实时预览 / 放弃还原 / 吸顶 / 新建项回滚
node_modules\electron\dist\electron.exe scripts\appearance-check.cjs    # 外观页控件齐全 + 改值确实落盘（薄壳链路）
node_modules\electron\dist\electron.exe scripts\units-check.cjs         # 单位字不受显示模式限制（禁用/标灰/能落盘）
node_modules\electron\dist\electron.exe scripts\preset-tune-check.cjs   # 手动调整模态框：不碰全局、只多预设、取消无痕
node_modules\electron\dist\electron.exe scripts\preset-sources-check.cjs # 另外两个保存来源仍写全局 / 仍写该项覆盖
node_modules\electron\dist\electron.exe scripts\bugs-check.cjs          # 脏标记误报 / 组件窗口销毁后能否叫回来 / 名称只问一次
node_modules\electron\dist\electron.exe scripts\tunefit-check.cjs       # 调参弹窗在 3 种窗口高度下的版面（按钮不外溢、取消后确实隐藏）
node_modules\electron\dist\electron.exe scripts\sticky-check.cjs        # 吸顶栏：吸顶后上方圆角/边框消失、保存不返回列表（DOM 级，不需主进程）
node_modules\electron\dist\electron.exe scripts\ui-check.cjs            # 导航归组 / 默认日期 / 高级参数入口 / 透明度同级 / 预览缩放 / 文案变量 / 抓手不被裁
node scripts\updater-check.cjs                                          # 更新源解析（真实 latest.yml）/ 版本比较 / 地址补全（纯 node，不需要 Electron）
node_modules\electron\dist\electron.exe scripts\capture-readme.cjs # 重新生成 assets/screenshots/ 里的 README 配图
```

> **跑这些脚本时的两个坑**（都已在脚本里处理，改脚本时别改回去）：
>
> 1. **一次只跑一个**。应用的单实例锁是按 `userData` 加的，残留实例会让后续运行在
>    `requestSingleInstanceLock()` 失败后直接 `app.quit()`——表现为「跑完了但一条结果都没有」。
>    `preview-check.cjs` 因此每次用独立的 `userData`。
> 2. **PowerShell 5.1 不会等待 GUI 子进程**（`electron.exe` 是 GUI 子系统）。直接 `& electron.exe ...`
>    会立刻返回、`$LASTEXITCODE` 为空。要么用管道（`| Select-String`），要么用
>    `Start-Process -Wait`。另外用 `Select-Object -First N` 这类会提前关闭管道的消费者时，
>    stdout 会发 EPIPE，脚本里必须忽略它，否则会在异常处理里再写一次 stdout 而无限刷屏。
>
> **不要用 `Start-Process -RedirectStandardOutput/-RedirectStandardError` 跑这些脚本**：实测
> `overlap-check.cjs` 会因此把 EPIPE 的异常栈反复写进自己的日志，把 `.verify/overlap.log`
> 撑到 **168 MB** 并持续烧 CPU（它的 `uncaughtException` 里用 `console.warn` 回写，管道坏了就自激）。
> 要看结果就读脚本自己写的 `.verify/*.log`，或者用管道 + `Select-String`（那一次是干净的）。
> 同理，清理时用 `Get-Process electron | Stop-Process -Force` 收掉残留进程，别让它们继续写日志。
>
> **截图类脚本**（`visual-audit.cjs`、`capture-readme.cjs`）依赖桌面会话未锁屏：
> 锁屏时 GDI 截图返回全白、Electron 的 `desktopCapturer` 返回 0 个源。
> 这种时候改用 **DOM 级量化检查**（`dom-check.cjs`、`widget-check.cjs`）：
> 逐文本节点计算对比度（含半透明背景逐层合成）、检测横向裁切/页面溢出/标签错位/触达尺寸/空块。
> 所有涉及像素的判断都来自 `getComputedStyle` + `getBoundingClientRect`，不依赖肉眼截图。
