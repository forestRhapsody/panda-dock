import { useState } from 'react'

import { useTranslation } from 'react-i18next'

import { getCurrentPageUrl } from '@/utils/pageUrl'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'

interface UrlPart {
  key: string
  value: string
}

interface ParsedUrl {
  url: URL
  parts: UrlPart[]
  params: [string, string][]
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

/** 解析 URL：先从文本抽取网址，再交给 buildUrl（避免把干扰文字当作相对路径） */
function parseUrl(input: string): ParsedUrl {
  const text = input.trim()
  const extracted = extractUrlFromText(text) ?? text
  const url = buildUrl(extracted)
  const parts: UrlPart[] = [
    { key: 'protocol', value: url.protocol },
    { key: 'origin', value: url.origin },
    { key: 'host', value: url.host || '—' },
    { key: 'hostname', value: url.hostname || '—' },
    { key: 'port', value: url.port || '—' },
    { key: 'username', value: url.username || '—' },
    { key: 'password', value: url.password ? '••••' : '—' },
    { key: 'path', value: url.pathname },
    { key: 'search', value: url.search || '—' },
    { key: 'hash', value: url.hash || '—' },
  ]
  const params: [string, string][] = []
  url.searchParams.forEach((value, key) => params.push([key, value]))
  return { url, parts, params }
}

/** 网址解析工具：手动输入或一键取当前网页 URL，拆解展示各组成部分 */
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
          <div className='tw-field'>
            <span className='tw-field__label'>
              {t('tool.url.result')}
              <CopyButton text={parsed.url.href} className='tw-link' />
            </span>
            <AutoArea
              className='tw-area tw-area--result'
              value={parsed.url.href}
              readOnly
              placeholder={t('tool.url.resultPlaceholder')}
            />
          </div>

          <ul className='tw-kv'>
            {parsed.parts.map((part) => (
              <li key={part.key} className='tw-kv__row'>
                <span className='tw-kv__k'>{t(`tool.url.component.${part.key}`)}</span>
                <span className='tw-kv__v'>{part.value}</span>
              </li>
            ))}
          </ul>

          {parsed.params.length > 0 && (
            <div className='tw-field'>
              <span className='tw-field__label'>{t('tool.url.queryParams')}</span>
              <ul className='tw-kv'>
                {parsed.params.map(([key, value], index) => (
                  <li key={`${key}-${index}`} className='tw-kv__row'>
                    <span className='tw-kv__k'>{key}</span>
                    <span className='tw-kv__v'>{value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <p className='tw-note'>{t('tool.url.note')}</p>
    </div>
  )
}
