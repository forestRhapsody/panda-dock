import { afterEach, describe, expect, it } from 'vitest'

import i18n from './index'

/**
 * i18n 实例本身的行为契约（语言包完整性由同目录 i18n.test.ts 静态扫描覆盖）：
 * - 资源内联注入 → init 同步完成，`t()` 不 await 就能取到值；
 * - 默认语言与 fallback 都是 zh；
 * - zh/en 两套资源都注册了；
 * - escapeValue: false → 插值里的 HTML 原样保留（工具结果常含 `<`/`>`，转义会显示成实体）。
 */

afterEach(async () => {
  await i18n.changeLanguage('zh')
})

describe('i18n 实例：初始化与资源', () => {
  it('init 同步完成，t() 可立即取到值（无异步加载）', () => {
    expect(i18n.isInitialized).toBe(true)
    // 不 await、不 flush，直接取词
    expect(i18n.t('tool.registry.json')).toBe('JSON')
  })

  it('默认语言与 fallback 都是 zh', async () => {
    await i18n.changeLanguage('zh')
    expect(i18n.language).toBe('zh')
    expect(i18n.options.fallbackLng).toContain('zh')
  })

  it('zh 与 en 两套翻译资源都已注册', () => {
    expect(i18n.hasResourceBundle('zh', 'translation')).toBe(true)
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true)
    expect(i18n.getResource('zh', 'translation', 'tool.registry.json')).toBe('JSON')
    expect(i18n.getResource('en', 'translation', 'tool.registry.json')).toBe('JSON')
  })
})

describe('i18n 实例：取词与 fallback', () => {
  it('tool.registry.json 在 zh/en 下都返回非 key 的字符串', async () => {
    await i18n.changeLanguage('zh')
    const zh = i18n.t('tool.registry.json')
    expect(typeof zh).toBe('string')
    expect(zh).not.toBe('tool.registry.json')

    await i18n.changeLanguage('en')
    const en = i18n.t('tool.registry.json')
    expect(typeof en).toBe('string')
    expect(en).not.toBe('tool.registry.json')
  })

  it('未知语言回退到 zh（fallbackLng 生效）', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('tool.registry.detect')).toBe('Smart Parse')

    await i18n.changeLanguage('fr')
    expect(i18n.t('tool.registry.detect')).toBe('智能解析')
  })
})

describe('i18n 实例：插值不转义 HTML', () => {
  it('escapeValue 配置为 false', () => {
    expect(i18n.options.interpolation?.escapeValue).toBe(false)
  })

  it('插值里的 HTML 原样输出，不变成实体', () => {
    const html = '<img src=x onerror="boom()">'
    const result = i18n.t('tool.detect.openInTool', { tool: html })

    expect(result).toContain(html)
    expect(result).not.toContain('&lt;')
    expect(result).not.toContain('&gt;')
  })
})
