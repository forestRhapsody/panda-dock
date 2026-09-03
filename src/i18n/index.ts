import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import zh from './locales/zh.json'

/**
 * i18next 全局实例。
 * - 语言由 `settings.locale` 决定，经 `useLocale` 同步到 changeLanguage（系统 / 中文 / English）。
 * - React 组件用 `useTranslation()`；非 React 模块（工具底层逻辑）用 `i18n.t()`。
 * - key 采用语义化命名，资源内联注入（无异步加载），因此 `t()` 可立即使用。
 */
void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: 'zh',
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
})

export default i18n
