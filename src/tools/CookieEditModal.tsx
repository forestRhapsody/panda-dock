import { useCallback, useEffect, useMemo, useState } from 'react'

import { useTranslation } from 'react-i18next'

import Icon from '@/ui/Icon'
import PdSelect from '@/ui/PdSelect'
import Tooltip from '@/ui/Tooltip'

import AutoArea from './AutoArea'
import { parseRawCookie, serializeCookieToRaw, type CookieSetDetails } from './cookieRaw'
import { StatusText } from './StatusText'
import type { CookieEntry } from './storage'
import { bareCookieDomain, saveCookies } from './storage'
import ToolTabs from './ToolTabs'

export type CookieEditMode = 'form' | 'raw'
type ExpiresType = 'session' | '1d' | '7d' | '30d' | '1y' | 'custom'

interface CookieEditModalProps {
  open: boolean
  cookie: CookieEntry | null
  pageUrl: string
  onClose: () => void
  onSaved: (count: number) => void
}

function computeDefaultDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export default function CookieEditModal({
  open,
  cookie,
  pageUrl,
  onClose,
  onSaved,
}: CookieEditModalProps) {
  const { t } = useTranslation()
  const defaultDomain = useMemo(() => computeDefaultDomain(pageUrl), [pageUrl])
  const defaultSecure = useMemo(() => pageUrl.startsWith('https:'), [pageUrl])

  const [mode, setMode] = useState<CookieEditMode>('form')
  const [maximized, setMaximized] = useState(false)

  // 表单字段
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [domain, setDomain] = useState('')
  const [path, setPath] = useState('/')
  const [expiresType, setExpiresType] = useState<ExpiresType>('session')
  const [customExpires, setCustomExpires] = useState('')
  const [sameSite, setSameSite] = useState<'no_restriction' | 'lax' | 'strict' | 'unspecified'>(
    'lax',
  )
  const [secure, setSecure] = useState(defaultSecure)
  const [httpOnly, setHttpOnly] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Raw 文本
  const [rawText, setRawText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 初始化填充数据
  useEffect(() => {
    if (!open) return

    setMode('form')
    setMaximized(false)
    setError(null)
    setSubmitting(false)

    if (cookie) {
      setName(cookie.name)
      setValue(cookie.value)
      setDomain(bareCookieDomain(cookie.domain))
      setPath(cookie.path || '/')
      setSecure(Boolean(cookie.secure))
      setHttpOnly(Boolean(cookie.httpOnly))
      setSameSite(cookie.sameSite || 'lax')

      if (cookie.session || !cookie.expirationDate) {
        setExpiresType('session')
        setCustomExpires('')
      } else {
        setExpiresType('custom')
        setCustomExpires(String(cookie.expirationDate))
      }

      // 编辑时如果有高级非默认属性，自动展开高级项
      const isAdv =
        Boolean(cookie.httpOnly) ||
        bareCookieDomain(cookie.domain) !== defaultDomain ||
        (cookie.path && cookie.path !== '/') ||
        !cookie.session
      setShowAdvanced(isAdv)

      setRawText(
        serializeCookieToRaw(
          {
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
            expirationDate: cookie.expirationDate,
          },
          'set-cookie',
        ),
      )
    } else {
      setName('')
      setValue('')
      setDomain(defaultDomain)
      setPath('/')
      setExpiresType('session')
      setCustomExpires('')
      setSecure(defaultSecure)
      setHttpOnly(false)
      setSameSite('lax')
      setShowAdvanced(false)
      setRawText('')
    }
  }, [open, cookie, defaultDomain, defaultSecure])

  const handleClose = useCallback(() => {
    setMaximized(false)
    onClose()
  }, [onClose])

  // ESC 键关闭
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) {
        e.preventDefault()
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, submitting, handleClose])

  // 计算过期时间戳（秒）
  function computeExpirationDate(): number | undefined {
    if (expiresType === 'session') return undefined
    const nowSec = Math.floor(Date.now() / 1000)
    if (expiresType === '1d') return nowSec + 86400
    if (expiresType === '7d') return nowSec + 86400 * 7
    if (expiresType === '30d') return nowSec + 86400 * 30
    if (expiresType === '1y') return nowSec + 86400 * 365
    if (expiresType === 'custom') {
      const num = Number.parseInt(customExpires, 10)
      return Number.isNaN(num) ? undefined : num
    }
    return undefined
  }

  // 模式切换时自动双向同步数据
  function handleModeChange(nextMode: CookieEditMode) {
    if (nextMode === mode) return

    if (nextMode === 'raw') {
      // Form → Raw: 仅当有输入时序列化，否则保留空串
      if (name.trim() || value) {
        const details: Partial<CookieSetDetails> = {
          name: name.trim(),
          value,
          domain: domain || defaultDomain,
          path: path || '/',
          secure,
          httpOnly,
          sameSite,
          expirationDate: computeExpirationDate(),
        }
        setRawText(serializeCookieToRaw(details, 'set-cookie'))
      }
      setError(null)
      setMode('raw')
    } else {
      // Raw → Form: 尝试从 Raw 解析并填充，若解析失败不阻止切回表单
      const trimmed = rawText.trim()
      if (trimmed) {
        const parseRes = parseRawCookie(rawText, defaultDomain, '/')
        if (parseRes.ok && parseRes.cookies[0]) {
          const first = parseRes.cookies[0]
          setName(first.name)
          setValue(first.value)
          setDomain(first.domain || defaultDomain)
          setPath(first.path || '/')
          setSecure(Boolean(first.secure))
          setHttpOnly(Boolean(first.httpOnly))
          setSameSite(first.sameSite || 'lax')
          if (first.expirationDate) {
            setExpiresType('custom')
            setCustomExpires(String(first.expirationDate))
          } else {
            setExpiresType('session')
            setCustomExpires('')
          }
        }
      }
      setError(null)
      setMode('form')
    }
  }

  // 实时检测当前 Raw 文本解析状态
  const rawParseResult = useMemo(() => {
    if (mode !== 'raw' || !rawText.trim()) return null
    const res = parseRawCookie(rawText, defaultDomain, '/')
    if (res.ok) {
      return { ok: true, count: res.cookies.length }
    }
    return { ok: false, error: res.error }
  }, [mode, rawText, defaultDomain])

  // 保存处理
  async function handleSave() {
    setError(null)
    setSubmitting(true)

    try {
      if (mode === 'form') {
        const trimmedName = name.trim()
        if (!trimmedName) {
          setError(t('tool.storage.cookieNameRequired'))
          setSubmitting(false)
          return
        }

        const details: CookieSetDetails = {
          name: trimmedName,
          value,
          domain: domain.trim() || undefined,
          path: path.trim() || '/',
          secure,
          httpOnly,
          sameSite,
          expirationDate: computeExpirationDate(),
        }

        const res = await saveCookies(details, pageUrl, cookie ?? undefined)
        if (!res.ok) {
          setError(res.error)
          setSubmitting(false)
          return
        }
        onSaved(1)
        handleClose()
      } else {
        // Raw 模式
        const parseRes = parseRawCookie(rawText, defaultDomain, '/')
        if (!parseRes.ok) {
          setError(parseRes.error)
          setSubmitting(false)
          return
        }

        const res = await saveCookies(parseRes.cookies, pageUrl, cookie ?? undefined)
        if (!res.ok) {
          setError(res.error)
          setSubmitting(false)
          return
        }
        onSaved(parseRes.cookies.length)
        handleClose()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className='pd-modal'>
      <div
        className={`pd-modal__card tw-cookie-modal${maximized ? ' tw-cookie-modal--maximized' : ''}`}
        role='dialog'
        aria-modal='true'
        aria-labelledby='tw-cookie-modal-title'
      >
        {/* 顶部标题与切换栏 */}
        <div className='tw-cookie-modal__head'>
          <h3 id='tw-cookie-modal-title' className='tw-cookie-modal__title'>
            {cookie ? t('tool.storage.cookieEditTitle') : t('tool.storage.cookieAddTitle')}
          </h3>

          <div className='tw-cookie-modal__tabs'>
            <ToolTabs<CookieEditMode>
              value={mode}
              onChange={handleModeChange}
              items={[
                { id: 'form', label: t('tool.storage.cookieModeForm') },
                { id: 'raw', label: t('tool.storage.cookieModeRaw') },
              ]}
            />
          </div>

          <div className='tw-cookie-modal__head-actions'>
            <Tooltip
              content={maximized ? t('tool.storage.minimize') : t('tool.storage.maximize')}
              side='bottom'
            >
              <button
                type='button'
                className='pd-icon-btn'
                onClick={() => setMaximized((v) => !v)}
                aria-label={maximized ? t('tool.storage.minimize') : t('tool.storage.maximize')}
              >
                <Icon name={maximized ? 'minimize' : 'maximize'} size={15} />
              </button>
            </Tooltip>
            <Tooltip content={t('common.cancel')} side='bottom'>
              <button
                type='button'
                className='pd-icon-btn'
                onClick={handleClose}
                aria-label={t('common.cancel')}
              >
                <Icon name='close' size={15} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* 弹窗主体内容 */}
        <div className='tw-cookie-modal__body'>
          {mode === 'form' ? (
            <div className='tw-cookie-modal__form'>
              <label className='tw-field'>
                <span className='tw-field__label'>
                  <span>{t('tool.storage.cookieName')} *</span>
                </span>
                <input
                  type='text'
                  className='tw-input'
                  value={name}
                  spellCheck={false}
                  onChange={(e) => {
                    setName(e.target.value)
                    setError(null)
                  }}
                  placeholder='cookie_name'
                  autoFocus
                />
              </label>

              <label className='tw-field'>
                <span className='tw-field__label'>
                  <span>{t('tool.storage.cookieValue')}</span>
                </span>
                <AutoArea
                  className='tw-area tw-cookie-modal__val-area'
                  value={value}
                  spellCheck={false}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder='cookie_value'
                  maxHeight={maximized ? 360 : 160}
                />
              </label>

              <div className='tw-cookie-modal__adv-toggle'>
                <button
                  type='button'
                  className='tw-link'
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  <Icon
                    name='chevron-down'
                    size={14}
                    className={showAdvanced ? 'tw-cookie-modal__adv-icon--open' : undefined}
                  />
                  {showAdvanced
                    ? t('tool.storage.cookieHideAdvanced')
                    : t('tool.storage.cookieShowAdvanced')}
                </button>
              </div>

              {showAdvanced && (
                <div className='tw-cookie-modal__adv-panel'>
                  <div className='tw-cookie-modal__row'>
                    <label className='tw-field tw-cookie-modal__col'>
                      <span className='tw-field__label'>{t('tool.storage.cookieDomain')}</span>
                      <input
                        type='text'
                        className='tw-input'
                        value={domain}
                        spellCheck={false}
                        onChange={(e) => setDomain(e.target.value)}
                        placeholder='example.com'
                      />
                    </label>

                    <label className='tw-field tw-cookie-modal__col'>
                      <span className='tw-field__label'>{t('tool.storage.cookiePath')}</span>
                      <input
                        type='text'
                        className='tw-input'
                        value={path}
                        spellCheck={false}
                        onChange={(e) => setPath(e.target.value)}
                        placeholder='/'
                      />
                    </label>
                  </div>

                  <div className='tw-cookie-modal__row'>
                    <div className='tw-field tw-cookie-modal__col'>
                      <span className='tw-field__label'>{t('tool.storage.cookieExpires')}</span>
                      <PdSelect
                        value={expiresType}
                        onChange={(e) => setExpiresType(e.target.value as ExpiresType)}
                      >
                        <option value='session'>{t('tool.storage.cookieSession')}</option>
                        <option value='1d'>{t('tool.storage.expires1d')}</option>
                        <option value='7d'>{t('tool.storage.expires7d')}</option>
                        <option value='30d'>{t('tool.storage.expires30d')}</option>
                        <option value='1y'>{t('tool.storage.expires1y')}</option>
                        <option value='custom'>{t('tool.storage.expiresCustom')}</option>
                      </PdSelect>
                    </div>

                    {expiresType === 'custom' ? (
                      <label className='tw-field tw-cookie-modal__col'>
                        <span className='tw-field__label'>
                          {t('tool.storage.expiresTimestamp')}
                        </span>
                        <input
                          type='number'
                          className='tw-input'
                          value={customExpires}
                          onChange={(e) => setCustomExpires(e.target.value)}
                          placeholder='1780000000'
                        />
                      </label>
                    ) : (
                      <div className='tw-field tw-cookie-modal__col'>
                        <span className='tw-field__label'>SameSite</span>
                        <PdSelect
                          value={sameSite}
                          onChange={(e) => {
                            const v = e.target.value as
                              | 'no_restriction'
                              | 'lax'
                              | 'strict'
                              | 'unspecified'
                            setSameSite(v)
                            if (v === 'no_restriction') setSecure(true)
                          }}
                        >
                          <option value='lax'>Lax</option>
                          <option value='strict'>Strict</option>
                          <option value='no_restriction'>None (Secure)</option>
                          <option value='unspecified'>Unspecified</option>
                        </PdSelect>
                      </div>
                    )}
                  </div>

                  {expiresType === 'custom' && (
                    <div className='tw-cookie-modal__row'>
                      <div className='tw-field tw-cookie-modal__col'>
                        <span className='tw-field__label'>SameSite</span>
                        <PdSelect
                          value={sameSite}
                          onChange={(e) => {
                            const v = e.target.value as
                              | 'no_restriction'
                              | 'lax'
                              | 'strict'
                              | 'unspecified'
                            setSameSite(v)
                            if (v === 'no_restriction') setSecure(true)
                          }}
                        >
                          <option value='lax'>Lax</option>
                          <option value='strict'>Strict</option>
                          <option value='no_restriction'>None (Secure)</option>
                          <option value='unspecified'>Unspecified</option>
                        </PdSelect>
                      </div>
                      <div className='tw-cookie-modal__col' />
                    </div>
                  )}

                  <div className='tw-cookie-modal__checkboxes'>
                    <label className='tw-cookie-modal__check-item'>
                      <input
                        type='checkbox'
                        checked={httpOnly}
                        onChange={(e) => setHttpOnly(e.target.checked)}
                      />
                      <span>HttpOnly ({t('tool.storage.cookieHttpOnlyDesc')})</span>
                    </label>

                    <label className='tw-cookie-modal__check-item'>
                      <input
                        type='checkbox'
                        checked={secure}
                        onChange={(e) => {
                          const nextSecure = e.target.checked
                          setSecure(nextSecure)
                          if (!nextSecure && sameSite === 'no_restriction') {
                            setSameSite('lax')
                          }
                        }}
                      />
                      <span>Secure ({t('tool.storage.cookieSecureDesc')})</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className='tw-cookie-modal__raw'>
              <div className='tw-cookie-modal__raw-toolbar'>
                <span className='tw-field__label'>
                  <span>{t('tool.storage.cookieRawInput')}</span>
                </span>
                <div className='tw-cookie-modal__raw-actions'>
                  <Tooltip content={t('tool.storage.convertToSetCookie')}>
                    <button
                      type='button'
                      className='tw-link'
                      onClick={() => {
                        const p = parseRawCookie(rawText, defaultDomain, '/')
                        if (p.ok && p.cookies[0]) {
                          setRawText(serializeCookieToRaw(p.cookies[0], 'set-cookie'))
                        }
                      }}
                    >
                      Set-Cookie
                    </button>
                  </Tooltip>
                  <Tooltip content={t('tool.storage.convertToJson')}>
                    <button
                      type='button'
                      className='tw-link'
                      onClick={() => {
                        const p = parseRawCookie(rawText, defaultDomain, '/')
                        if (p.ok) {
                          setRawText(
                            JSON.stringify(
                              p.cookies.length === 1 ? p.cookies[0] : p.cookies,
                              null,
                              2,
                            ),
                          )
                        }
                      }}
                    >
                      JSON
                    </button>
                  </Tooltip>
                </div>
              </div>

              <AutoArea
                className='tw-area tw-cookie-modal__raw-area'
                value={rawText}
                onChange={(e) => {
                  setRawText(e.target.value)
                  setError(null)
                }}
                placeholder={t('tool.storage.cookieRawPlaceholder')}
                maxHeight={maximized ? 540 : 260}
                spellCheck={false}
              />

              {rawParseResult && (
                <StatusText kind={rawParseResult.ok ? 'ok' : 'err'}>
                  {rawParseResult.ok
                    ? t('tool.storage.rawParseSuccess', { count: rawParseResult.count })
                    : rawParseResult.error}
                </StatusText>
              )}

              <p className='tw-note'>{t('tool.storage.cookieRawNote')}</p>
            </div>
          )}
        </div>

        {/* 底部按钮栏 */}
        <div className='pd-modal__actions tw-cookie-modal__foot'>
          {error && (
            <StatusText kind='err' className='tw-cookie-modal__err'>
              {error}
            </StatusText>
          )}
          <button type='button' className='pd-btn' onClick={handleClose} disabled={submitting}>
            {t('common.cancel')}
          </button>
          <button
            type='button'
            className='pd-btn pd-btn--primary'
            disabled={
              submitting ||
              (mode === 'form' && !name.trim()) ||
              (mode === 'raw' && (!rawText.trim() || !rawParseResult?.ok))
            }
            onClick={() => void handleSave()}
          >
            {submitting
              ? t('tool.storage.saving')
              : mode === 'raw' && rawParseResult?.ok && (rawParseResult.count ?? 1) > 1
                ? t('tool.storage.cookieSaveBatch', { count: rawParseResult.count })
                : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
