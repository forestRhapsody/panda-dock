import { useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useToolDraft } from '@/utils/draft'

import CopyButton from './CopyButton'
import { StatusText } from './StatusText'
import { parseStamp } from './timestamp'
import type { StampResult, StampSource } from './timestamp'
import { useEmptyError } from './useEmptyError'
import { useTabIndent } from './useTabIndent'

const SOURCE_KEY: Record<StampSource, string> = {
  secs: 'tool.timestamp.sourceSeconds',
  ms: 'tool.timestamp.sourceMilliseconds',
  text: 'tool.timestamp.sourceText',
}

/** 时间戳转换工具：输入秒/毫秒/日期文本，按钮触发转换多格式输出 */
export default function TimestampTool() {
  const { t } = useTranslation()
  const [input, setInput, clearInput, inputLoaded] = useToolDraft<string>('timestamp.input', '')
  const [result, setResult] = useState<StampResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { emptyErr, areaRef: inputRef, triggerEmpty, clearEmpty } = useEmptyError()
  /** 是否已为恢复出来的草稿补算过结果（只补一次，之后仍由用户点按钮触发） */
  const hydratedRef = useRef(false)

  // 草稿里的输入恢复后自动补算一次：否则重开抽屉只剩输入框、结果区空着
  // （与 URL 解析 / JSON 工作台一致；本工具是按钮触发式，因此只补这一次，不改成实时解析）
  useEffect(() => {
    if (!inputLoaded || hydratedRef.current) return
    hydratedRef.current = true
    const raw = input.trim()
    if (!raw) return
    const res = parseStamp(raw)
    // 只补算能解析成功的值：重开时不该无故弹出上一次的错误横幅
    if (res.ok) {
      setResult(res)
      setError(null)
    }
  }, [inputLoaded, input])

  // Ctrl/Cmd+Enter 转换 + Tab 缩进（hook 先跑自身回调，再决定要不要接管 Tab）
  const handleInputKeyDown = useTabIndent((e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      run()
    }
  })

  function run(text = input) {
    const raw = text.trim()
    if (!raw) {
      setResult(null)
      setError(null)
      triggerEmpty()
      return
    }
    const res = parseStamp(raw)
    if (!res.ok) {
      setResult(null)
      setError(t('tool.timestamp.errorInvalid'))
      return
    }
    setResult(res)
    setError(null)
  }

  function fillNow() {
    clearEmpty()
    const nowStr = String(Date.now())
    setInput(nowStr)
    run(nowStr)
  }

  function clear() {
    clearInput()
    setResult(null)
    setError(null)
    clearEmpty()
  }

  return (
    <div className='tw-card'>
      <label className='tw-field'>
        <span className='tw-field__label'>{t('tool.timestamp.labelInput')}</span>
        <textarea
          ref={inputRef}
          className={`tw-area${emptyErr ? ' tw-area--empty-err' : ''}`}
          value={input}
          rows={2}
          placeholder={t('tool.timestamp.placeholder')}
          onChange={(e) => {
            setInput(e.target.value)
            if (emptyErr) clearEmpty()
            if (error) setError(null)
          }}
          onKeyDown={handleInputKeyDown}
          spellCheck={false}
        />
        <span className='tw-field__hint'>{t('tool.timestamp.hint')}</span>
      </label>

      <div className='tw-actions'>
        <button type='button' className='pd-btn pd-btn--primary' onClick={() => run()}>
          {t('tool.timestamp.convert')}
        </button>
        <button type='button' className='pd-btn' onClick={fillNow}>
          {t('tool.timestamp.now')}
        </button>
        <button type='button' className='pd-btn' onClick={clear}>
          {t('common.clear')}
        </button>
      </div>

      {error && <StatusText kind='err'>{error}</StatusText>}

      {result && result.ok && (
        <>
          <StatusText kind='ok'>{t(SOURCE_KEY[result.source])}</StatusText>
          <div className='tw-detect__fields'>
            {result.rows.map((row) => (
              <div key={row.label} className='tw-detect__field'>
                <span className='tw-detect__field-label'>{row.label}</span>
                <code className='tw-detect__field-value tw-detect__field-value--mono'>
                  {row.value}
                </code>
                <CopyButton text={row.value} icon className='tw-detect__copy' />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
