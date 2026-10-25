# 配置文件

config.json 的字段结构。

## 配置文件

由 `electron-store` 持久化在 `%APPDATA%\countingdown\config.json`
（`src/shared/types.ts` 是唯一的类型来源）：

```jsonc
{
  "countdowns": [
    {
      "id": "cd_xxx",
      "name": "元旦",
      "enabled": true,
      "target": { "mode": "annual", "date": "", "month": 1, "day": 1 },  // once 模式下 date 为空 = 跟随全局
      "text":     { "hint": "", "futureText": "", "todayText": "", "pastText": "", "unit": "" }, // 空串 = 跟随全局
      "appearance": {}                // 只出现被覆盖的字段，如 { "opacity": 0.8, "background": { "color": "#ff0055", "radius": 30 } }
    }
  ],
  "activeId": "cd_xxx",               // 当前显示在桌面上的项（只会指向 enabled 的项）
  "target":     { "mode": "annual|once", "date": "YYYY-MM-DD[THH:mm]", "month": 1, "day": 1 }, // 全局默认日期
  "text":       { "hint", "futureText", "todayText", "pastText", "unit" },                     // 全局默认文案
  "appearance": { "fontFamily", "opacity", "background": {...}, "title": {...}, "count": {...}, "hint": {...}, "status": {...} },
  "behavior":   { "displayMode", "showDaysInPrecise", "showPastDays", "alwaysOnTop" },
  "runtime": {
    "widgetVisible", "toggleHotkey", "startAtLogin", "language", "theme",
    "window": {
      "corner": "top-right",          // 对齐方向（拖动后会变成最近的角落）
      "cornerPreset": "top-right",    // 偏移量的参考基准，'custom' 表示用 anchorX/anchorY
      "anchorX": 0, "anchorY": 0,
      "offsetX": 0, "offsetY": 0,
      "allowDrag": true,              // 是否允许直接拖动组件
      "transparent": true             // 是否使用透明窗口（系统不支持时自动退回不透明）
    }
  },
  "customPresets": [ { "id", "name", "createdAt", "appearance" } ]
}
```

主进程写盘后会把最新配置广播给所有窗口，因此**托盘菜单的改动会立刻反映到设置界面与桌面卡片**。
首次启动会自动迁移旧版「单个倒数日」结构：转成列表第一项、文案上提为全局默认、
旧版 `behavior.opacity` 搬到 `appearance.opacity`，不丢设置。
