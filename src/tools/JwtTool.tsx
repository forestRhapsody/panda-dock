import { useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useToolDraft } from '@/utils/draft'

import CopyButton from './CopyButton'
import JsonHighlight from './JsonHighlight'
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
  const [token, setToken, clearToken] = useToolDraft<string>('jwt.token', '')
  const [decoded, setDecoded] = useState<JwtDecoded | null>(null)
  const [status, setStatus] = useState<ToolStatus | null>(null)
  const [emptyErr, setEmptyErr] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const raw = token.trim()
    if (!raw) {
      setDecoded(null)
      return
    }
    const result = decodeJwt(raw)
    if (result.ok) {
      setDecoded(result.data)
    } else {
      setDecoded(null)
    }
  }, [token])

  function run(text = token) {
    const raw = text.trim()
    if (!raw) {
      setDecoded(null)
      setStatus(null)
      setEmptyErr(true)
      inputRef.current?.focus()
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
    clearToken()
    setDecoded(null)
    setStatus(null)
    setEmptyErr(false)
  }

  function fillSample() {
    setEmptyErr(false)
    setToken(SAMPLE_JWT)
    run(SAMPLE_JWT)
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
          ref={inputRef}
          className={`tw-area${emptyErr ? ' tw-area--empty-err' : ''}`}
          value={token}
          placeholder={t('tool.jwt.placeholder')}
          onChange={(e) => {
            setToken(e.target.value)
            if (emptyErr) setEmptyErr(false)
            if (status) setStatus(null)
          }}
          spellCheck={false}
        />
      </label>

      <div className='tw-actions'>
        <button type='button' className='tk-btn tk-btn--primary' onClick={() => run()}>
          {t('tool.jwt.decode')}
        </button>
        <button type='button' className='tk-btn' onClick={clear}>
          {t('common.clear')}
        </button>
      </div>

      {status && <StatusText kind={status.kind}>{status.text}</StatusText>}

      {decoded && (
        <>
          <div className='tw-field'>
            <span className='tw-field__label'>
              {t('tool.jwt.headerLabel')}
              <CopyButton
                text={decoded.headerText}
                className='tw-link'
                onResult={(ok) => {
                  if (!ok) setStatus({ kind: 'err', text: t('common.copyFailed') })
                }}
              />
            </span>
            <JsonHighlight text={decoded.headerText} maxHeight={180} showLineNumbers />
          </div>

          <div className='tw-field'>
            <span className='tw-field__label'>
              {t('tool.jwt.payloadLabel')}
              <CopyButton
                text={decoded.payloadText}
                className='tw-link'
                onResult={(ok) => {
                  if (!ok) setStatus({ kind: 'err', text: t('common.copyFailed') })
                }}
              />
            </span>
            <JsonHighlight text={decoded.payloadText} maxHeight={300} showLineNumbers />
          </div>

          {decoded.claims.length > 0 && (
            <div className='tw-field'>
              <span className='tw-field__label'>{t('tool.jwt.claimsLabel')}</span>
              <div className='tw-detect__fields'>
                {decoded.claims.map((c) => (
                  <div key={c.key} className='tw-detect__field'>
                    <span className='tw-detect__field-label'>{c.key}</span>
                    <code className='tw-detect__field-value tw-detect__field-value--mono'>
                      {c.display}
                    </code>
                    <CopyButton text={c.display} icon className='tw-detect__copy' />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
