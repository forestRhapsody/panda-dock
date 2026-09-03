import { useState } from 'react'

import { copyText } from '@/utils/clipboard'

import { parseStamp } from './timestamp'

const SOURCE_LABEL: Record<string, string> = {
  secs: '按 Unix 秒解析',
  ms: '按 Unix 毫秒解析',
  text: '按日期文本解析',
}

interface Status {
  kind: 'ok' | 'err' | 'info'
  text: string
}

/** 时间戳转换工具：输入秒/毫秒/日期文本，实时输出多格式 */
export default function TimestampTool() {
  const [input, setInput] = useState('')
  const [copiedRow, setCopiedRow] = useState<string | null>(null)
  const result = parseStamp(input)
  const status: Status | null = input.trim()
    ? result.ok
      ? { kind: 'ok', text: SOURCE_LABEL[result.source] }
      : { kind: 'err', text: '无法识别：请输入 Unix 秒/毫秒或可解析的日期文本' }
    : { kind: 'info', text: '输入时间戳（秒/毫秒）或日期文本，自动识别并实时转换' }

  async function copy(value: string, label: string) {
    const ok = await copyText(value)
    if (ok) {
      setCopiedRow(label)
      setTimeout(() => setCopiedRow((cur) => (cur === label ? null : cur)), 1500)
    }
  }

  function fillNow(kind: 'secs' | 'ms') {
    const now = Date.now()
    setInput(kind === 'secs' ? String(Math.floor(now / 1000)) : String(now))
  }

  return (
    <div className='tw-card'>
      <label className='tw-field'>
        <span className='tw-field__label'>时间戳 / 日期</span>
        <textarea
          className='tw-area'
          value={input}
          rows={2}
          placeholder='例如 1516239022 / 1516239022000 / 2024-01-01 12:00:00…'
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
      </label>

      <div className='tw-actions'>
        <button type='button' className='tw-btn' onClick={() => fillNow('secs')}>
          当前秒
        </button>
        <button type='button' className='tw-btn' onClick={() => fillNow('ms')}>
          当前毫秒
        </button>
        <button type='button' className='tw-btn' onClick={() => setInput('')}>
          清空
        </button>
      </div>

      {result.ok && (
        <ul className='tw-stamp'>
          {result.rows.map((row) => (
            <li key={row.label} className='tw-stamp__row'>
              <span className='tw-stamp__label'>{row.label}</span>
              <code className='tw-stamp__value'>{row.value}</code>
              <button
                type='button'
                className='tw-link'
                onClick={() => void copy(row.value, row.label)}
              >
                {copiedRow === row.label ? '已复制' : '复制'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {status && (
        <p className={`tw-status tw-status--${status.kind}`}>
          {status.kind === 'ok' ? '✓ ' : status.kind === 'err' ? '✕ ' : 'ℹ '}
          {status.text}
        </p>
      )}
    </div>
  )
}
