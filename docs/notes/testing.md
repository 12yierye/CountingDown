# 验证

可复跑脚本与已确认的行为。

## 这一轮改到的验证脚本

- `appearance-check.cjs`：卡片数 4 → 5（多了「一键配色」），并先点 `[data-cd-advanced]`
  再数控件；`.settings-preview` → `.settings-rail`。
- 其余脚本仍按 `.settings-nav__item` 文字定位，折叠不影响它们（`v-show` 保证节点在 DOM 里）。

> **本轮未能实跑 GUI 脚本**：本机 `node_modules/electron/dist/electron.exe` 不存在
> （Electron 二进制未下载），只完成了 `tsc` / `vue-tsc` / `electron-vite build` 三道静态验证。
> 复跑前先 `pnpm install` 让 Electron 走镜像补下二进制，再按下面的「验证脚本」逐条执行。

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
