import { useState } from 'react'

import { useTranslation } from 'react-i18next'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'
import { decodeJwt, SAMPLE_JWT } from './jwt'
import type { JwtDecoded } from './jwt'
import { StatusText } from './StatusText'
import type { ToolStatus } from './StatusText'

function headerAlg(decoded: JwtDecoded, unknownLabel: string): string {
  try {
    const header = JSON.parse(decoded.headerText) as { alg?: string }
    return header.alg ?? unknownLabel
  } catch {
    return unknownLabel
  }
}

/** JWT 解码工具：解码 header / payload，展示标准声明；不校验签名 */
export default function JwtTool() {
  const { t } = useTranslation()
  const [token, setToken] = useState('')
  const [decoded, setDecoded] = useState<JwtDecoded | null>(null)
  const [status, setStatus] = useState<ToolStatus | null>(null)

  function run() {
    const raw = token.trim()
    if (!raw) {
      setDecoded(null)
      setStatus({ kind: 'info', text: t('tool.jwt.statusEmpty') })
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
      text: t('tool.jwt.statusSuccess', {
        alg: headerAlg(result.data, t('tool.jwt.algUnknown')),
        len: result.data.signatureB64.length,
      }),
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
    setStatus({ kind: 'info', text: t('tool.jwt.statusSample') })
  }

  return (
    <div className='tw-card'>
      <label className='tw-field'>
        <span className='tw-field__label'>
          JWT Token
          <button type='button' className='tw-link' onClick={fillSample}>
            {t('tool.jwt.fillSample')}
          </button>
        </span>
        <textarea
          className='tw-area'
          value={token}
          placeholder={t('tool.jwt.placeholder')}
          onChange={(e) => setToken(e.target.value)}
          spellCheck={false}
        />
      </label>

      <div className='tw-actions'>
        <button type='button' className='tk-btn tk-btn--primary' onClick={run}>
          {t('tool.jwt.decode')}
        </button>
        <button type='button' className='tk-btn' onClick={clear}>
          {t('tool.jwt.clear')}
        </button>
      </div>

      {decoded && (
        <>
          <div className='tw-field'>
            <span className='tw-field__label'>
              {t('tool.jwt.headerLabel')}
              <CopyButton
                text={decoded.headerText}
                className='tw-link'
                onResult={(ok) => {
                  if (!ok) setStatus({ kind: 'err', text: t('tool.jwt.copyFailed') })
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
              {t('tool.jwt.payloadLabel')}
              <CopyButton
                text={decoded.payloadText}
                className='tw-link'
                onResult={(ok) => {
                  if (!ok) setStatus({ kind: 'err', text: t('tool.jwt.copyFailed') })
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
              <span className='tw-field__label'>{t('tool.jwt.claimsLabel')}</span>
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

          <p className='tw-note'>{t('tool.jwt.noteLocal')}</p>
        </>
      )}

      {status && <StatusText kind={status.kind}>{status.text}</StatusText>}
    </div>
  )
}
