# 安装器

自写安装器（C#）的页面、动画与打包。

## 安装包（NSIS）界面重构

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

## 安装器：自己写的（installer/）

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

## 安装器的过场与动画

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

## NSIS 的天花板（下次别再试了）

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
