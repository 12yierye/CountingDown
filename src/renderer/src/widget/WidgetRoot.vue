<script setup lang="ts">
import { loadConfig } from '@/composables/useConfig'
import { useWidgetConfig } from '@/widget/useWidgetConfig'
import WidgetApp from '@/widget/WidgetApp.vue'

void loadConfig()

const effective = useWidgetConfig()
</script>

<template>
  <WidgetApp :config="effective" />
</template>
