import { createApp, ref, watch } from 'vue'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import { createAppI18n, readStoredLanguage, storeLanguage } from '@/i18n'
import { config } from '@/composables/useConfig'
import { resolveTheme } from '@shared/defaults'
import OnboardingApp from '@/onboarding/OnboardingApp.vue'
import '@/settings/settings.css'
import '@/components/card.css'
import '@/onboarding/onboarding.css'

const app = createApp(OnboardingApp)
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

/**
 * 主题与设置窗口同一套解析：引导页是用户看到的第一屏，
 * 它必须和之后的设置窗口是同一个色板，否则点开设置会有「换了个软件」的错觉。
 */
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(systemTheme.matches)
systemTheme.addEventListener('change', (event) => {
  systemDark.value = event.matches
})

watch(
  [() => config.value.runtime.theme, systemDark],
  () => {
    const resolved = resolveTheme(config.value.runtime.theme, systemDark.value)
    const root = document.documentElement
    root.classList.toggle('dark', resolved.dark)
    root.dataset.theme = resolved.name
    try {
      localStorage.setItem('cd.theme', resolved.name)
    } catch {
      /* 隐私模式下写不进去，不影响使用 */
    }
  },
  { immediate: true }
)

app.mount('#app')
