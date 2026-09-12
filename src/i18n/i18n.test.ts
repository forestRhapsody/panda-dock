import { describe, expect, it } from 'vitest'

import en from './locales/en.json'
import zh from './locales/zh.json'

/**
 * i18n 语言包完整性静态扫描（T127 引入）。
 * 背景：`t('…')` 引用的 key 若漏登记语言包，界面上会直接显示 key 本身
 * （历史缺陷：`tool.storage.rawParseSuccess` 在中英语言包里都不存在，
 * 导致 Cookie Raw 模式解析成功时状态行显示裸 key），而 `tsc` / `eslint` / 构建都不会报错。
 * 这里以 raw 源码文本扫描字面量 key 作兜底：只校验静态可提取的 key，
 * 动态拼接的 key（如 ``t(`tool.registry.${id}`)``）不参与，因此不会产生误报。
 */
const SOURCES = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const KEY_PATTERNS = [
  /(?<![\w.])t\(\s*['"]([^'"]+)['"]/g, // 组件内 t('…')
  /\bi18n\.t\(\s*['"]([^'"]+)['"]/g, // 纯逻辑模块 i18n.t('…')
  /\blabelKey:\s*['"]([^'"]+)['"]/g, // 下拉/预设选项的 labelKey: '…'
]

function lookup(source: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part]
    return undefined
  }, source)
}

function flattenKeys(source: unknown, prefix = ''): string[] {
  return Object.entries(source as Record<string, unknown>).flatMap(([key, value]) =>
    value && typeof value === 'object'
      ? flattenKeys(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  )
}

/** 源码中被字面量引用到的 key → 出现的文件（用于报错定位） */
function collectReferencedKeys(): Map<string, string> {
  const found = new Map<string, string>()
  for (const [file, code] of Object.entries(SOURCES)) {
    if (/\.test\.tsx?$/.test(file)) continue
    for (const pattern of KEY_PATTERNS) {
      for (const match of code.matchAll(pattern)) {
        const key = match[1]
        if (!key.includes('.')) continue
        if (!found.has(key)) found.set(key, file)
      }
    }
  }
  return found
}

describe('i18n 语言包完整性', () => {
  const referenced = collectReferencedKeys()

  it('扫描确实生效（防止 glob / 正则失效后空跑通过）', () => {
    expect(referenced.size).toBeGreaterThan(150)
  })

  it('源码引用的每个字面量 key 都在 zh 与 en 中存在', () => {
    const missing: string[] = []
    for (const [key, file] of referenced) {
      if (lookup(zh, key) === undefined) missing.push(`zh 缺少 ${key}（${file}）`)
      if (lookup(en, key) === undefined) missing.push(`en 缺少 ${key}（${file}）`)
    }
    expect(missing).toEqual([])
  })

  it('zh 与 en 的 key 集合完全一致', () => {
    expect(flattenKeys(zh).sort()).toEqual(flattenKeys(en).sort())
  })
})

/**
 * 扩展清单多语言守卫（T131）。
 * manifest 用 `__MSG_xxx__`、background 用 `chrome.i18n.getMessage('xxx')` 取文案，
 * key 写错时 Chrome 不会报错，而是**把字面量 `__MSG_xxx__` 直接显示给用户**（或让右键菜单标题为空），
 * 构建、tsc、eslint 全都发现不了——所以这里做静态兜底。
 */
const MANIFEST = import.meta.glob('../../public/manifest.json', {
  eager: true,
  import: 'default',
}) as Record<string, Record<string, unknown>>

const LOCALE_FILES = import.meta.glob('../../public/_locales/*/messages.json', {
  eager: true,
  import: 'default',
}) as Record<string, Record<string, { message?: string }>>

describe('扩展清单多语言（_locales）', () => {
  const manifest = Object.values(MANIFEST)[0] ?? {}
  const locales = Object.fromEntries(
    Object.entries(LOCALE_FILES).map(([path, data]) => [
      path.split('/_locales/')[1]?.split('/')[0] ?? path,
      data,
    ]),
  )

  it('_locales 目录被正确收集（防止 glob 失效后空跑通过）', () => {
    expect(Object.keys(locales).sort()).toEqual(['en', 'zh_CN'])
  })

  it('清单与后台引用的每个 key 在所有语言包里都存在', () => {
    const used = new Set<string>()
    for (const m of JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(m[1])
    for (const [file, code] of Object.entries(SOURCES)) {
      if (/\.test\.tsx?$/.test(file)) continue
      for (const m of code.matchAll(/chrome\.i18n\.getMessage\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
        used.add(m[1])
      }
    }
    // 至少覆盖 manifest 的 3 个 + 后台右键菜单的 1 个
    expect(used.size).toBeGreaterThanOrEqual(4)

    const missing: string[] = []
    for (const key of used) {
      for (const [locale, data] of Object.entries(locales)) {
        if (!data[key]?.message) missing.push(`${locale} 缺少 ${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('声明 __MSG_ 时必须给出 default_locale，且该语言包目录存在', () => {
    expect(JSON.stringify(manifest)).toContain('__MSG_')
    expect(manifest.default_locale).toBe('zh_CN')
    expect(Object.keys(locales)).toContain(manifest.default_locale as string)
  })

  it('中英语言包的 key 集合一致，且英文包不残留中文', () => {
    const [a, b] = Object.values(locales).map((data) => Object.keys(data).sort())
    expect(a).toEqual(b)

    const cjk = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/
    for (const [locale, data] of Object.entries(locales)) {
      for (const [key, entry] of Object.entries(data)) {
        expect(entry.message?.length ?? 0, `${locale}.${key} 文案为空`).toBeGreaterThan(0)
        if (locale === 'en') {
          expect(cjk.test(entry.message ?? ''), `en.${key} 含中文：${entry.message}`).toBe(false)
        } else {
          expect(cjk.test(entry.message ?? ''), `${locale}.${key} 缺中文`).toBe(true)
        }
      }
    }
  })
})
