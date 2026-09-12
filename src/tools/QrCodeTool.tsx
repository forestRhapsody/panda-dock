import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import Icon from '@/ui/Icon'
import TkSelect from '@/ui/TkSelect'
import Tooltip from '@/ui/Tooltip'
import { copyText } from '@/utils/clipboard'
import { useToolDraft } from '@/utils/draft'
import { getCurrentPageUrl } from '@/utils/pageUrl'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'
import { decodeQrCodeFromBlob, generateQrCodeBlob, generateQrCodeResult } from './qrcode'
import type { QrErrorCorrectionLevel, QrLogoShape } from './qrcode'
import QrLogoCropModal from './QrLogoCropModal'
import { StatusText } from './StatusText'
import ToolTabs from './ToolTabs'

type QrMode = 'generate' | 'decode'

const PRESET_FG_COLORS = [
  { labelKey: 'tool.qrcode.colorBlack', color: '#000000' },
  { labelKey: 'tool.qrcode.colorNavy', color: '#1d4ed8' },
  { labelKey: 'tool.qrcode.colorSlate', color: '#1e293b' },
  { labelKey: 'tool.qrcode.colorGreen', color: '#047857' },
  { labelKey: 'tool.qrcode.colorPurple', color: '#6d28d9' },
  { labelKey: 'tool.qrcode.colorRed', color: '#b91c1c' },
]

const PRESET_BG_COLORS = [
  { labelKey: 'tool.qrcode.colorWhite', color: '#ffffff' },
  { labelKey: 'tool.qrcode.colorWarmWhite', color: '#f8fafc' },
  { labelKey: 'tool.qrcode.colorCream', color: '#fefce8' },
  { labelKey: 'tool.qrcode.colorLightGray', color: '#f1f5f9' },
  { labelKey: 'tool.qrcode.colorLightGreen', color: '#ecfdf5' },
]

const MARGIN_OPTIONS = [
  { labelKey: 'tool.qrcode.marginNone', value: 0 },
  { labelKey: 'tool.qrcode.marginTight', value: 1 },
  { labelKey: 'tool.qrcode.marginStandard', value: 2 },
  { labelKey: 'tool.qrcode.marginLoose', value: 4 },
]

const RESOLUTION_OPTIONS = [
  { labelKey: 'tool.qrcode.sizeSm', value: 800 },
  { labelKey: 'tool.qrcode.sizeMd', value: 1200 },
  { labelKey: 'tool.qrcode.sizeLg', value: 1600 },
  { labelKey: 'tool.qrcode.sizeXl', value: 2400 },
]

const LOGO_SIZE_OPTIONS = [
  { labelKey: 'tool.qrcode.logoSizeSm', value: 0.18 },
  { labelKey: 'tool.qrcode.logoSizeMd', value: 0.22 },
  { labelKey: 'tool.qrcode.logoSizeLg', value: 0.26 },
]

const FONT_SIZE_OPTIONS = [
  { labelKey: 'tool.qrcode.fontSizeSm', value: 14 },
  { labelKey: 'tool.qrcode.fontSizeMd', value: 18 },
  { labelKey: 'tool.qrcode.fontSizeLg', value: 22 },
  { labelKey: 'tool.qrcode.fontSizeXl', value: 26 },
]

export default function QrCodeTool() {
  const { t } = useTranslation()
  // 生成 / 解析 tab 与 Base64 / URL / Hash 一致：跨挂载保留上次选择（草稿不做校验，脏值回落生成模式）
  const [modeDraft, setMode] = useToolDraft<string>('qrcode.tab', 'generate')
  const mode: QrMode = modeDraft === 'decode' ? 'decode' : 'generate'

  // —— 生成模式状态 ——
  const [inputText, setInputText, clearInputText] = useToolDraft<string>('qrcode.input', '')
  const [ecLevel, setEcLevel] = useState<QrErrorCorrectionLevel>('M')
  const [margin, setMargin] = useState(2)
  const [resolution, setResolution] = useState(1200)
  const [labelFontSize, setLabelFontSize] = useState(18)
  const [fgColor, setFgColor] = useState('#000000')
  const [bgColor, setBgColor] = useState('#ffffff')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoShape, setLogoShape] = useState<QrLogoShape>('rounded')
  const [logoSizeRatio, setLogoSizeRatio] = useState<number>(0.22)
  const [cropSourceUrl, setCropSourceUrl] = useState<string | null>(null)
  const [showCropModal, setShowCropModal] = useState(false)
  const [label, setLabel] = useState('')
  const [showCustomize, setShowCustomize] = useState(false)

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrDimensions, setQrDimensions] = useState<{ width: number; height: number } | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [copiedImage, setCopiedImage] = useState(false)
  const copyImageTimer = useRef<number | undefined>(undefined)
  const logoInputRef = useRef<HTMLInputElement>(null)
  // 跟踪当前 logo / 裁剪源图 / 解析预览的 object URL，替换或卸载时及时 revoke，避免 Blob 内存泄漏
  const logoUrlRef = useRef<string | null>(null)
  const cropSourceUrlRef = useRef<string | null>(null)
  const imagePreviewUrlRef = useRef<string | null>(null)
  // 记住「应用 Logo 强制纠错等级 H 之前」的用户等级，移除 Logo 时回落。
  // 只在尚未记录时记录一次：若每次都覆盖，重新上传 Logo（等级仍被锁定为 H）会把
  // 记录改写成 H，移除后就再也回不到用户原本的等级了。
  const ecLevelBeforeLogoRef = useRef<QrErrorCorrectionLevel | null>(null)

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
      if (cropSourceUrlRef.current) URL.revokeObjectURL(cropSourceUrlRef.current)
      if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current)
    },
    [],
  )

  // 防抖实时生成超清零锯齿二维码（支持边距、清晰度、字号、配色、Logo、标签）
  useEffect(() => {
    const text = inputText.trim()
    if (!text) {
      setQrDataUrl(null)
      setQrDimensions(null)
      setGenerateError(null)
      return
    }

    let alive = true
    setGenerating(true)
    setGenerateError(null)
    const timer = setTimeout(() => {
      generateQrCodeResult(text, {
        errorCorrectionLevel: ecLevel,
        margin,
        targetWidth: resolution,
        foregroundColor: fgColor,
        backgroundColor: bgColor,
        logoUrl,
        logoShape,
        logoSizeRatio,
        label,
        labelFontSize,
      })
        .then((res) => {
          if (alive) {
            setQrDataUrl(res.dataUrl)
            setQrDimensions({ width: res.width, height: res.height })
            setGenerating(false)
            setGenerateError(null)
          }
        })
        .catch(() => {
          if (alive) {
            setQrDataUrl(null)
            setQrDimensions(null)
            setGenerating(false)
            setGenerateError(t('tool.qrcode.generateFailed'))
          }
        })
    }, 80)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [
    inputText,
    ecLevel,
    margin,
    resolution,
    fgColor,
    bgColor,
    logoUrl,
    logoShape,
    logoSizeRatio,
    label,
    labelFontSize,
    t,
  ])

  // 生成：填入当前网页 URL
  async function fillCurrentPageUrl() {
    const url = await getCurrentPageUrl()
    if (url) {
      setInputText(url)
    }
  }

  // 生成：选择并上传 Logo（自动唤起裁剪弹窗）
  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      if (cropSourceUrlRef.current) URL.revokeObjectURL(cropSourceUrlRef.current)
      const url = URL.createObjectURL(file)
      cropSourceUrlRef.current = url
      setCropSourceUrl(url)
      setShowCropModal(true)
    }
    e.target.value = ''
  }

  // 生成：重新裁剪已有 Logo
  function handleRecrop() {
    if (cropSourceUrl) {
      setShowCropModal(true)
    } else if (logoUrl) {
      setCropSourceUrl(logoUrl)
      setShowCropModal(true)
    }
  }

  // 生成：确认裁剪完成
  // 刻意不清理 cropSourceUrl：保留同一个 objectURL，用户点「重新裁剪」时可直接复用，
  // 无需重新读文件。它会在下次上传 / 移除 Logo / 组件卸载时被 revoke，属有界驻留。
  function handleCropConfirm(croppedDataUrl: string, selectedShape: QrLogoShape) {
    if (logoUrlRef.current) URL.revokeObjectURL(logoUrlRef.current)
    logoUrlRef.current = null
    setLogoUrl(croppedDataUrl)
    setLogoShape(selectedShape)
    if (ecLevelBeforeLogoRef.current === null) ecLevelBeforeLogoRef.current = ecLevel
    setEcLevel('H')
    setShowCropModal(false)
  }

  // 生成：取消裁剪
  function handleCropCancel() {
    setShowCropModal(false)
    if (!logoUrl) {
      if (cropSourceUrlRef.current) {
        URL.revokeObjectURL(cropSourceUrlRef.current)
        cropSourceUrlRef.current = null
      }
      setCropSourceUrl(null)
    }
  }

  function removeLogo() {
    if (logoUrlRef.current) {
      URL.revokeObjectURL(logoUrlRef.current)
      logoUrlRef.current = null
    }
    if (cropSourceUrlRef.current) {
      URL.revokeObjectURL(cropSourceUrlRef.current)
      cropSourceUrlRef.current = null
    }
    setCropSourceUrl(null)
    setLogoUrl(null)
    // 回落到应用 Logo 前的用户等级（从未记录过则视为默认 M），并清空记录，
    // 让下次上传 Logo 重新记住当时的等级，而不是一直沿用陈旧值。
    setEcLevel(ecLevelBeforeLogoRef.current ?? 'M')
    ecLevelBeforeLogoRef.current = null
  }

  // 生成：下载图片
  async function downloadQrImage() {
    if (!inputText.trim()) return
    try {
      const blob = await generateQrCodeBlob(inputText.trim(), {
        errorCorrectionLevel: ecLevel,
        margin,
        targetWidth: resolution,
        foregroundColor: fgColor,
        backgroundColor: bgColor,
        logoUrl,
        logoShape,
        logoSizeRatio,
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
        targetWidth: resolution,
        foregroundColor: fgColor,
        backgroundColor: bgColor,
        logoUrl,
        logoShape,
        logoSizeRatio,
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

  // 生成：在新标签页中查看高清原图
  function openOriginalImage() {
    if (!qrDataUrl) return
    const win = window.open()
    if (win) {
      win.document.write(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${t('tool.qrcode.openOriginal')}</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#18181b;}img{max-width:92vw;max-height:92vh;object-fit:contain;box-shadow:0 12px 36px rgba(0,0,0,0.5);image-rendering:-webkit-optimize-contrast;}</style></head><body><img src="${qrDataUrl}" alt="QR" /></body></html>`,
      )
      win.document.close()
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
            <button type='button' className='tk-btn' onClick={() => void fillCurrentPageUrl()}>
              <Icon name='window' size={13} />
              {t('tool.qrcode.fillCurrentUrl')}
            </button>
            {inputText && (
              <button type='button' className='tk-btn' onClick={clearInputText}>
                <Icon name='close' size={13} />
                {t('common.clear')}
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

              {/* 清晰度 */}
              <div className='tw-qr__opt-group'>
                <label className='tw-qr__opt-label' htmlFor='tw-qr-resolution'>
                  {t('tool.qrcode.resolution')}:
                </label>
                <TkSelect
                  id='tw-qr-resolution'
                  value={resolution}
                  onChange={(e) => setResolution(Number(e.target.value))}
                >
                  {RESOLUTION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </option>
                  ))}
                </TkSelect>
              </div>
            </div>

            <button
              type='button'
              className={`tk-btn tk-btn--sm${showCustomize ? ' tk-btn--primary' : ''}`}
              onClick={() => setShowCustomize((prev) => !prev)}
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
                        <Tooltip key={p.color} content={t(p.labelKey)}>
                          <button
                            type='button'
                            className={`tw-qr__swatch${fgColor === p.color ? ' tw-qr__swatch--active' : ''}`}
                            style={{ backgroundColor: p.color }}
                            aria-label={t(p.labelKey)}
                            onClick={() => setFgColor(p.color)}
                          />
                        </Tooltip>
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
                        <Tooltip key={p.color} content={t(p.labelKey)}>
                          <button
                            type='button'
                            className={`tw-qr__swatch${bgColor === p.color ? ' tw-qr__swatch--active' : ''}`}
                            style={{ backgroundColor: p.color }}
                            aria-label={t(p.labelKey)}
                            onClick={() => setBgColor(p.color)}
                          />
                        </Tooltip>
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
                      <Tooltip content={t('common.cancel')}>
                        <button
                          type='button'
                          className='tk-icon-btn'
                          onClick={() => setLabel('')}
                          aria-label={t('common.cancel')}
                        >
                          <Icon name='close' size={12} />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>

                <div className='tw-qr__custom-col' style={{ flex: '0 0 auto' }}>
                  <span className='tw-qr__custom-label'>{t('tool.qrcode.labelFontSize')}:</span>
                  <TkSelect
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

              {/* Logo 上传与样式定制 */}
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
                      <>
                        <div className='tw-qr__logo-badge'>
                          <img
                            src={logoUrl}
                            alt='Logo'
                            className={`tw-qr__logo-thumb tw-qr__logo-thumb--${logoShape}`}
                          />
                          <button
                            type='button'
                            className='tk-btn tk-btn--sm'
                            onClick={handleRecrop}
                          >
                            <Icon name='code' size={12} />
                            {t('tool.qrcode.recropLogo')}
                          </button>
                          <button
                            type='button'
                            className='tk-btn tk-btn--sm'
                            onClick={() => logoInputRef.current?.click()}
                          >
                            <Icon name='upload' size={12} />
                            {t('tool.qrcode.uploadLogo')}
                          </button>
                          <button type='button' className='tk-btn tk-btn--sm' onClick={removeLogo}>
                            <Icon name='close' size={12} />
                            {t('tool.qrcode.removeLogo')}
                          </button>
                        </div>

                        {/* Logo 形状与大小调节 */}
                        <div className='tw-qr__logo-options'>
                          <div className='tw-qr__opt-group'>
                            <label className='tw-qr__opt-label' htmlFor='tw-qr-logo-shape'>
                              {t('tool.qrcode.logoShape')}:
                            </label>
                            <TkSelect
                              id='tw-qr-logo-shape'
                              value={logoShape}
                              onChange={(e) => setLogoShape(e.target.value as QrLogoShape)}
                            >
                              <option value='rounded'>{t('tool.qrcode.logoShapeRounded')}</option>
                              <option value='circle'>{t('tool.qrcode.logoShapeCircle')}</option>
                              <option value='square'>{t('tool.qrcode.logoShapeSquare')}</option>
                            </TkSelect>
                          </div>

                          <div className='tw-qr__opt-group'>
                            <label className='tw-qr__opt-label' htmlFor='tw-qr-logo-size'>
                              {t('tool.qrcode.logoSize')}:
                            </label>
                            <TkSelect
                              id='tw-qr-logo-size'
                              value={logoSizeRatio}
                              onChange={(e) => setLogoSizeRatio(Number(e.target.value))}
                            >
                              {LOGO_SIZE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {t(o.labelKey)}
                                </option>
                              ))}
                            </TkSelect>
                          </div>
                        </div>
                      </>
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
                  >
                    <Icon name={copiedImage ? 'check' : 'copy'} size={13} />
                    {copiedImage ? t('tool.qrcode.imageCopied') : t('tool.qrcode.copyImage')}
                  </button>
                  <button
                    type='button'
                    className='tk-btn tk-btn--sm'
                    onClick={() => void downloadQrImage()}
                  >
                    <Icon name='download' size={13} />
                    {t('tool.qrcode.downloadPng')}
                  </button>
                  <button type='button' className='tk-btn tk-btn--sm' onClick={openOriginalImage}>
                    <Icon name='external-link' size={13} />
                    {t('tool.qrcode.openOriginal')}
                  </button>
                </div>
                {qrDimensions && (
                  <div className='tw-qr__meta'>
                    <span className='tw-qr__dimension-badge'>
                      {qrDimensions.width} × {qrDimensions.height} px
                    </span>
                  </div>
                )}
              </div>
            ) : generateError ? (
              <div className='tw-qr__placeholder'>
                <Icon name='alert' size={32} className='tw-qr__ph-icon tw-qr__ph-icon--error' />
                <StatusText kind='err'>{generateError}</StatusText>
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

          <div className='tw-actions'>
            <button type='button' className='tk-btn' onClick={() => fileInputRef.current?.click()}>
              <Icon name='upload' size={14} />
              {t('tool.qrcode.chooseFile')}
            </button>
            <button type='button' className='tk-btn' onClick={() => void readClipboardImage()}>
              <Icon name='copy' size={14} />
              {t('tool.qrcode.pasteClipboard')}
            </button>
            {(decodedResult || decodeError || imagePreviewUrl) && (
              <button type='button' className='tk-btn' onClick={clearDecode}>
                <Icon name='close' size={13} />
                {t('common.cancel')}
              </button>
            )}
          </div>

          {decodeLoading && <StatusText kind='info'>{t('tool.qrcode.decoding')}</StatusText>}

          {decodeError && <StatusText kind='err'>{decodeError}</StatusText>}

          {decodedResult && (
            <div className='tw-field'>
              <span className='tw-field__label'>
                <span>{t('tool.qrcode.decodedResult')}</span>
                <span className='tw-field__actions'>
                  {isDecodedUrl && (
                    <a href={decodedResult} target='_blank' rel='noreferrer' className='tw-link'>
                      <Icon name='external-link' size={13} />
                      {t('tool.qrcode.openUrl')}
                    </a>
                  )}
                  <CopyButton text={decodedResult} className='tw-link' />
                </span>
              </span>
              <AutoArea
                className='tw-area tw-area--result'
                value={decodedResult}
                readOnly
                maxHeight={240}
              />
            </div>
          )}
        </div>
      )}

      {/* Logo 裁剪弹窗 */}
      {showCropModal && cropSourceUrl && (
        <QrLogoCropModal
          imageSrc={cropSourceUrl}
          initialShape={logoShape}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  )
}
