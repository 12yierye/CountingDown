# 开发笔记

实现细节与设计取舍，按主题分册。**结论写在前面，原因在后**；要改某块代码，先看对应那一册。

## 先读这三条

1. **透明窗口很脆**：一旦在窗口首次显示之前调用 `setIgnoreMouseEvents`，Windows 会让分层窗口永久丢掉逐像素透明，只能重建窗口。显示路径统一走 `showWidgetWindow()`（含 1px 抖动重绘），别自己调 `showInactive()`。
   → [notes/architecture.md](docs/notes/architecture.md)
2. **点击穿透不是靠事件**：`setIgnoreMouseEvents(..., { forward: true })` 在本机实测不派发事件，改成主进程每 80ms 轮询光标、命中卡片才临时恢复鼠标事件。所以绘制逻辑里别依赖 `mousemove`。
   → [notes/window.md](docs/notes/window.md)
3. **更新只认 Release 资产**：`releases/latest/download/latest.yml`，仓库里的同名文件不参与。镜像拿不到文件时会返回 200 + 自家首页 HTML，看起来像「清单格式错」。
   → [notes/updater.md](docs/notes/updater.md)

## 分册

| 主题 | 里面有什么 |
| --- | --- |
| [架构与渲染](docs/notes/architecture.md) | 目录结构、透明窗口三层兜底、卡片渲染模式、图标与命名 |
| [窗口行为](docs/notes/window.md) | 点击穿透、四角定位与拖动吸附 |
| [编辑子页](docs/notes/editor.md) | 草稿覆盖层、实时预览、吸顶栏、打字不被回传覆盖 |
| [外观与显示](docs/notes/appearance.md) | 对比度修正、外观覆盖、单位字、预设弹窗、滑块与颜色控件 |
| [设置界面](docs/notes/settings.md) | 信息架构、导航分组与搜索、撤销重做、预览栏、1.2.0 的调整 |
| [在线更新](docs/notes/updater.md) | 自实现的检查 / 下载 / 校验、多源与镜像、错误提示 |
| [安装器](docs/notes/installer.md) | 自写 C# 安装器、三步向导、动画、打包流程、NSIS 的天花板 |
| [验证](docs/notes/testing.md) | 可复跑脚本清单与已确认的行为 |
| [配置文件](docs/notes/config.md) | `config.json` 字段结构 |
| [构建与环境](docs/notes/build.md) | pnpm store、二进制缺失、本机环境的坑 |

## 坑速查

| 现象 | 原因 |
| --- | --- |
| 卡片一显示就多一块浅色背板 | 分层窗口在 `showInactive()` 后不重绘，DWM 拿不透明底填了 → 架构 |
| 卡片整块变白、怎么调都回不去 | 首次显示前调用了 `setIgnoreMouseEvents` → 架构 |
| 鼠标停在卡片上却被穿透 | 命中测试用窗口坐标，检查 `screenX/Y` 换算 → 窗口 |
| 打一个字就跳回旧值 | 草稿用 `computed` 初始化，被回传覆盖 → 编辑 |
| 编辑页预览比实际大一圈 | 预览列宽度变了但缩放没重算 → 设置 |
| 检查更新 404 | Release 里没传 `latest.yml` → 更新 |
| 「返回的是网页而不是清单」 | 镜像拿不到文件，回了自家首页 → 更新 |
| 安装器截图拿到上一帧 | `capturePage` 有延迟，用 `--shot` 离屏出图 → 安装器 |
| `pnpm install` 报 cafs 拒绝访问 | store 目录不可写，`.npmrc` 已指定 `.pnpm-store` → 构建 |
| PowerShell 脚本报语法错 | 5.1 按 ANSI 读 `.ps1`，含中文必须存成 UTF-8 with BOM → 安装器 |
