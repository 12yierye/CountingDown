<script setup lang="ts">
/**
 * 外观表单的分组外壳：窄版（dense）是平铺的 .override-group，宽版是 el-card + 卡片头。
 *
 * 单独抽出来是因为**这里没法用 `<component :is>` + `#header` 硬凑**：
 * `:is` 与 `v-else` 在同一个位置会报「v-else/v-else-if has no adjacent v-if」，
 * 而且 `vue-tsc` 查不出来，只有真正构建（vite 的 vue 插件）才会炸。
 * 每个分组各自写一遍宿主标签又会把「两套外壳」的知识散成四份。
 */
defineProps<{
  title: string
  /** true = 平铺分组（模态框），false = el-card 分区（外观设置页） */
  dense?: boolean
}>()
</script>

<template>
  <el-card v-if="!dense" shadow="never" class="panel-card">
    <template #header>
      <div class="panel-card__header">
        <span class="panel-card__title">
          {{ title }}
          <slot name="help" />
        </span>
      </div>
    </template>
    <slot />
  </el-card>

  <section v-else class="override-group">
    <div class="override-group__title">{{ title }}</div>
    <slot />
  </section>
</template>
