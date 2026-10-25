# 构建与环境

依赖安装、打包路径、本机环境的坑。

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
