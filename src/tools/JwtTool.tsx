import { useState } from 'react'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'
import { decodeJwt, SAMPLE_JWT } from './jwt'
import type { JwtDecoded } from './jwt'

interface Status {
  kind: 'ok' | 'err' | 'info'
  text: string
}

function headerAlg(decoded: JwtDecoded): string {
  try {
    const header = JSON.parse(decoded.headerText) as { alg?: string }
    return header.alg ?? '未知'
  } catch {
    return '未知'
  }
}

/** JWT 解码工具：解码 header / payload，展示标准声明；不校验签名 */
export default function JwtTool() {
  const [token, setToken] = useState('')
  const [decoded, setDecoded] = useState<JwtDecoded | null>(null)
  const [status, setStatus] = useState<Status | null>(null)

  function run() {
    const raw = token.trim()
    if (!raw) {
      setDecoded(null)
      setStatus({ kind: 'info', text: '请先粘贴 JWT（header.payload.signature）' })
      return
    }
    const result = decodeJwt(raw)
    if (!result.ok) {
      setDecoded(null)
      setStatus({ kind: 'err', text: result.error })
      return
    }
    setDecoded(result.data)
    setStatus({
      kind: 'ok',
      text: `解码成功：alg=${headerAlg(result.data)} · 签名长度 ${result.data.signatureB64.length} 字符（本地解码，未校验签名）`,
    })
  }

  function clear() {
    setToken('')
    setDecoded(null)
    setStatus(null)
  }

  function fillSample() {
    setToken(SAMPLE_JWT)
    setDecoded(null)
    setStatus({ kind: 'info', text: '已填入示例 JWT，点击「解码 →」查看效果' })
  }

  return (
    <div className='tw-card'>
      <label className='tw-field'>
        <span className='tw-field__label'>
          JWT Token
          <button type='button' className='tw-link' onClick={fillSample}>
            填入示例
          </button>
        </span>
        <textarea
          className='tw-area'
          value={token}
          placeholder='粘贴 JWT，例如 eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSM…'
          onChange={(e) => setToken(e.target.value)}
          spellCheck={false}
        />
      </label>

      <div className='tw-actions'>
        <button type='button' className='tw-btn tw-btn--primary' onClick={run}>
          解码 →
        </button>
        <button type='button' className='tw-btn' onClick={clear}>
          清空
        </button>
      </div>

      {decoded && (
        <>
          <div className='tw-field'>
            <span className='tw-field__label'>
              Header（算法等）
              <CopyButton
                text={decoded.headerText}
                className='tw-link'
                onResult={(ok) => {
                  if (!ok) setStatus({ kind: 'err', text: '复制失败' })
                }}
              />
            </span>
            <AutoArea
              className='tw-area tw-area--result'
              value={decoded.headerText}
              readOnly
              spellCheck={false}
            />
          </div>

          <div className='tw-field'>
            <span className='tw-field__label'>
              Payload（载荷）
              <CopyButton
                text={decoded.payloadText}
                className='tw-link'
                onResult={(ok) => {
                  if (!ok) setStatus({ kind: 'err', text: '复制失败' })
                }}
              />
            </span>
            <AutoArea
              className='tw-area tw-area--result'
              value={decoded.payloadText}
              readOnly
              spellCheck={false}
            />
          </div>

          {decoded.claims.length > 0 && (
            <div className='tw-field'>
              <span className='tw-field__label'>标准声明（时间已转本地时间）</span>
              <ul className='tw-kv'>
                {decoded.claims.map((c) => (
                  <li key={c.key} className='tw-kv__row'>
                    <span className='tw-kv__k'>{c.key}</span>
                    <span className='tw-kv__v'>{c.display}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className='tw-note'>
            本地解码，Token 不会上传到任何服务器；本工具不校验签名（无密钥无法校验）。
          </p>
        </>
      )}

      {status && <p className={`tw-status tw-status--${status.kind}`}>{status.text}</p>}
    </div>
  )
}
