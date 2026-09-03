import { useState } from 'react'

import { copyText } from '@/utils/clipboard'

import { decodeBase64, encodeBase64, isLikelyBase64 } from './base64'

type Mode = 'encode' | 'decode'

interface Status {
  kind: 'ok' | 'err' | 'info'
  text: string
}

const ENCODE_PLACEHOLDER = '输入要编码的文本（支持中文等 UTF-8 字符）…'
const DECODE_PLACEHOLDER = '粘贴 Base64 字符串（自动忽略换行）…'

/** Base64 编解码工具卡片 */
export default function Base64Tool() {
  const [mode, setMode] = useState<Mode>('encode')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<Status | null>(null)

  function switchMode(next: Mode) {
    setMode(next)
    setInput('')
    setOutput('')
    setStatus(null)
  }

  function run() {
    const text = input.trim()
    if (!text) {
      setStatus({ kind: 'info', text: '请先输入内容' })
      setOutput('')
      return
    }
    try {
      if (mode === 'encode') {
        const result = encodeBase64(text)
        setOutput(result)
        setStatus({ kind: 'ok', text: `已编码（UTF-8）：${result.length} 字符` })
      } else {
        if (!isLikelyBase64(text)) {
          setStatus({ kind: 'err', text: '输入内容不太像 Base64（需为 A-Za-z0-9+/ 与 = 组成）' })
          setOutput('')
          return
        }
        const { text: decoded, isText } = decodeBase64(text)
        setOutput(decoded)
        setStatus({
          kind: 'ok',
          text: isText ? '解码成功（UTF-8 文本）' : '解码成功（非 UTF-8 内容，已按原始字节展示）',
        })
      }
    } catch (e) {
      setOutput('')
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : '转换失败' })
    }
  }

  function clear() {
    setInput('')
    setOutput('')
    setStatus(null)
  }

  async function copy() {
    if (!output) return
    const ok = await copyText(output)
    if (ok) setStatus({ kind: 'ok', text: '已复制到剪贴板' })
  }

  return (
    <div className='tw-card'>
      <div className='tw-tabs' role='tablist'>
        <button
          type='button'
          role='tab'
          aria-selected={mode === 'encode'}
          className={`tw-tabs__btn${mode === 'encode' ? ' tw-tabs__btn--on' : ''}`}
          onClick={() => switchMode('encode')}
        >
          编码
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={mode === 'decode'}
          className={`tw-tabs__btn${mode === 'decode' ? ' tw-tabs__btn--on' : ''}`}
          onClick={() => switchMode('decode')}
        >
          解码
        </button>
      </div>

      <label className='tw-field'>
        <span className='tw-field__label'>{mode === 'encode' ? '原文' : 'Base64'}</span>
        <textarea
          className='tw-area'
          value={input}
          placeholder={mode === 'encode' ? ENCODE_PLACEHOLDER : DECODE_PLACEHOLDER}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
      </label>

      <div className='tw-actions'>
        <button type='button' className='tw-btn tw-btn--primary' onClick={run}>
          {mode === 'encode' ? '编码 →' : '解码 →'}
        </button>
        <button type='button' className='tw-btn' onClick={clear}>
          清空
        </button>
      </div>

      <label className='tw-field'>
        <span className='tw-field__label'>
          结果
          <button type='button' className='tw-link' onClick={() => void copy()} disabled={!output}>
            复制
          </button>
        </span>
        <textarea
          className='tw-area tw-area--result'
          value={output}
          readOnly
          placeholder='结果会显示在这里…'
        />
      </label>

      {status && (
        <p className={`tw-status tw-status--${status.kind}`}>
          {status.kind === 'ok' ? '✓ ' : status.kind === 'err' ? '✕ ' : 'ℹ '}
          {status.text}
        </p>
      )}
      <p className='tw-note'>
        编码采用 UTF-8；解码时自动识别是否为文本，非文本内容按原始字节展示。
      </p>
    </div>
  )
}
