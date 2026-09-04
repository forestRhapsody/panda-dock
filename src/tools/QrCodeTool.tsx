import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import Icon from '@/ui/Icon'
import TkSelect from '@/ui/TkSelect'
import { copyText } from '@/utils/clipboard'
import { getCurrentPageUrl } from '@/utils/pageUrl'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'
import { decodeQrCodeFromBlob, generateQrCodeBlob, generateQrCodeDataUrl } from './qrcode'
import type { QrErrorCorrectionLevel } from './qrcode'
import { StatusText } from './StatusText'
import ToolTabs from './ToolTabs'

type QrMode = 'generate' | 'decode'

const PRESET_FG_COLORS = [
  { label: '黑', color: '#000000' },
  { label: '深蓝', color: '#1d4ed8' },
  { label: '深灰', color: '#1e293b' },
  { label: '绿', color: '#047857' },
  { label: '紫', color: '#6d28d9' },
  { label: '红', color: '#b91c1c' },
]

const PRESET_BG_COLORS = [
  { label: '白', color: '#ffffff' },
  { label: '暖白', color: '#f8fafc' },
  { label: '米白', color: '#fefce8' },
  { label: '浅灰', color: '#f1f5f9' },
  { label: '浅绿', color: '#ecfdf5' },
]

const MARGIN_OPTIONS = [
  { labelKey: 'tool.qrcode.marginNone', value: 0 },
  { labelKey: 'tool.qrcode.marginTight', value: 1 },
  { labelKey: 'tool.qrcode.marginStandard', value: 2 },
  { labelKey: 'tool.qrcode.marginLoose', value: 4 },
]

const FONT_SIZE_OPTIONS = [
  { labelKey: 'tool.qrcode.fontSizeSm', value: 14 },
  { labelKey: 'tool.qrcode.fontSizeMd', value: 18 },
  { labelKey: 'tool.qrcode.fontSizeLg', value: 22 },
  { labelKey: 'tool.qrcode.fontSizeXl', value: 26 },
]

export default function QrCodeTool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<QrMode>('generate')

  // —— 生成模式状态 ——
  const [inputText, setInputText] = useState('')
  const [ecLevel, setEcLevel] = useState<QrErrorCorrectionLevel>('M')
  const [margin, setMargin] = useState(2)
  const [labelFontSize, setLabelFontSize] = useState(18)
  const [fgColor, setFgColor] = useState('#000000')
  const [bgColor, setBgColor] = useState('#ffffff')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [showCustomize, setShowCustomize] = useState(false)

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [copiedImage, setCopiedImage] = useState(false)
  const copyImageTimer = useRef<number | undefined>(undefined)
  const logoInputRef = useRef<HTMLInputElement>(null)
  // 跟踪当前 logo / 解析预览的 object URL，替换或卸载时及时 revoke，避免 Blob 内存泄漏
  const logoUrlRef = useRef<string | null>(null)
  const imagePreviewUrlRef = useRef<string | null>(null)

  // —— 解析模式状态 ——
  const [decodeLoading, setDecodeLoading] = useState(false)
  const [decodedResult, setDecodedResult] = useState<string | null>(null)
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(
    () => () => {
      window.clearTimeout(copyImageTimer.current)
      if (logoUrlRef.current) URL.revokeObjectURL(logoUrlRef.current)
      if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current)
    },
    [],
  )

  // 防抖实时生成超清零锯齿二维码（支持边距、字号、配色、Logo、标签）
  useEffect(() => {
    const text = inputText.trim()
    if (!text) {
      setQrDataUrl(null)
      return
    }

    let alive = true
    setGenerating(true)
    const timer = setTimeout(() => {
      generateQrCodeDataUrl(text, {
        errorCorrectionLevel: ecLevel,
        margin,
        targetWidth: 800,
        foregroundColor: fgColor,
        backgroundColor: bgColor,
        logoUrl,
        label,
        labelFontSize,
      })
        .then((url) => {
          if (alive) {
            setQrDataUrl(url)
            setGenerating(false)
          }
        })
        .catch(() => {
          if (alive) {
            setQrDataUrl(null)
            setGenerating(false)
          }
        })
    }, 80)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [inputText, ecLevel, margin, labelFontSize, fgColor, bgColor, logoUrl, label])

  // 生成：填入当前网页 URL
  async function fillCurrentPageUrl() {
    const url = await getCurrentPageUrl()
    if (url) {
      setInputText(url)
    }
  }

  // 生成：上传 Logo
  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      // 替换 Logo 时先 revoke 旧 object URL，避免连续上传泄漏
      if (logoUrlRef.current) URL.revokeObjectURL(logoUrlRef.current)
      const url = URL.createObjectURL(file)
      logoUrlRef.current = url
      setLogoUrl(url)
      setEcLevel('H')
    }
    e.target.value = ''
  }

  function removeLogo() {
    if (logoUrlRef.current) {
      URL.revokeObjectURL(logoUrlRef.current)
      logoUrlRef.current = null
    }
    setLogoUrl(null)
  }

  // 生成：下载图片
  async function downloadQrImage() {
    if (!inputText.trim()) return
    try {
      const blob = await generateQrCodeBlob(inputText.trim(), {
        errorCorrectionLevel: ecLevel,
        margin,
        targetWidth: 800,
        foregroundColor: fgColor,
        backgroundColor: bgColor,
        logoUrl,
        label,
        labelFontSize,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `qrcode-${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      if (qrDataUrl) {
        const a = document.createElement('a')
        a.href = qrDataUrl
        a.download = `qrcode-${Date.now()}.png`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
    }
  }

  // 生成：复制图片到剪贴板
  async function copyQrImage() {
    if (!inputText.trim()) return
    try {
      const blob = await generateQrCodeBlob(inputText.trim(), {
        errorCorrectionLevel: ecLevel,
        margin,
        targetWidth: 800,
        foregroundColor: fgColor,
        backgroundColor: bgColor,
        logoUrl,
        label,
        labelFontSize,
      })
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setCopiedImage(true)
        window.clearTimeout(copyImageTimer.current)
        copyImageTimer.current = window.setTimeout(() => setCopiedImage(false), 2000)
      } else {
        await copyText(qrDataUrl ?? '')
      }
    } catch {
      if (qrDataUrl) await copyText(qrDataUrl)
    }
  }

  // 解析：处理图像 Blob
  const processImageBlob = useCallback(
    async (blob: Blob) => {
      setDecodeLoading(true)
      setDecodeError(null)
      setDecodedResult(null)

      // 替换预览图时先 revoke 旧 object URL，避免连续解析泄漏
      if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current)
      const preview = URL.createObjectURL(blob)
      imagePreviewUrlRef.current = preview
      setImagePreviewUrl(preview)

      try {
        const text = await decodeQrCodeFromBlob(blob)
        setDecodedResult(text)
      } catch {
        setDecodeError(t('tool.qrcode.decodeFailed'))
      } finally {
        setDecodeLoading(false)
      }
    },
    [t],
  )

  // 解析：文件选取
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      void processImageBlob(file)
    }
    e.target.value = ''
  }

  // 解析：拖拽放开
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) {
      void processImageBlob(file)
    }
  }

  // 解析：监听粘贴图片
  useEffect(() => {
    if (mode !== 'decode') return

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            void processImageBlob(file)
            return
          }
        }
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [mode, processImageBlob])

  // 解析：读取剪贴板图片按钮
  async function readClipboardImage() {
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read()
        for (const item of items) {
          const imageType = item.types.find((t) => t.startsWith('image/'))
          if (imageType) {
            const blob = await item.getType(imageType)
            void processImageBlob(blob)
            return
          }
        }
      }
      setDecodeError(t('tool.qrcode.noClipboardImage'))
    } catch {
      setDecodeError(t('tool.qrcode.clipboardAccessDenied'))
    }
  }

  function clearDecode() {
    setDecodedResult(null)
    setDecodeError(null)
    if (imagePreviewUrlRef.current) {
      URL.revokeObjectURL(imagePreviewUrlRef.current)
      imagePreviewUrlRef.current = null
      setImagePreviewUrl(null)
    }
  }

  const isDecodedUrl =
    decodedResult != null &&
    (decodedResult.startsWith('http://') || decodedResult.startsWith('https://'))

  return (
    <div className='tw-card'>
      {/* 顶部生成 / 解析 Tab 切换：严格对齐其它能力（Base64 / 本地存储）的标准 tw-tabs 与 tw-tabs__btn--on */}
      <ToolTabs<QrMode>
        value={mode}
        onChange={setMode}
        items={[
          { id: 'generate', label: t('tool.qrcode.generateTab') },
          { id: 'decode', label: t('tool.qrcode.decodeTab') },
        ]}
      />

      {mode === 'generate' ? (
        /* —— 生成视图 —— */
        <div className='tw-qr__body'>
          <label className='tw-field'>
            <span className='tw-field__label'>{t('tool.qrcode.inputLabel')}</span>
            <AutoArea
              className='tw-area'
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={t('tool.qrcode.inputPlaceholder')}
              maxHeight={200}
            />
          </label>
          <div className='tw-actions'>
            <button
              type='button'
              className='tk-btn'
              onClick={() => void fillCurrentPageUrl()}
              title={t('tool.qrcode.fillCurrentUrl')}
            >
              <Icon name='window' size={13} />
              {t('tool.qrcode.fillCurrentUrl')}
            </button>
            {inputText && (
              <button type='button' className='tk-btn' onClick={() => setInputText('')}>
                <Icon name='close' size={13} />
                {t('tool.json.clear')}
              </button>
            )}
          </div>

          {/* —— 常用参数控制栏：边距调节、纠错等级与美化折叠按钮 —— */}
          <div className='tw-qr__toolbar'>
            <div className='tw-qr__quick-opts'>
              {/* 边距调节 */}
              <div className='tw-qr__opt-group'>
                <label className='tw-qr__opt-label' htmlFor='tw-qr-margin'>
                  {t('tool.qrcode.margin')}:
                </label>
                <TkSelect
                  id='tw-qr-margin'
                  variant='sm'
                  value={margin}
                  onChange={(e) => setMargin(Number(e.target.value))}
                >
                  {MARGIN_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </option>
                  ))}
                </TkSelect>
              </div>

              {/* 纠错级别 */}
              <div className='tw-qr__opt-group'>
                <label className='tw-qr__opt-label' htmlFor='tw-qr-ec'>
                  {t('tool.qrcode.errorCorrection')}:
                </label>
                <TkSelect
                  id='tw-qr-ec'
                  variant='sm'
                  value={ecLevel}
                  disabled={Boolean(logoUrl)}
                  onChange={(e) => setEcLevel(e.target.value as QrErrorCorrectionLevel)}
                  title={logoUrl ? t('tool.qrcode.ecLockedForLogo') : undefined}
                >
                  <option value='L'>L (7%)</option>
                  <option value='M'>M (15%)</option>
                  <option value='Q'>Q (25%)</option>
                  <option value='H'>H (30%)</option>
                </TkSelect>
              </div>
            </div>

            <button
              type='button'
              className={`tk-btn tk-btn--sm${showCustomize ? ' tk-btn--primary' : ''}`}
              onClick={() => setShowCustomize((prev) => !prev)}
              title={t('tool.qrcode.customizeToggle')}
            >
              <Icon name='settings' size={13} />
              {t('tool.qrcode.customizeToggle')}
            </button>
          </div>

          {/* —— 美化与标签定制面板 —— */}
          {showCustomize && (
            <div className='tw-qr__custom-panel'>
              {/* 配色设置 */}
              <div className='tw-qr__custom-row'>
                <div className='tw-qr__custom-col'>
                  <span className='tw-qr__custom-label'>{t('tool.qrcode.fgColor')}:</span>
                  <div className='tw-qr__color-picker-wrap'>
                    <input
                      type='color'
                      value={fgColor}
                      onChange={(e) => setFgColor(e.target.value)}
                      className='tw-qr__color-input'
                    />
                    <div className='tw-qr__color-swatches'>
                      {PRESET_FG_COLORS.map((p) => (
                        <button
                          key={p.color}
                          type='button'
                          className={`tw-qr__swatch${fgColor === p.color ? ' tw-qr__swatch--active' : ''}`}
                          style={{ backgroundColor: p.color }}
                          title={p.label}
                          onClick={() => setFgColor(p.color)}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className='tw-qr__custom-col'>
                  <span className='tw-qr__custom-label'>{t('tool.qrcode.bgColor')}:</span>
                  <div className='tw-qr__color-picker-wrap'>
                    <input
                      type='color'
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      className='tw-qr__color-input'
                    />
                    <div className='tw-qr__color-swatches'>
                      {PRESET_BG_COLORS.map((p) => (
                        <button
                          key={p.color}
                          type='button'
                          className={`tw-qr__swatch${bgColor === p.color ? ' tw-qr__swatch--active' : ''}`}
                          style={{ backgroundColor: p.color }}
                          title={p.label}
                          onClick={() => setBgColor(p.color)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* 底部标签文字与字号调节 */}
              <div className='tw-qr__custom-row'>
                <div className='tw-qr__custom-col' style={{ flex: '1 1 60%' }}>
                  <span className='tw-qr__custom-label'>{t('tool.qrcode.bottomLabel')}:</span>
                  <div className='tw-qr__label-wrap'>
                    <input
                      type='text'
                      className='tw-input tw-qr__label-input'
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder={t('tool.qrcode.labelPlaceholder')}
                      maxLength={32}
                    />
                    {label && (
                      <button
                        type='button'
                        className='tk-icon-btn'
                        onClick={() => setLabel('')}
                        title={t('common.cancel')}
                      >
                        <Icon name='close' size={12} />
                      </button>
                    )}
                  </div>
                </div>

                <div className='tw-qr__custom-col' style={{ flex: '0 0 auto' }}>
                  <span className='tw-qr__custom-label'>{t('tool.qrcode.labelFontSize')}:</span>
                  <TkSelect
                    variant='sm'
                    value={labelFontSize}
                    onChange={(e) => setLabelFontSize(Number(e.target.value))}
                  >
                    {FONT_SIZE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(o.labelKey)}
                      </option>
                    ))}
                  </TkSelect>
                </div>
              </div>

              {/* Logo 上传 */}
              <div className='tw-qr__custom-row'>
                <div className='tw-qr__custom-col'>
                  <span className='tw-qr__custom-label'>{t('tool.qrcode.centerLogo')}:</span>
                  <input
                    type='file'
                    ref={logoInputRef}
                    accept='image/*'
                    style={{ display: 'none' }}
                    onChange={handleLogoUpload}
                  />
                  <div className='tw-qr__logo-actions'>
                    {logoUrl ? (
                      <div className='tw-qr__logo-badge'>
                        <img src={logoUrl} alt='Logo' className='tw-qr__logo-thumb' />
                        <button
                          type='button'
                          className='tk-btn tk-btn--sm'
                          onClick={removeLogo}
                          title={t('tool.qrcode.removeLogo')}
                        >
                          <Icon name='close' size={12} />
                          {t('tool.qrcode.removeLogo')}
                        </button>
                      </div>
                    ) : (
                      <button
                        type='button'
                        className='tk-btn tk-btn--sm'
                        onClick={() => logoInputRef.current?.click()}
                      >
                        <Icon name='upload' size={13} />
                        {t('tool.qrcode.uploadLogo')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* —— 超清预览卡片 —— */}
          <div className='tw-qr__preview-box'>
            {qrDataUrl ? (
              <div className='tw-qr__result-card'>
                <div
                  className='tw-qr__img-wrapper'
                  style={{
                    backgroundColor: bgColor,
                    // 所见即所得：padding 跟随边距档位，margin=0 时无白边，与导出 PNG 完全一致
                    padding: margin === 0 ? 0 : margin === 1 ? 4 : margin === 2 ? 10 : 18,
                  }}
                >
                  <img src={qrDataUrl} alt={t('tool.qrcode.previewAlt')} className='tw-qr__img' />
                  {generating && <div className='tw-qr__img-loading' />}
                </div>
                <div className='tw-qr__btn-group'>
                  <button
                    type='button'
                    className='tk-btn tk-btn--sm'
                    onClick={() => void copyQrImage()}
                    title={t('tool.qrcode.copyImage')}
                  >
                    <Icon name={copiedImage ? 'check' : 'copy'} size={13} />
                    {copiedImage ? t('tool.qrcode.imageCopied') : t('tool.qrcode.copyImage')}
                  </button>
                  <button
                    type='button'
                    className='tk-btn tk-btn--sm'
                    onClick={() => void downloadQrImage()}
                    title={t('tool.qrcode.downloadPng')}
                  >
                    <Icon name='download' size={13} />
                    {t('tool.qrcode.downloadPng')}
                  </button>
                </div>
              </div>
            ) : (
              <div className='tw-qr__placeholder'>
                <Icon name='qr-code' size={36} className='tw-qr__ph-icon' />
                <p>{t('tool.qrcode.emptyPrompt')}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* —— 解析视图 —— */
        <div className='tw-qr__body'>
          <input
            type='file'
            ref={fileInputRef}
            accept='image/*'
            className='tw-qr__file-input'
            onChange={handleFileChange}
          />

          <div
            className={`tw-qr__drop-zone${isDragging ? ' tw-qr__drop-zone--drag' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role='button'
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                fileInputRef.current?.click()
              }
            }}
          >
            {imagePreviewUrl ? (
              <div className='tw-qr__drop-preview'>
                <img src={imagePreviewUrl} alt='Upload preview' className='tw-qr__thumb' />
                <p className='tw-qr__reupload-hint'>{t('tool.qrcode.clickToReupload')}</p>
              </div>
            ) : (
              <div className='tw-qr__drop-prompt'>
                <Icon name='upload' size={32} className='tw-qr__drop-icon' />
                <strong>{t('tool.qrcode.dropTitle')}</strong>
                <p>{t('tool.qrcode.dropSubtitle')}</p>
              </div>
            )}
          </div>

          <div className='tw-qr__decode-actions'>
            <button
              type='button'
              className='tk-btn tk-btn--sm'
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name='upload' size={13} />
              {t('tool.qrcode.chooseFile')}
            </button>
            <button
              type='button'
              className='tk-btn tk-btn--sm'
              onClick={() => void readClipboardImage()}
            >
              <Icon name='copy' size={13} />
              {t('tool.qrcode.pasteClipboard')}
            </button>
            {(decodedResult || decodeError || imagePreviewUrl) && (
              <button type='button' className='tk-btn tk-btn--sm' onClick={clearDecode}>
                <Icon name='close' size={12} />
                {t('common.cancel')}
              </button>
            )}
          </div>

          {decodeLoading && <div className='tw-qr__loading-msg'>{t('tool.qrcode.decoding')}</div>}

          {decodeError && <StatusText kind='err'>{decodeError}</StatusText>}

          {decodedResult && (
            <div className='tw-qr__result-box'>
              <div className='tw-qr__result-head'>
                <span className='tw-qr__result-title'>{t('tool.qrcode.decodedResult')}:</span>
                <div className='tw-qr__result-actions'>
                  {isDecodedUrl && (
                    <a
                      href={decodedResult}
                      target='_blank'
                      rel='noreferrer'
                      className='tk-btn tk-btn--sm'
                      title={t('tool.qrcode.openUrl')}
                    >
                      <Icon name='external-link' size={13} />
                      {t('tool.qrcode.openUrl')}
                    </a>
                  )}
                  <CopyButton text={decodedResult} className='tk-btn tk-btn--sm' />
                </div>
              </div>
              <div className='tw-qr__result-content'>{decodedResult}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
