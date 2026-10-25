# 在线更新

自实现的更新检查、多源与镜像、排障。

## 在线更新（自己实现，没引 electron-updater）

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

### 排查「检查更新总是失败」：`npm run doctor`

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
