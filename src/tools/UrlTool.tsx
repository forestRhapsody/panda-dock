import { useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import TkSelect from '@/ui/TkSelect'
import { useToolDraft } from '@/utils/draft'
import { getCurrentPageUrl } from '@/utils/pageUrl'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'
import { StatusText } from './StatusText'
import type { ToolStatus } from './StatusText'
import ToolTabs from './ToolTabs'
import { decodeUrl, encodeUrl, parseUrl, type CodecScope, type ParsedUrl } from './url'

type MainTab = 'parse' | 'codec'

/** 网址组成部分/参数行：对齐智能解析样式（卡片式行、左侧高亮标签、等宽值、右侧复制按钮） */
function UrlField({ label, value }: { label: string; value: string }) {
  return (
    <div className='tw-detect__field'>
      <span className='tw-detect__field-label'>{label}</span>
      <code className='tw-detect__field-value tw-detect__field-value--mono'>{value}</code>
      <CopyButton text={value} icon className='tw-detect__copy' />
    </div>
  )
}

/** 网址解析面板：抽取网址各组成部分与 Query 参数 */
function UrlParserPanel() {
  const { t } = useTranslation()
  const [input, setInput, clearInput] = useToolDraft<string>('url.parse.input', '')
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
    clearInput()
    setError(null)
    setParsed(null)
  }

  const hasParams = parsed ? parsed.params.length > 0 : false

  return (
    <div className='tw-sec'>
      <label className='tw-field'>
        <span className='tw-field__label'>{t('tool.url.inputLabel')}</span>
        <AutoArea
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

      {error && <StatusText kind='err'>{error}</StatusText>}

      {parsed && (
        <div className='tw-detect'>
          {parsed.parts.length > 0 && (
            <div className='tw-detect__fields'>
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
            <div className='tw-detect__block'>
              <span className='tw-field__label'>
                {t('tool.url.queryParams')}
                <CopyButton
                  text={parsed.params.map((p) => `${p.key}=${p.value}`).join('&')}
                  label={t('common.copy')}
                  className='tw-link'
                />
              </span>
              <div className='tw-detect__fields'>
                {parsed.params.map((param, index) => (
                  <UrlField key={`${param.key}-${index}`} label={param.key} value={param.value} />
                ))}
              </div>
            </div>
          )}

          {!hasParams && parsed.parts.length === 0 && (
            <StatusText kind='info'>{t('tool.url.noData')}</StatusText>
          )}
        </div>
      )}
    </div>
  )
}

interface CodecDraft {
  scope: CodecScope
  input: string
  output: string
}

/** 网址编解码面板：URL Encode / Decode，直接提供编码网址与解码网址操作按钮 */
function UrlCodecPanel() {
  const { t } = useTranslation()
  const [draft, setDraft, clearDraft] = useToolDraft<CodecDraft>('url.codec', {
    scope: 'component',
    input: '',
    output: '',
  })
  const { scope, input, output } = draft
  const [status, setStatus] = useState<ToolStatus | null>(null)
  const [fetching, setFetching] = useState(false)
  const [lastAction, setLastAction] = useState<'encode' | 'decode' | null>(null)

  function setScope(nextScope: CodecScope) {
    setDraft((prev) => ({ ...prev, scope: nextScope }))
  }

  function setInput(val: string) {
    setDraft((prev) => ({ ...prev, input: val }))
  }

  function runEncode(rawText: string = input, currentScope: CodecScope = scope) {
    if (!rawText.trim()) {
      setStatus({ kind: 'info', text: t('tool.url.codec.statusNeedInput') })
      setDraft((prev) => ({ ...prev, output: '' }))
      return
    }
    setLastAction('encode')
    const res = encodeUrl(rawText, currentScope)
    if (res.ok) {
      setDraft((prev) => ({ ...prev, output: res.text }))
      setStatus(null)
    } else {
      setDraft((prev) => ({ ...prev, output: '' }))
      setStatus({
        kind: 'err',
        text: t('tool.url.codec.statusError', { error: res.error }),
      })
    }
  }

  function runDecode(rawText: string = input, currentScope: CodecScope = scope) {
    if (!rawText.trim()) {
      setStatus({ kind: 'info', text: t('tool.url.codec.statusNeedInput') })
      setDraft((prev) => ({ ...prev, output: '' }))
      return
    }
    setLastAction('decode')
    const res = decodeUrl(rawText, currentScope)
    if (res.ok) {
      setDraft((prev) => ({ ...prev, output: res.text }))
      setStatus(null)
    } else {
      setDraft((prev) => ({ ...prev, output: '' }))
      setStatus({
        kind: 'err',
        text: res.isMalformed
          ? t('tool.url.codec.statusMalformed')
          : t('tool.url.codec.statusError', { error: res.error }),
      })
    }
  }

  async function fetchCurrent() {
    setFetching(true)
    try {
      const url = await getCurrentPageUrl()
      if (url) {
        setInput(url)
      }
    } finally {
      setFetching(false)
    }
  }

  function clear() {
    clearDraft()
    setStatus(null)
    setLastAction(null)
  }

  return (
    <div className='tw-sec'>
      <div className='tw-field'>
        <div className='tw-field__label'>
          <span>{t('tool.url.inputLabel')}</span>
          <div className='tw-url-codec__select'>
            <TkSelect
              variant='sm'
              value={scope}
              onChange={(e) => {
                const nextScope = e.target.value as CodecScope
                setScope(nextScope)
                if (lastAction === 'encode') runEncode(input, nextScope)
                else if (lastAction === 'decode') runDecode(input, nextScope)
              }}
              title={t('tool.url.codec.scope')}
            >
              <option value='component'>{t('tool.url.codec.scopeComponent')}</option>
              <option value='full'>{t('tool.url.codec.scopeFull')}</option>
            </TkSelect>
          </div>
        </div>
        <AutoArea
          className='tw-area'
          value={input}
          placeholder={t('tool.url.codec.inputPlaceholder')}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div className='tw-actions'>
        <button type='button' className='tk-btn tk-btn--primary' onClick={() => runEncode()}>
          {t('tool.url.codec.btnEncode')}
        </button>
        <button type='button' className='tk-btn tk-btn--primary' onClick={() => runDecode()}>
          {t('tool.url.codec.btnDecode')}
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

      {status && <StatusText kind={status.kind}>{status.text}</StatusText>}

      <div className='tw-field'>
        <span className='tw-field__label'>
          {t('tool.url.codec.result')}
          <CopyButton
            text={output}
            disabled={!output}
            className='tw-link'
            onResult={(ok) => {
              if (!ok) setStatus({ kind: 'err', text: t('tool.url.codec.copyFailed') })
            }}
          />
        </span>
        <AutoArea
          className='tw-area tw-area--result'
          value={output}
          readOnly
          placeholder={t('tool.url.codec.statusNeedInput')}
        />
      </div>
    </div>
  )
}

/** 网址工具卡片：顶部切换「网址解析」与「网址编解码」 */
export default function UrlTool() {
  const { t } = useTranslation()
  const [tab, setTab] = useToolDraft<MainTab>('url.tab', 'parse')

  return (
    <div className='tw-card'>
      <ToolTabs<MainTab>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'parse', label: t('tool.url.tabParse') },
          { id: 'codec', label: t('tool.url.tabCodec') },
        ]}
      />

      {/* 两个面板都挂载，仅按 tab 显隐，各自独立保留输入草稿与状态 */}
      <div hidden={tab !== 'parse'}>
        <UrlParserPanel />
      </div>
      <div hidden={tab !== 'codec'}>
        <UrlCodecPanel />
      </div>
    </div>
  )
}
