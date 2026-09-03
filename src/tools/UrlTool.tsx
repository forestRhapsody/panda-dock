import { useState } from 'react'

import qs from 'qs'
import { useTranslation } from 'react-i18next'

import { getCurrentPageUrl } from '@/utils/pageUrl'

interface UrlPart {
  key: string
  value: string
}

interface ParsedUrl {
  url: URL
  parts: UrlPart[]
  /** qs 解析出的结构化查询参数（支持嵌套对象 / 数组） */
  query: Record<string, unknown>
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

/** 解析 URL：先从文本抽取网址，再交给 buildUrl；查询参数用 qs 解析 */
function parseUrl(input: string): ParsedUrl {
  const text = input.trim()
  const extracted = extractUrlFromText(text) ?? text
  const url = buildUrl(extracted)
  const parts = collectParts(url)
  const query = qs.parse(url.search.replace(/^\?/, '')) as Record<string, unknown>
  return { url, parts, query }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ParamValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <ul className='tw-params'>
        {value.map((item, index) => (
          <li key={index} className='tw-params__row'>
            <span className='tw-params__key'>{index}</span>
            {isPlainObject(item) || Array.isArray(item) ? (
              <div className='tw-params__children'>
                <ParamValue value={item} />
              </div>
            ) : (
              <span className='tw-params__val'>{String(item)}</span>
            )}
          </li>
        ))}
      </ul>
    )
  }
  if (isPlainObject(value)) {
    return (
      <ul className='tw-params'>
        {Object.entries(value).map(([k, v]) => (
          <ParamNode key={k} k={k} v={v} />
        ))}
      </ul>
    )
  }
  return <span className='tw-params__val'>{String(value)}</span>
}

function ParamNode({ k, v }: { k: string; v: unknown }) {
  const nested = isPlainObject(v) || Array.isArray(v)
  return (
    <li className='tw-params__row'>
      <span className='tw-params__key'>{k}</span>
      {nested ? (
        <div className='tw-params__children'>
          <ParamValue value={v} />
        </div>
      ) : (
        <span className='tw-params__val'>{String(v)}</span>
      )}
    </li>
  )
}

function ParamTree({ data }: { data: Record<string, unknown> }) {
  return (
    <ul className='tw-params'>
      {Object.entries(data).map(([k, v]) => (
        <ParamNode key={k} k={k} v={v} />
      ))}
    </ul>
  )
}

/** 网址解析工具：手动输入或一键取当前网页 URL，拆解展示有意义的部分与（qs 解析的）查询参数 */
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

  const hasQuery = parsed ? Object.keys(parsed.query).length > 0 : false

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
          {hasQuery && (
            <div className='tw-field'>
              <span className='tw-field__label'>{t('tool.url.queryParams')}</span>
              <ParamTree data={parsed.query} />
            </div>
          )}

          {parsed.parts.length > 0 && (
            <ul className='tw-kv'>
              {parsed.parts.map((part) => (
                <li key={part.key} className='tw-kv__row'>
                  <span className='tw-kv__k'>{t(`tool.url.component.${part.key}`)}</span>
                  <span className='tw-kv__v'>{part.value}</span>
                </li>
              ))}
            </ul>
          )}

          {!hasQuery && parsed.parts.length === 0 && (
            <p className='tw-status tw-status--info'>{t('tool.url.noData')}</p>
          )}
        </>
      )}

      <p className='tw-note'>{t('tool.url.note')}</p>
    </div>
  )
}
