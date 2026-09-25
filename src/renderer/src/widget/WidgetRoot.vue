<script setup lang="ts">
import { config, loadConfig } from '@/composables/useConfig'
import WidgetApp from '@/widget/WidgetApp.vue'

void loadConfig()
</script>

<template>
  <WidgetApp :config="config" />
</template>
