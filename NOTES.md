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
