import { createApp, ref, watch } from 'vue'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import { createAppI18n, readStoredLanguage, storeLanguage } from '@/i18n'
import { config, loadConfig } from '@/composables/useConfig'
import { resolveTheme } from '@shared/defaults'
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

/**
 * 系统明暗。
 *
 * 「跟随系统」不能只在启动时读一次 —— 用户在 Windows 里切换主题时，
 * matchMedia 会发 change 事件，这里把结果放进 ref，watch 才能重新解析。
 */
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(systemTheme.matches)
systemTheme.addEventListener('change', (event) => {
  systemDark.value = event.matches
})

/**
 * 主题落到三个地方：
 *   .dark 类  —— Element Plus 的暗色变量表靠它切换
 *   data-theme —— 本项目的四套色板靠它切换
 *   localStorage —— 下次冷启动时首帧就是对的，不会闪一下默认色
 */
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
void loadConfig()
