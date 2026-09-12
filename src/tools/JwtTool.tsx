import { useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useToolDraft } from '@/utils/draft'

import CopyButton from './CopyButton'
import JsonHighlight from './JsonHighlight'
import { decodeJwt, SAMPLE_JWT } from './jwt'
import type { JwtDecoded } from './jwt'
import { StatusText } from './StatusText'
import type { ToolStatus } from './StatusText'
import { useEmptyError } from './useEmptyError'

/** JWT 解码工具：解码 header / payload，展示签名与标准声明 */
export default function JwtTool() {
  const { t } = useTranslation()
  const [token, setToken, clearToken] = useToolDraft<string>('jwt.token', '')
  const [decoded, setDecoded] = useState<JwtDecoded | null>(null)
  const [status, setStatus] = useState<ToolStatus | null>(null)
  const { emptyErr, areaRef: inputRef, triggerEmpty, clearEmpty } = useEmptyError()

  function run(text = token) {
    const raw = text
      .trim()
      .replace(/^Bearer\s+/i, '')
      .trim()
    if (!raw) {
      setDecoded(null)
      setStatus(null)
      triggerEmpty()
      return
    }
    const result = decodeJwt(raw)
    if (!result.ok) {
      setDecoded(null)
      setStatus({ kind: 'err', text: result.error })
      return
    }
    setDecoded(result.data)
    setStatus(null)
  }

  function clear() {
    clearToken()
    setDecoded(null)
    setStatus(null)
    clearEmpty()
  }

  function fillSample() {
    clearEmpty()
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
            if (emptyErr) clearEmpty()
            if (status) setStatus(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              run()
            }
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
            <JsonHighlight text={decoded.headerText} maxHeight={180} />
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
            <JsonHighlight text={decoded.payloadText} maxHeight={300} />
          </div>

          <div className='tw-field'>
            <span className='tw-field__label'>
              {t('tool.jwt.signatureLabel')}
              <CopyButton
                text={decoded.signatureB64}
                className='tw-link'
                onResult={(ok) => {
                  if (!ok) setStatus({ kind: 'err', text: t('common.copyFailed') })
                }}
              />
            </span>
            <pre className='tw-json-hl tw-jwt__signature'>
              <code>{decoded.signatureB64}</code>
            </pre>
          </div>

          {decoded.claims.length > 0 && (
            <div className='tw-field'>
              <span className='tw-field__label'>{t('tool.jwt.claimsLabel')}</span>
              <div className='tw-detect__fields'>
                {decoded.claims.map((c) => (
                  <div key={c.key} className='tw-detect__field'>
                    <span className='tw-detect__field-label'>{c.label}</span>
                    <code className='tw-detect__field-value tw-detect__field-value--mono'>
                      {c.display}
                    </code>
                    {c.hint && (
                      <span
                        className={`tw-jwt__time-hint${c.hint.expired ? ' tw-jwt__time-hint--expired' : ''}`}
                      >
                        {c.hint.text}
                      </span>
                    )}
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
