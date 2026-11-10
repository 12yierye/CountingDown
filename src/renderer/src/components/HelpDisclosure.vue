<script setup lang="ts">
/**
 * 折叠说明：一行小字入口，点开才看长文。
 *
 * 用途很明确 —— 「遇到问题时的解法」这类内容。默认铺开的话，
 * 没遇到问题的用户每次都先被一大段怎么排查糊一脸；塞进 tooltip 又没法复制、没法细看。
 * 折在「一句话标题」后面，展开后就在原地，是目前最合适的折中。
 *
 * 展开动画是手写的 `grid-template-rows: 0fr → 1fr`，没用 el-collapse-transition：
 * 后者按 scrollHeight 写 max-height，内容只有一两行时数字给早/给晚都会顿一下。
 * grid 的 fr 过渡天生跟着内容高度走，不需要事先量高度。
 */
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 折叠时显示的入口文字，写成一句问题或一句概括 */
    summary: string
    defaultOpen?: boolean
  }>(),
  { defaultOpen: false }
)

const open = ref(props.defaultOpen)
</script>

<template>
  <div class="help-disclosure" :class="{ 'is-open': open }">
    <button
      type="button"
      class="help-disclosure__toggle"
      :aria-expanded="open"
      @click="open = !open"
    >
      <el-icon class="help-disclosure__chevron" :size="10"><ArrowRight /></el-icon>
      <span>{{ summary }}</span>
    </button>

    <div class="help-disclosure__panel">
      <div class="help-disclosure__clip">
        <div class="help-disclosure__box">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.help-disclosure {
  min-width: 0;
}

.help-disclosure__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}

.help-disclosure__toggle:hover {
  color: var(--cd-ink-1);
}

.help-disclosure__toggle:focus-visible {
  outline: 2px solid var(--cd-line-focus);
  outline-offset: 2px;
  border-radius: var(--cd-r-sm);
}

.help-disclosure__chevron {
  transition: transform 0.2s ease;
}

.help-disclosure.is-open .help-disclosure__chevron {
  transform: rotate(90deg);
}

/*
 * 高度动画：外层是 grid，行高在 0fr 与 1fr 之间过渡；
 * 内层 overflow: hidden + min-height: 0 负责把内容裁掉。
 * 背景与内边距放在最里面的 __box 上 —— 放在被裁的那一层，
 * 收起时那圈 padding 还会撑着高度，永远收不干净。
 */
.help-disclosure__panel {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}

.help-disclosure.is-open .help-disclosure__panel {
  grid-template-rows: 1fr;
}

.help-disclosure__clip {
  overflow: hidden;
  min-height: 0;
}

.help-disclosure__box {
  margin-top: 4px;
  padding: 8px 10px;
  border: 1px solid var(--cd-line-soft);
  border-radius: var(--cd-r-sm);
  background: var(--cd-s2);
  font-size: 11.5px;
  line-height: 1.75;
  color: var(--cd-ink-3);
}

@media (prefers-reduced-motion: reduce) {
  .help-disclosure__panel,
  .help-disclosure__chevron {
    transition: none;
  }
}
</style>
