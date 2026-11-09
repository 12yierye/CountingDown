<script setup lang="ts">
/**
 * 可折叠设置分区 —— 全站设置页共用的「一块」。
 *
 * 标题行只有三样东西：标题、可选的「?」帮助、可选的右侧操作。
 * **不在标题行回显任何设置值或设置项名称**（曾经试过「已覆盖 2 项」「精度：时」这类摘要，
 * 结果是每个分区都多出一行要跟着状态变的文案：维护面翻倍，收起时也记不住，
 * 反而把标题本身的层级冲淡了）。要看值就展开，展开后控件自己会说。
 *
 * 折叠状态写 localStorage，不写进配置：它是「这次怎么看」，不是「应用怎么配」。
 */
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    /** 标题说明，收进「?」tooltip */
    help?: string
    /** 默认是否展开 */
    defaultOpen?: boolean
    /** 折叠状态记忆键；不传则只在本次会话里保持 */
    persistKey?: string
  }>(),
  { help: '', defaultOpen: true, persistKey: '' }
)

const emit = defineEmits<{ (event: 'toggle', open: boolean): void }>()

const STORAGE_PREFIX = 'cd.section.'

function readStored(): boolean | null {
  if (!props.persistKey) return null
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + props.persistKey)
    return raw === null ? null : raw === '1'
  } catch {
    return null
  }
}

/** 用户手动开合过就听用户的；没动过才用调用方给的默认值 */
const open = ref(readStored() ?? props.defaultOpen)

function toggle(): void {
  open.value = !open.value
  if (props.persistKey) {
    try {
      localStorage.setItem(STORAGE_PREFIX + props.persistKey, open.value ? '1' : '0')
    } catch {
      /* 隐私模式下写不进去，不影响使用 */
    }
  }
  emit('toggle', open.value)
}
</script>

<template>
  <section class="cd-section" :class="{ 'is-open': open }">
    <div class="cd-section__head">
      <button
        type="button"
        class="cd-section__toggle"
        :aria-expanded="open"
        @click="toggle"
      >
        <el-icon class="cd-section__chevron" :size="12"><ArrowRight /></el-icon>
        <span class="cd-section__title">{{ title }}</span>
      </button>

      <el-tooltip v-if="help" :content="help" placement="top" :show-after="150">
        <span class="cd-section__help" tabindex="0">
          <el-icon :size="13"><QuestionFilled /></el-icon>
        </span>
      </el-tooltip>

      <div v-if="$slots.actions" class="cd-section__actions" @click.stop>
        <slot name="actions" />
      </div>
    </div>

    <el-collapse-transition>
      <div v-show="open" class="cd-section__body">
        <slot />
      </div>
    </el-collapse-transition>
  </section>
</template>

<style scoped>
.cd-section {
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--cd-radius, 12px);
  background: var(--el-bg-color);
  /*
   * 必须显式禁止收缩。
   *
   * overflow: hidden 让这个分区成为「滚动容器」，而按 flex 规范，
   * 滚动容器作为 flex 子项时自动最小尺寸是 0（不是内容高度）—— 于是放进
   * 定高 + overflow:auto 的 flex 列里（例如调整外观弹窗的 .iad__fields），
   * 内容超出时浏览器不会滚动，而是把各分区**压扁**，再被这里裁掉，
   * 表现为「某个分区的高度不对、内容缺一截」。
   */
  flex: none;
  overflow: hidden;
  /* 分区之间的间距由自己带：它既可能被直接放进 .settings-content（无 gap），
     也可能被放进 flex 容器里，自带外边距两种情况都成立 */
  margin-bottom: 10px;
}

.cd-section__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 4px 4px;
}

/*
 * 折叠开关本身就是标题行：整行都可点，命中区域比一个 12px 的小三角大得多。
 * 用 <button> 而不是 div，键盘 Tab 能到、回车能开合，不用额外补 tabindex 与 keydown。
 */
.cd-section__toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.cd-section__toggle:hover {
  background: var(--el-fill-color-light);
}

.cd-section__toggle:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}

.cd-section__chevron {
  flex: none;
  color: var(--el-text-color-secondary);
  transition: transform 0.16s ease;
}

.cd-section.is-open .cd-section__chevron {
  transform: rotate(90deg);
}

.cd-section__title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.cd-section__help {
  flex: none;
  display: inline-flex;
  align-items: center;
  color: var(--el-text-color-secondary);
  cursor: help;
  outline: none;
  transition: color 0.15s ease;
}

.cd-section__help:hover,
.cd-section__help:focus-visible {
  color: var(--el-color-primary);
}

.cd-section__actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.cd-section__body {
  padding: 0 14px 10px;
}
</style>
