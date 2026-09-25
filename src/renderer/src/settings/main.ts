import { createApp, watch } from 'vue'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import { createAppI18n, readStoredLanguage, storeLanguage } from '@/i18n'
import { config, loadConfig } from '@/composables/useConfig'
import SettingsApp from '@/settings/SettingsApp.vue'
import '@/settings/settings.css'

const app = createApp(SettingsApp)
const i18n = createAppI18n(readStoredLanguage())

app.use(ElementPlus)
app.use(i18n)

for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component)
}

watch(
  () => config.value.runtime.language,
  (language) => {
    i18n.global.locale.value = language
    storeLanguage(language)
    document.documentElement.setAttribute('lang', language)
  },
  { immediate: true }
)

watch(
  () => config.value.runtime.theme,
  (theme) => {
    const dark = theme !== 'light'
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try {
      localStorage.setItem('cd.theme', dark ? 'dark' : 'light')
    } catch {
      /* ignore */
    }
  },
  { immediate: true }
)

app.mount('#app')
void loadConfig()
