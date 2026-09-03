import { useEffect, useRef, useState } from 'react'

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

/** 认可的网络协议白名单（仅 http/https 等，非法 scheme 如 httpas:// 一律判无效） */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'ws:', 'wss:', 'file:'])

/** 当前页 origin，用作相对路径的解析基准 */
function currentBase(): string {
  return (typeof window !== 'undefined' && window.location.href) || 'http://localhost/'
}

/** 从文本中抽取已认可协议的网址（去除前后的干扰文字与尾部标点） */
function extractUrlFromText(text: string): string | null {
  const m = text.match(/(?:https?|ftp|ws|wss|file):\/\/[^\s<>"'()]+/i)
  if (!m) return null
  return m[0].replace(/[.,;:!?'")\]}]+$/, '')
}

/** 把候选字符串解析为 URL：绝对 → 无协议域名(补 https) → 相对路径(按当前页 origin)；校验协议合法性 */
function buildUrl(source: string): URL {
  const candidates: (() => URL)[] = [
    () => new URL(source),
    // 无协议但像完整域名：补 https
    () => {
      if (/^[a-z0-9.-]+\.[a-z]{2,}([/?#].*)?$/i.test(source)) {
        return new URL(`https://${source}`)
      }
      throw new Error('invalid')
    },
    // 相对路径（以 / ./ ../ 开头）：按当前页 origin 解析
    () => {
      if (/^[./]/.test(source)) return new URL(source, currentBase())
      throw new Error('invalid')
    },
  ]
  for (const make of candidates) {
    try {
      const url = make()
      if (ALLOWED_PROTOCOLS.has(url.protocol)) return url
    } catch {
      // 继续尝试下一种
    }
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

/** 解析 URL：先从文本抽取网址，再交给 buildUrl（校验协议）；查询参数用 qs 解析后扁平化 */
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

/** 网址解析工具：输入实时校验并解析，或一键取当前网页 URL；非法协议（如 httpas://）判无效 */
export default function UrlTool() {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [parsed, setParsed] = useState<ParsedUrl | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)

  /** 实时解析：输入为空清空；合法则展示，否则判无效 */
  const liveParse = (raw: string) => {
    const text = raw.trim()
    if (!text) {
      setParsed(null)
      setError(null)
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

  // 输入防抖解析：改动即实时更新结果
  const debounceRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => liveParse(input), 80)
    return () => window.clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input])

  async function fetchCurrent() {
    setFetching(true)
    try {
      const url = await getCurrentPageUrl()
      if (!url) {
        setInput('')
        setError(t('tool.url.fetchFailed'))
        setParsed(null)
      } else {
        setInput(url)
      }
    } finally {
      setFetching(false)
    }
  }

  function clear() {
    setInput('')
    setError(null)
    setParsed(null)
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
        <button
          type='button'
          className='tk-btn tk-btn--primary'
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
    </div>
  )
}
