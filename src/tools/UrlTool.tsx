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

/** 解析 URL：先用原生 URL（绝对），失败再按当前页 origin 兜底（相对路径） */
function parseUrl(input: string): ParsedUrl {
  const base = (typeof window !== 'undefined' && window.location.href) || 'http://localhost/'
  let url: URL
  try {
    url = new URL(input)
  } catch {
    url = new URL(input, base)
  }
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
