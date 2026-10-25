# 发布检查清单

一句话：**在线更新只认 Release 里的 `latest.yml`，不认仓库里的源码。**
`git push` 对已经装好的用户没有任何影响 —— 他们读的是
`https://github.com/<owner>/<repo>/releases/latest/download/latest.yml`。

## 一次完整发布

1. **改版本号**：`package.json` 的 `version` 改成新版本 → `npm run dist`。
   产物在 `release/`：`CountingDown_Setup_x.y.z.exe`、`latest.yml`。
2. **建 Release**：Tag 写 `vX.Y.Z`（和 `package.json` 一致）。
   **不要勾 Pre-release，也不要存成 Draft** —— 应用读的是 `/releases/latest/`，
   这两种状态不会更新那个「latest」指针。
3. **上传两个文件，名字一个字都别改**：
   - `CountingDown_Setup_x.y.z.exe`
   - `latest.yml`
   （`.blockmap` 可选；我们的更新器不做增量下载，用不上。）
4. **自检**：`npm run doctor`。期望看到：
   ```
   ✓ DNS → ...
   ✓ 更新源可用：版本 x.y.z
   ✓ 安装包可达：110.7 MB，与 latest.yml 一致
   结论：一切正常：检查更新应该能走通
   ```
5. **提交仓库里的 `release/latest.yml`**（`.gitignore` 已经放行这一个文件），
   这样每次发版都能从 diff 看出「这版的包多大、sha512 是多少」。

## 只需要传这些

| 文件 | 要不要 | 说明 |
| --- | --- | --- |
| `CountingDown_Setup_x.y.z.exe` | **必须** | 实际安装包，110MB；GitHub Release 资产上限 2GB，够用 |
| `latest.yml` | **必须** | 版本 / sha512 / 体积，更新器只认它 |
| `*.blockmap` | 可选 | 增量更新用，本项目没启用 |
| `builder-debug.yml`、`win-unpacked/` | **不要传** | 打包中间产物 |

## 为什么必须两个都传

更新器先 GET `latest.yml` 拿到「最新版本号 + 安装包地址 + sha512」，
再下载那个地址并校验哈希。只有 exe 没有清单，第一步就 404 ——
1.2.1 发布时就是这个状态，检查更新永远失败。

## 镜像源

设置界面里的镜像（gh-proxy.com / gh-proxy.net / gitproxy.click / ghproxy.link）
只是把 GitHub 的地址套一层前缀。因为 `latest.yml` 里的安装包地址是**相对路径**
（`CountingDown_Setup_x.y.z.exe`），所以选镜像后清单和安装包会一起走镜像，
不需要额外配置。

两个代价：

- **镜像有缓存**，刚发布的版本可能延迟可见，急的话先切回官方源验证；
- **清单和安装包同源**，第三方可以同时伪造两者，sha512 在这条链路上不提供保护。
  它解决的是「连不上」，不是「不安全」。

## 常见错

| 现象 | 原因 |
| --- | --- |
| 用户端毫无反应 | 只 `git push` 了代码，没发 Release |
| 检查更新 404 | 只传了 exe，没传 `latest.yml` |
| 一直「已是最新」 | 新 Release 勾了 Pre-release，`/latest/` 没指过去；或版本号没涨 |
| 下载 404 | `latest.yml` 里的文件名和资产名不一致（改过名字） |
| 校验失败 | 上传的不是 `npm run dist` 产出的那个 exe，或传了一半 |
