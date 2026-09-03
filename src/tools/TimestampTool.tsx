import { useState } from 'react'

import CopyButton from './CopyButton'
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
  const result = parseStamp(input)
  const status: Status | null = input.trim()
    ? result.ok
      ? { kind: 'ok', text: SOURCE_LABEL[result.source] }
      : { kind: 'err', text: '无法识别：请输入 Unix 秒/毫秒或可解析的日期文本' }
    : { kind: 'info', text: '输入时间戳（秒/毫秒）或日期文本，自动识别并实时转换' }

  function fillNow() {
    setInput(String(Date.now()))
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
        <button type='button' className='tk-btn' onClick={fillNow}>
          当前时间
        </button>
        <button type='button' className='tk-btn' onClick={() => setInput('')}>
          清空
        </button>
      </div>

      {result.ok && (
        <ul className='tw-stamp'>
          {result.rows.map((row) => (
            <li key={row.label} className='tw-stamp__row'>
              <span className='tw-stamp__label'>{row.label}</span>
              <code className='tw-stamp__value'>{row.value}</code>
              <CopyButton text={row.value} className='tw-link' />
            </li>
          ))}
        </ul>
      )}

      {status && <p className={`tw-status tw-status--${status.kind}`}>{status.text}</p>}
    </div>
  )
}
