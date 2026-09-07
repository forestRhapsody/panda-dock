import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'

import { useTranslation } from 'react-i18next'

import Icon from '@/ui/Icon'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'
import DownloadButton from './DownloadButton'
import { detectMimeFromBytes, fmtSize } from './file'
import { StatusText } from './StatusText'
import ToolTabs from './ToolTabs'

type Mode = 'encode' | 'decode'

/** 文件大小上限（超出拒绝），以及软警告阈值 */
const MAX_FILE_BYTES = 5 * 1024 * 1024
const WARN_FILE_BYTES = 1 * 1024 * 1024

function firstFile(list: FileList | null): File | null {
  return list && list.length > 0 ? list[0] : null
}

/** 文件 / 图片 → Base64（含 Data URL），反向可还原下载 */
export default function FileBase64Tool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('encode')

  // —— 文件 → Base64 ——
  const [file, setFile] = useState<File | null>(null)
  const [dataUrl, setDataUrl] = useState('')
  const [encError, setEncError] = useState<string | null>(null)
  const [encDragging, setEncDragging] = useState(false)
  const encInputRef = useRef<HTMLInputElement>(null)
  const encDragCount = useRef(0)

  // —— Base64 → 文件 ——
  const [input, setInput] = useState('')
  const [decInfo, setDecInfo] = useState<{
    mime: string
    dataUrl: string
    sizeBytes: number
  } | null>(null)
  const [decError, setDecError] = useState<string | null>(null)

  const readFile = useCallback(
    (f: File) => {
      if (f.size > MAX_FILE_BYTES) {
        setEncError(t('tool.fileB64.tooLarge'))
        setFile(null)
        setDataUrl('')
        return
      }
      setFile(f)
      setEncError(null)
      const reader = new FileReader()
      reader.onload = () => setDataUrl(String(reader.result ?? ''))
      reader.onerror = () => setEncError(t('tool.fileB64.readFailed'))
      reader.readAsDataURL(f)
    },
    [t],
  )

  const handleEncChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = firstFile(e.target.files)
    if (f) readFile(f)
    e.target.value = ''
  }

  const handleEncDrop = (e: DragEvent) => {
    e.preventDefault()
    encDragCount.current = 0
    setEncDragging(false)
    const f = firstFile(e.dataTransfer.files)
    if (f) readFile(f)
  }

  const handleEncDragEnter = (e: DragEvent) => {
    e.preventDefault()
    encDragCount.current++
    setEncDragging(true)
  }
  const handleEncDragLeave = () => {
    encDragCount.current = Math.max(0, encDragCount.current - 1)
    if (encDragCount.current === 0) setEncDragging(false)
  }

  const openEncPicker = () => encInputRef.current?.click()

  // 粘贴图片/文件 → 直接编码
  useEffect(() => {
    if (mode !== 'encode') return
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      const fileItem = items ? Array.from(items).find((i) => i.kind === 'file') : undefined
      const f = fileItem?.getAsFile()
      if (f) {
        e.preventDefault()
        readFile(f)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [mode, readFile])

  // —— 解码：解析 base64 / data URL ——
  useEffect(() => {
    const raw = input.trim()
    if (!raw) {
      setDecInfo(null)
      setDecError(null)
      return
    }
    let dUrl = raw
    let mime = 'application/octet-stream'
    if (raw.startsWith('data:')) {
      mime = raw.match(/^data:([^;]+);/)?.[1] ?? mime
      const b64Part = (raw.split(',')[1] ?? '').replace(/\s+/g, '')
      dUrl = `data:${mime};base64,${b64Part}`
    } else {
      let clean = raw.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
      if (clean.length % 4 === 1) {
        setDecInfo(null)
        setDecError(t('tool.fileB64.invalidBase64'))
        return
      }
      if (clean.length % 4 !== 0) {
        clean = clean + '='.repeat((4 - (clean.length % 4)) % 4)
      }
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
        setDecInfo(null)
        setDecError(t('tool.fileB64.invalidBase64'))
        return
      }
      mime = detectMimeFromBytes(clean) ?? mime
      dUrl = `data:${mime};base64,${clean}`
    }
    try {
      const b64 = dUrl.split(',')[1] ?? ''
      const bin = atob(b64)
      setDecInfo({ mime, dataUrl: dUrl, sizeBytes: bin.length })
      setDecError(null)
    } catch {
      setDecInfo(null)
      setDecError(t('tool.fileB64.invalidBase64'))
    }
  }, [input, t])

  async function pasteClipboardText() {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setInput(text)
      else setDecError(t('tool.fileB64.noClipboardText'))
    } catch {
      setDecError(t('tool.fileB64.clipboardDenied'))
    }
  }

  const mime = dataUrl.match(/^data:([^;]+);/)?.[1] ?? ''
  const base64 = dataUrl.split(',')[1] ?? ''
  const isImage = mime.startsWith('image/')
  const encWarn = file != null && file.size > WARN_FILE_BYTES

  const onDropKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openEncPicker()
    }
  }

  return (
    <div className='tw-card'>
      <ToolTabs<Mode>
        value={mode}
        onChange={setMode}
        items={[
          { id: 'encode', label: t('tool.fileB64.encodeTab') },
          { id: 'decode', label: t('tool.fileB64.decodeTab') },
        ]}
      />

      {mode === 'encode' ? (
        <div className='tw-fileb64'>
          <input
            ref={encInputRef}
            type='file'
            style={{ display: 'none' }}
            onChange={handleEncChange}
          />

          {!dataUrl ? (
            <div
              className={`tw-fileb64__drop${encDragging ? ' tw-fileb64__drop--drag' : ''}`}
              role='button'
              tabIndex={0}
              onClick={openEncPicker}
              onKeyDown={onDropKey}
              onDragOver={(e) => {
                e.preventDefault()
                setEncDragging(true)
              }}
              onDragEnter={handleEncDragEnter}
              onDragLeave={handleEncDragLeave}
              onDrop={handleEncDrop}
            >
              <Icon name='upload' size={32} className='tw-fileb64__drop-icon' />
              <strong>{t('tool.fileB64.dropText')}</strong>
              <p>{t('tool.fileB64.dropSubtitle')}</p>
            </div>
          ) : (
            <>
              <div className='tw-fileb64__file'>
                {isImage && (
                  <img
                    src={dataUrl}
                    alt={t('tool.fileB64.previewAlt')}
                    className='tw-fileb64__thumb'
                  />
                )}
                <div className='tw-fileb64__fileinfo'>
                  <span className='tw-fileb64__filename'>{file?.name ?? ''}</span>
                  <span className='tw-fileb64__meta'>
                    {file ? fmtSize(file.size) : ''} · {mime || t('tool.fileB64.unknownType')}
                  </span>
                </div>
                <button
                  type='button'
                  className='tk-btn tk-btn--sm'
                  onClick={() => {
                    setFile(null)
                    setDataUrl('')
                    setEncError(null)
                    openEncPicker()
                  }}
                >
                  {t('tool.fileB64.rechoose')}
                </button>
              </div>

              {encWarn && <StatusText kind='info'>{t('tool.fileB64.sizeWarning')}</StatusText>}

              <div className='tw-field'>
                <span className='tw-field__label'>
                  {t('tool.fileB64.base64Label')}
                  <CopyButton text={base64} disabled={!base64} className='tw-link' />
                </span>
                <AutoArea
                  className='tw-area tw-area--result'
                  value={base64}
                  readOnly
                  maxHeight={200}
                />
              </div>

              <div className='tw-field'>
                <span className='tw-field__label'>
                  {t('tool.fileB64.dataUrlLabel')}
                  <CopyButton text={dataUrl} disabled={!dataUrl} className='tw-link' />
                </span>
                <AutoArea
                  className='tw-area tw-area--result'
                  value={dataUrl}
                  readOnly
                  maxHeight={120}
                />
              </div>
            </>
          )}

          {encError && <StatusText kind='err'>{encError}</StatusText>}
        </div>
      ) : (
        <div className='tw-fileb64'>
          <label className='tw-field'>
            <span className='tw-field__label'>{t('tool.fileB64.decodeInputLabel')}</span>
            <AutoArea
              className='tw-area'
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('tool.fileB64.decodePlaceholder')}
              spellCheck={false}
            />
          </label>

          <div className='tw-actions'>
            <button
              type='button'
              className='tk-btn tk-btn--sm'
              onClick={() => void pasteClipboardText()}
            >
              {t('tool.fileB64.pasteFromClipboard')}
            </button>
          </div>

          {decInfo && (
            <div className='tw-fileb64__result'>
              {decInfo.mime.startsWith('image/') && (
                <img
                  src={decInfo.dataUrl}
                  alt={t('tool.fileB64.previewAlt')}
                  className='tw-fileb64__thumb'
                />
              )}
              <div className='tw-kv'>
                <div className='tw-kv__row'>
                  <span className='tw-kv__k'>MIME</span>
                  <span className='tw-kv__v'>{decInfo.mime}</span>
                </div>
                <div className='tw-kv__row'>
                  <span className='tw-kv__k'>{t('tool.fileB64.fileSize')}</span>
                  <span className='tw-kv__v'>{fmtSize(decInfo.sizeBytes)}</span>
                </div>
              </div>
              <div className='tw-actions'>
                <DownloadButton
                  mime={decInfo.mime}
                  dataUrl={decInfo.dataUrl}
                  label={t('tool.fileB64.download')}
                />
              </div>
            </div>
          )}

          {decError && <StatusText kind='err'>{decError}</StatusText>}
        </div>
      )}
    </div>
  )
}
