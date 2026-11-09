<script setup lang="ts">
/**
 * 文案变量清单。
 *
 * 光在 tooltip 里写「支持 {days}」用户记不住，也拼不出 `{week}` 这种词。
 * 这里把可用的变量做成按钮，点一下直接追加到文案末尾 —— 不用记语法，也不会打错。
 *
 * 变量分两类，界面上也分开写清楚：
 *   还差 / 已过去 —— {days}，剩余或已经过去的天数
 *   目标日期 —— {year} {month} {day} {week} {date}，取的是目标那一天本身
 * 混在一起时用户根本分不清 {day} 是「目标日」还是「还剩几天」。
 *
 * `field` 决定 {days} 怎么称呼：
 *   future / hint —— 「还差」
 *   past          —— 「已过去」（同一个绝对值，只是方向不同）
 *   today         —— 不提供 {days}：当天恒为 0，写进文案没有意义
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TEXT_VARIABLES } from '@shared/defaults'

type FieldKind = 'hint' | 'future' | 'today' | 'past'

const props = withDefaults(defineProps<{ modelValue: string; field?: FieldKind }>(), {
  field: 'future'
})
const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

const { t } = useI18n()

const showDiff = computed(() => props.field !== 'today')
const diffLabel = computed(() =>
  props.field === 'past' ? t('textVar.groupPast') : t('textVar.groupDiff')
)
const diffTip = computed(() =>
  props.field === 'past' ? t('textVar.daysPast') : t('textVar.days')
)

const targetVars = TEXT_VARIABLES.filter((name) => name !== 'days')

function insert(name: string): void {
  const current = props.modelValue ?? ''
  const glue = current && !/\s$/.test(current) ? ' ' : ''
  emit('update:modelValue', `${current}${glue}${tokenOf(name)}`)
}

/** 模板里别写嵌套模板字符串：Vue 的表达式解析器会在嵌套反引号上直接报错 */
function tokenOf(name: string): string {
  return '{' + name + '}'
}

function titleOf(name: string): string {
  return name === 'days' ? diffTip.value : t('textVar.' + name)
}
</script>

<template>
  <div class="text-vars">
    <template v-if="showDiff">
      <span class="text-vars__group">{{ diffLabel }}</span>
      <button
        type="button"
        class="text-vars__chip"
        :title="diffTip"
        @click="insert('days')"
      >
        {{ tokenOf('days') }}
      </button>
    </template>

    <span class="text-vars__group">{{ t('textVar.groupTarget') }}</span>
    <button
      v-for="name in targetVars"
      :key="name"
      type="button"
      class="text-vars__chip"
      :title="titleOf(name)"
      @click="insert(name)"
    >
      {{ tokenOf(name) }}
    </button>
  </div>
</template>

<style scoped>
.text-vars {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}

/* 分组小标题：把「还差 / 已过去」和「目标日期」在视觉上隔开。
   第一个分组不需要左侧竖线与额外缩进 —— 它就是这一行的开头。 */
.text-vars__group {
  margin-left: 6px;
  padding-left: 8px;
  border-left: 1px solid var(--el-border-color-light);
  font-size: 11.5px;
  color: var(--el-text-color-secondary);
}

.text-vars__group:first-child {
  margin-left: 0;
  padding-left: 0;
  border-left: 0;
}

.text-vars__chip {
  padding: 1px 6px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 5px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.6;
  cursor: pointer;
}

.text-vars__chip:hover {
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
}
</style>
