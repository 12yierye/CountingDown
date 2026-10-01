<script setup lang="ts">
/**
 * 带补充说明的设置行。
 * 说明只出现在标签右侧的「?」tooltip 里，不再在控件下方多占一行。
 * 少数确实需要常显示的提示（例如带按钮的引导）用 #note 插槽传进来。
 */
defineProps<{
  /** 留空表示这一行不需要标签（例如整行就是一个公式） */
  label?: string
  hint?: string
  /** tooltip 里替换 {xxx} 的变量，例如 { days: 3 } */
  hintVars?: Record<string, string | number>
  stacked?: boolean
}>()

function fill(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    vars[key] === undefined ? match : String(vars[key])
  )
}
</script>

<template>
  <div class="field-row" :class="{ 'field-row--stacked': stacked, 'is-bare': !label }">
    <div v-if="label || hint" class="field-row__label">
      <span class="field-row__text">{{ label }}</span>
      <el-tooltip
        v-if="hint"
        :content="fill(hint, hintVars)"
        placement="top"
        :show-after="150"
        :teleported="true"
      >
        <span class="field-row__hint" tabindex="0">
          <el-icon :size="11"><QuestionFilled /></el-icon>
        </span>
      </el-tooltip>
    </div>
    <div class="field-row__control">
      <slot />
      <slot name="note" />
    </div>
  </div>
</template>

<style scoped>
.field-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 9px 0;
}

.field-row + .field-row {
  border-top: 1px solid var(--el-border-color-extra-light);
}

.field-row--stacked {
  flex-direction: column;
  gap: 8px;
}

.field-row__label {
  width: 132px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  line-height: 1.4;
  padding-top: 5px;
  opacity: 0.9;
}

.field-row__text {
  min-width: 0;
}

.field-row--stacked .field-row__label {
  width: auto;
  padding-top: 0;
}

/* 没有标签的行（整行一个公式）：控件占满整行 */
.field-row.is-bare .field-row__control {
  flex: 1;
}

/* 「?」用图标而不是小圆点，深色主题下也能看清 */
.field-row__hint {
  flex: none;
  color: var(--el-text-color-secondary);
  display: inline-flex;
  align-items: center;
  cursor: help;
  outline: none;
  transition: color 0.15s ease;
}

.field-row__hint:hover,
.field-row__hint:focus-visible {
  color: var(--el-color-primary);
}

.field-row__control {
  flex: 1;
  min-width: 0;
}
</style>
