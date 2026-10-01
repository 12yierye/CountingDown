<script setup lang="ts">
/**
 * 单位字编辑器：把 `天 / 时 / 分 / 秒` 这四段后面的字换成别的。
 *
 * 这是**换字**，不是填空/分隔：输入框里就是最终渲染出来的那个字，
 * 所以 `天` 换成 `D` 就得到 `92D`，`时` 换成 `h` 就得到 `04h`。
 * 单位字本身就把两段分开了，想让两段之间多一个空格或冒号，
 * 直接写进单位字里即可（写 `"天 "` 或 `"天:"`）；留空表示这一段不带单位。
 *
 * **四项永远可编辑**：某个分段当前显示模式下是否渲染，只决定输入框要不要标灰提示，
 * 绝不阻止填写。以前这里把「当前模式用不到」的分段直接禁用了，结果是「只显示天数」
 * 模式下根本没法设置时/分/秒的单位字 —— 而那三项是有用的：换个显示模式它们立刻生效，
 * 用户没理由被当前模式锁住手。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    day: string
    hour: string
    minute: string
    second: string
    /** 该分段在当前显示模式下是否存在；不存在只标灰提示，输入框仍可编辑 */
    dayOn?: boolean
    hourOn?: boolean
    minuteOn?: boolean
    secondOn?: boolean
    disabled?: boolean
  }>(),
  {
    dayOn: true,
    hourOn: true,
    minuteOn: true,
    secondOn: true,
    disabled: false
  }
)

const emit = defineEmits<{
  (event: 'update:day', value: string): void
  (event: 'update:hour', value: string): void
  (event: 'update:minute', value: string): void
  (event: 'update:second', value: string): void
}>()

type UnitKey = 'day' | 'hour' | 'minute' | 'second'

interface Slot {
  key: UnitKey
  sample: string
  value: string
  /** 当前显示模式下用不到：只影响观感（淡一些），不影响能否编辑 */
  off: boolean
}

const slots = computed<Slot[]>(() => [
  { key: 'day', sample: 'DD', value: props.day, off: !props.dayOn },
  { key: 'hour', sample: 'HH', value: props.hour, off: !props.hourOn },
  { key: 'minute', sample: 'MM', value: props.minute, off: !props.minuteOn },
  { key: 'second', sample: 'SS', value: props.second, off: !props.secondOn }
])

function onInput(key: UnitKey, event: Event): void {
  const value = (event.target as HTMLInputElement).value.slice(0, 8)
  if (key === 'day') emit('update:day', value)
  else if (key === 'hour') emit('update:hour', value)
  else if (key === 'minute') emit('update:minute', value)
  else emit('update:second', value)
}
</script>

<template>
  <div class="units" :class="{ 'is-disabled': disabled }">
    <label
      v-for="slot in slots"
      :key="slot.key"
      class="units__slot"
      :class="{ 'is-off': slot.off }"
    >
      <span class="units__sample">{{ slot.sample }}</span>
      <input
        class="units__input"
        type="text"
        maxlength="8"
        :disabled="disabled"
        :value="slot.value"
        @input="(event: Event) => onInput(slot.key, event)"
      />
    </label>
  </div>
</template>

<style scoped>
.units {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 14px;
}

.units__slot {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

/*
 * 当前显示模式用不到的分段只淡一档：输入框仍然能点、能改，
 * 所以光标必须是 text 而不是 not-allowed —— 后者会让用户以为这里点不动。
 */
.units__slot.is-off {
  opacity: 0.6;
}

.units__sample {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.units__input {
  width: 52px;
  padding: 2px 6px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-blank);
  color: var(--el-color-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
  outline: none;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.units__input:hover:not(:disabled),
.units__input:focus:not(:disabled) {
  border-color: var(--el-color-primary);
  background: var(--el-fill-color-light);
}

/* 细分段的输入框可编辑，因此这里只给真正的整体禁用（disabled prop）留灰字 */
.units__input:disabled {
  cursor: not-allowed;
  color: var(--el-text-color-disabled);
}
</style>
