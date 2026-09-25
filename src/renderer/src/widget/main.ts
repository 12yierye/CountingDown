import { createApp, watch } from 'vue'
import { createAppI18n, readStoredLanguage, storeLanguage } from '@/i18n'
import { config } from '@/composables/useConfig'
import WidgetRoot from '@/widget/WidgetRoot.vue'
import '@/widget/widget.css'

const app = createApp(WidgetRoot)
const i18n = createAppI18n(readStoredLanguage())
app.use(i18n)

watch(
  () => config.value.runtime.language,
  (language) => {
    i18n.global.locale.value = language
    storeLanguage(language)
  },
  { immediate: true }
)

app.mount('#app')
