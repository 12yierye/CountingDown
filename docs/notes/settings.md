# 设置界面

信息架构、导航分组、撤销重做、预览栏。

**TL;DR**

- 导航按**使用场景**分三组（倒数日 / 外观与风格 / 窗口与系统），不再按代码模块分。
- 预览从顶部横条挪到右侧竖栏，表单可视高度从 383px 回到约 650px。
- 所有改动都能撤销；拖滑块这类连续操作合并成一步。

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
