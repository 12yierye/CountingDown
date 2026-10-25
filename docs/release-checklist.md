# 发布检查清单

更新只认 Release 资产里的 `latest.yml`。`git push` 对已安装的用户没有任何作用。

## 发版

1. 改 `package.json` 的 `version` —— **只在发布当天改**。
2. 写 `release-notes`。
3. `npm run dist` → `release/` 出 `CountingDown_Setup_x.y.z.exe` + `latest.yml`（sha512 已对齐）。
4. 提交并打 tag：
   ```bash
   git add -A && git commit -m "release: x.y.z"
   git tag vX.Y.Z && git push origin main --tags
   ```
5. GitHub - Releases
6. 验收：`npm run doctor`

## 传什么

| 文件 | 要不要 |
| --- | --- |
| `CountingDown_Setup_x.y.z.exe` | 必须 |
| `latest.yml` | 必须（404） |
| `*.blockmap` | 可选，本项目不做增量下载 |

仓库里的 `release/latest.yml` 跟着提交，只作留档（能 diff 出版本、体积、sha512）。

## 三条规则

- 版本号**发布时才改**。开发期保持上一个已发布版本号；要区分构建就用 commit hash。
- 发出去之后**不复用同一个版本号**重传，修完直接发下一个版本。
- 镜像只解决「连不上」：清单和安装包同源，第三方能同时伪造两者，sha512 在这条链路上无效。

## 常见错

| 现象 | 原因 |
| --- | --- |
| 用户端毫无反应 | 只 push 了代码，没建 Release |
| 检查更新 404 | 只传了 exe，没传 `latest.yml` |
| 一直「已是最新」 | 勾了 Pre-release；或版本号没涨 |
| 下载 404 | `latest.yml` 里的文件名和资产名不一致 |
| 校验失败 | 传的不是 `npm run dist` 产出的那个 exe |
