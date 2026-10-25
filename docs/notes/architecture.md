# 架构与渲染

进程结构、渲染模式、图标与命名。

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
