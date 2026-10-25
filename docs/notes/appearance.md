# 外观与显示

外观覆盖、单位字、对比度、预设、控件细节。

**TL;DR**

- 对比度按 WCAG AA 修：浅色主题正文/次要文字改为 `#1f2329 / #4a5160 / #5b6474`；彩色实心按钮上的白字，浅色主题加深底色、深色主题改深色文字。
- 「外观覆盖」是**逐字段**的：勾了才覆盖，没勾跟随全局；预设只保存外观，不碰文案与显示模式。
- 单位字四项永远可填，当前模式下用不到的段落只是淡一档，不是禁用。

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

### 预设系统的第二轮整理（2026-10）

第一版能跑，但「潦草」在三个地方：**同一张卡片被手搓了三遍**（列表缩略图、详情弹窗、
调参弹窗各一套），缩略图还是假的（硬编码 `128` / `5 月 20 日`，不渲染状态行与单位字）；
**套用后没有任何「正在使用」的反馈**；**每张卡挤三个按钮，却不能重命名或覆盖**。

现在的做法：

- **缩略图直接用真组件**：`<CountdownPreview sample still :scale="thumbScale(...)" />`。
  `still` 是新加的 prop，关掉每秒重算的 interval（一次渲染十几份，没必要各跑一个定时器）。
  `thumbScale = min(0.52, 44 / count.fontSize)` —— 按「大数字不超过 44px」缩放，
  超大字号不会撑破 118px 画布。`PresetDetailDialog` 里那张大图同样换成真组件。
- **使用中标记**：逐字段比较（`sameAppearance`），**不要用 `JSON.stringify` 比较** ——
  两份外观对象的键序不一定一致，会出现「明明是同一套却不打标」。
- **操作收敛**：卡片只留「套用 / 查看参数 / ⋮」，重命名、用当前外观更新、复制、删除收进下拉。
  内置预设也能「复制为我的预设」，得到一个可编辑的起点。
- **保存弹窗**：三个来源从「三个单选 + 一段会变的灰字」改成三块可点击的说明卡；
  新增显式的「保存后立即套用到全局」（默认不勾），保存动作不再偷偷改全局。
  来源语义没动（`global` 仍写一次全局外观，实际是同值 no-op；`item` 仍把该项覆盖写成合并结果），
  `preset-sources-check.cjs` 守住的那两条继续成立。
- 预设仍然**只保存外观**，页面底部现在明说了「文案、显示模式与单位字不随预设切换」。

> 与脚本的兼容点（改这块时别踩）：
> 1. 保存弹窗底部那个按钮的文案必须**包含「手动调整参数」**（`bugs-check` / `preset-tune-check`
>    按这个子串点它），所以写的是「下一步：手动调整参数…」而不是「下一步」。
> 2. `.preset-footer__actions` 里必须仍有文字为「查看参数」的 `button`
>    （`verify-1.1.0` 数它 ≥ 5），所以没有把它收进下拉。
> 3. 详情弹窗仍要展示文案行（测试断言里有 `还有 {days} 天`）。

---

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
