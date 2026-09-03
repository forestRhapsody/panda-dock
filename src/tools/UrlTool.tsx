import { useState } from 'react'

import qs from 'qs'
import { useTranslation } from 'react-i18next'

import { getCurrentPageUrl } from '@/utils/pageUrl'

import CopyButton from './CopyButton'

interface UrlPart {
  key: string
  value: string
}

interface ParsedUrl {
  url: URL
  parts: UrlPart[]
  /** 查询参数：qs 解析出结构化对象后扁平化为 kv 列表（嵌套/数组用括号记法） */
  params: UrlPart[]
}

/** 当前页 origin，用作相对路径的解析基准 */
function currentBase(): string {
  return (typeof window !== 'undefined' && window.location.href) || 'http://localhost/'
}

/** 从文本中抽取 scheme:// 的网址（去除前后的干扰文字与尾部标点） */
function extractUrlFromText(text: string): string | null {
  const m = text.match(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s<>"'()]+/)
  if (!m) return null
  return m[0].replace(/[.,;:!?'")\]}]+$/, '')
}

/** 把候选字符串解析为 URL：绝对 → 无协议域名(补 https) → 相对路径(按当前页 origin) */
function buildUrl(source: string): URL {
  try {
    return new URL(source)
  } catch {
    // 空的继续往下兜底
  }
  // 无协议但像完整域名：补 https
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/?#].*)?$/i.test(source)) {
    return new URL(`https://${source}`)
  }
  // 相对路径（以 / ./ ../ 开头）：按当前页 origin 解析
  if (/^[./]/.test(source)) {
    return new URL(source, currentBase())
  }
  throw new Error('invalid')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把 qs 解析出的结构化对象扁平化为 kv 列表（对象/数组用括号记法，如 filter[name]、ids[0]） */
function flattenParams(query: Record<string, unknown>): UrlPart[] {
  const out: UrlPart[] = []
  const walk = (value: unknown, prefix: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (isPlainObject(item) || Array.isArray(item)) walk(item, `${prefix}[${index}]`)
        else out.push({ key: `${prefix}[${index}]`, value: String(item) })
      })
      return
    }
    if (isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        const key = prefix ? `${prefix}[${k}]` : k
        if (isPlainObject(v) || Array.isArray(v)) walk(v, key)
        else out.push({ key, value: String(v) })
      }
      return
    }
    out.push({ key: prefix, value: String(value) })
  }
  walk(query, '')
  return out
}

/** 只保留「有实际值」的组成部分，避免展示无用空列 */
function collectParts(url: URL): UrlPart[] {
  const parts: UrlPart[] = []
  if (url.protocol) parts.push({ key: 'protocol', value: url.protocol })
  if (url.host) parts.push({ key: 'host', value: url.host })
  if (url.pathname && url.pathname !== '/') parts.push({ key: 'path', value: url.pathname })
  if (url.search) parts.push({ key: 'search', value: url.search })
  if (url.hash) parts.push({ key: 'hash', value: url.hash })
  if (url.username) parts.push({ key: 'username', value: url.username })
  if (url.password) parts.push({ key: 'password', value: '••••' })
  return parts
}

/** 解析 URL：先从文本抽取网址，再交给 buildUrl；查询参数用 qs 解析后扁平化 */
function parseUrl(input: string): ParsedUrl {
  const text = input.trim()
  const extracted = extractUrlFromText(text) ?? text
  const url = buildUrl(extracted)
  const parts = collectParts(url)
  const query = qs.parse(url.search.replace(/^\?/, '')) as Record<string, unknown>
  const params = flattenParams(query)
  return { url, parts, params }
}

/** 一行：左侧 label，右侧只读输入框 + 复制按钮（it-tools 风格） */
function UrlField({ label, value }: { label: string; value: string }) {
  return (
    <div className='url-row'>
      <span className='url-row__label'>{label}</span>
      <div className='url-row__value'>
        <input className='url-row__input' readOnly value={value} />
        <CopyButton text={value} icon className='url-row__copy' />
      </div>
    </div>
  )
}

/** 网址解析工具：手动输入或一键取当前网页 URL，展示各组成部分与（qs 解析的）查询参数 */
export default function UrlTool() {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [parsed, setParsed] = useState<ParsedUrl | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)

  function run(raw?: string) {
    const text = (raw ?? input).trim()
    if (!text) {
      setParsed(null)
      setError(t('tool.url.empty'))
      return
    }
    try {
      setParsed(parseUrl(text))
      setError(null)
    } catch {
      setParsed(null)
      setError(t('tool.url.errorInvalid'))
    }
  }

  async function fetchCurrent() {
    setFetching(true)
    try {
      const url = await getCurrentPageUrl()
      if (!url) {
        setInput('')
        setParsed(null)
        setError(t('tool.url.fetchFailed'))
      } else {
        setInput(url)
        run(url)
      }
    } finally {
      setFetching(false)
    }
  }

  function clear() {
    setInput('')
    setParsed(null)
    setError(null)
  }

  const hasParams = parsed ? parsed.params.length > 0 : false

  return (
    <div className='tw-card'>
      <label className='tw-field'>
        <span className='tw-field__label'>{t('tool.url.inputLabel')}</span>
        <textarea
          className='tw-area'
          value={input}
          placeholder={t('tool.url.inputPlaceholder')}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
      </label>

      <div className='tw-actions'>
        <button type='button' className='tk-btn tk-btn--primary' onClick={() => run()}>
          {t('tool.url.parse')}
        </button>
        <button
          type='button'
          className='tk-btn'
          disabled={fetching}
          onClick={() => void fetchCurrent()}
        >
          {t('tool.url.fetchCurrent')}
        </button>
        <button type='button' className='tk-btn' onClick={clear}>
          {t('tool.url.clear')}
        </button>
      </div>

      {error && <p className='tw-status tw-status--err'>{error}</p>}

      {parsed && (
        <>
          {parsed.parts.length > 0 && (
            <div className='url-list'>
              {parsed.parts.map((part) => (
                <UrlField
                  key={part.key}
                  label={t(`tool.url.component.${part.key}`)}
                  value={part.value}
                />
              ))}
            </div>
          )}

          {hasParams && (
            <div className='url-list'>
              <div className='url-list__title'>{t('tool.url.queryParams')}</div>
              {parsed.params.map((param, index) => (
                <UrlField key={`${param.key}-${index}`} label={param.key} value={param.value} />
              ))}
            </div>
          )}

          {!hasParams && parsed.parts.length === 0 && (
            <p className='tw-status tw-status--info'>{t('tool.url.noData')}</p>
          )}
        </>
      )}

      <p className='tw-note'>{t('tool.url.note')}</p>
    </div>
  )
}
