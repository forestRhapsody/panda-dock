import { afterAll, describe, expect, it } from 'vitest'

import i18n from '@/i18n'
import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { ERROR_CODES, isErrorCode } from '@/utils/messages'

import { resolveStorageError, storageErrorKey } from './storage'

/** 跨端错误码的本地化映射回归（T127）：background 只回 code，UI 侧负责翻成当前语言 */
describe('storage 错误码本地化映射', () => {
  afterAll(async () => {
    await i18n.changeLanguage('zh')
  })

  it('每个错误码都有映射，且不与其他码共用同一个 key', () => {
    const keys = ERROR_CODES.map((code) => storageErrorKey(code))
    for (const key of keys) expect(key).toMatch(/^tool\.storage\./)
    expect(new Set(keys).size).toBe(ERROR_CODES.length)
  })

  it('映射到的 key 在 zh / en 语言包中同时存在（防止漏翻译）', () => {
    const lookup = (source: unknown, key: string): unknown =>
      key
        .split('.')
        .reduce<unknown>(
          (acc, part) =>
            acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
          source,
        )

    const extra = ['tool.storage.errorCookieSetFailedDetail']
    for (const key of [...ERROR_CODES.map(storageErrorKey), ...extra]) {
      expect(lookup(zh, key), `zh 缺少 ${key}`).toEqual(expect.any(String))
      expect(lookup(en, key), `en 缺少 ${key}`).toEqual(expect.any(String))
    }
  })

  it('英文界面下不出现中文（本次修复的核心缺陷）', async () => {
    await i18n.changeLanguage('en')
    const cjk = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/

    for (const code of ERROR_CODES) {
      const text = resolveStorageError({ ok: false, code }, 'tool.storage.errorUnreadable')
      expect(text.length, `${code} 文案为空`).toBeGreaterThan(0)
      expect(text, `${code} 的英文文案含中文`).not.toBe(code)
      expect(cjk.test(text), `${code} 的英文文案含中文：${text}`).toBe(false)
    }
  })

  it('中文界面下给出中文文案', async () => {
    await i18n.changeLanguage('zh')
    const cjk = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/
    for (const code of ERROR_CODES) {
      expect(cjk.test(resolveStorageError({ ok: false, code }, 'x')), `${code} 中文文案异常`).toBe(
        true,
      )
    }
  })

  it('ERR_COOKIE_SET_FAILED 带 detail 时改用详情文案并保留原始报错', async () => {
    await i18n.changeLanguage('en')
    const text = resolveStorageError(
      { ok: false, code: 'ERR_COOKIE_SET_FAILED', detail: 'Failed to parse cookie' },
      'tool.storage.errorCookieSave',
    )
    expect(text).toContain('Failed to parse cookie')
    expect(text).not.toContain('{{detail}}')
  })

  it('升级兼容：旧版 background 的 error 句子原样透传', async () => {
    await i18n.changeLanguage('en')
    expect(resolveStorageError({ ok: false, error: 'legacy message' }, 'x')).toBe('legacy message')
  })

  it('未知错误码与空响应回退到调用方兜底文案', async () => {
    await i18n.changeLanguage('en')
    const fallback = i18n.t('tool.storage.errorUnreadable')
    expect(
      resolveStorageError({ ok: false, code: 'NOT_A_CODE' }, 'tool.storage.errorUnreadable'),
    ).toBe(fallback)
    expect(resolveStorageError(undefined, 'tool.storage.errorUnreadable')).toBe(fallback)
    expect(resolveStorageError({ ok: false, error: '' }, 'tool.storage.errorUnreadable')).toBe(
      fallback,
    )
  })

  it('isErrorCode 只认可已注册的错误码', () => {
    expect(isErrorCode('ERR_NO_TARGET_URL')).toBe(true)
    expect(isErrorCode('NOT_A_CODE')).toBe(false)
    expect(isErrorCode(undefined)).toBe(false)
    expect(isErrorCode(123)).toBe(false)
  })
})
