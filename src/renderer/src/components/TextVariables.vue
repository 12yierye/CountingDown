<script setup lang="ts">
/**
 * 文案变量清单。
 *
 * 光在 tooltip 里写「支持 {days}」用户记不住，也拼不出 `{week}` 这种词。
 * 这里把可用的变量做成按钮，点一下直接追加到文案末尾 —— 不用记语法，也不会打错。
 */
import { useI18n } from 'vue-i18n'
import { TEXT_VARIABLES } from '@shared/defaults'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

const { t } = useI18n()

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
  return `${t('textVar.tip')} · ${t('textVar.' + name)}`
}
</script>

<template>
  <div class="text-vars">
    <span class="text-vars__label">{{ t('textVar.label') }}</span>
    <button
      v-for="name in TEXT_VARIABLES"
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

.text-vars__label {
  font-size: 11.5px;
  color: var(--el-text-color-secondary);
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
