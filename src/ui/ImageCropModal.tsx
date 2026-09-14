import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import Icon from '@/ui/Icon'
import PdSelect from '@/ui/PdSelect'
import Tooltip from '@/ui/Tooltip'
import { clampCropOffset, computeCropParams, exportCroppedCanvas } from '@/utils/imageCrop'

export type ImageCropShape = 'rounded' | 'circle' | 'square'

export interface ImageCropModalLabels {
  title?: string
  hint?: string
  shapeLabel?: string
  shapeRounded?: string
  shapeCircle?: string
  shapeSquare?: string
  reset?: string
  zoom?: string
  confirm?: string
  cancel?: string
  loadError?: string
  exportError?: string
}

export interface ImageCropModalProps {
  /** 待裁剪的原图 URL（ObjectURL 或 DataURL） */
  imageSrc: string
  /** 初始形状或当前形状 */
  shape?: ImageCropShape
  /** 是否允许在弹窗中选择/切换形状（默认为 false） */
  allowShapeSelect?: boolean
  /** 确认裁剪回调，输出裁剪后的 DataURL 及所选形状 */
  onConfirm: (croppedDataUrl: string, selectedShape: ImageCropShape) => void
  /** 取消关闭回调 */
  onCancel: () => void
  /** 自定义文案（可选，若未指定则使用默认文案） */
  labels?: ImageCropModalLabels
  /** 导出分辨率（默认为 600，autoCompress 开启时无效） */
  exportSize?: number
  /** 是否启用自动降阶压缩（悬浮球开启，逐步降阶压缩满足配额） */
  autoCompress?: boolean
  /** 最大 dataURL 字符长度（autoCompress 启用时生效） */
  maxDataUrlLength?: number
}

const VIEWPORT_SIZE = 260
const CROP_SIZE = 200
const CROP_OFFSET = (VIEWPORT_SIZE - CROP_SIZE) / 2

export default function ImageCropModal({
  imageSrc,
  shape: initialShape = 'rounded',
  allowShapeSelect = false,
  onConfirm,
  onCancel,
  labels = {},
  exportSize = 600,
  autoCompress = false,
  maxDataUrlLength,
}: ImageCropModalProps) {
  const { t } = useTranslation()
  const [shape, setShape] = useState<ImageCropShape>(initialShape)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [imgLoaded, setImgLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [exportError, setExportError] = useState(false)

  const imgRef = useRef<HTMLImageElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const offsetStartRef = useRef({ x: 0, y: 0 })
  const baseScaleRef = useRef(1)

  // 当外部传入的 shape 改变且不支持弹窗内切换形状时，同步更新内部 shape
  useEffect(() => {
    if (!allowShapeSelect && initialShape) {
      setShape(initialShape)
    }
  }, [allowShapeSelect, initialShape])

  // 限制偏移范围，确保裁剪框内始终填满图像不露白
  const clamp = useCallback((ox: number, oy: number, currentZoom: number) => {
    const img = imgRef.current
    if (!img) return { x: ox, y: oy }
    return clampCropOffset(
      ox,
      oy,
      currentZoom,
      img.naturalWidth,
      img.naturalHeight,
      CROP_OFFSET,
      CROP_SIZE,
      baseScaleRef.current,
    )
  }, [])

  // 初始化图片与基础比例
  useEffect(() => {
    let active = true
    setLoadError(false)
    setImgLoaded(false)
    setExportError(false)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (!active) return
      imgRef.current = img
      // 基础比例：使图片短边等于 CROP_SIZE
      const bScale = Math.max(CROP_SIZE / img.naturalWidth, CROP_SIZE / img.naturalHeight)
      baseScaleRef.current = bScale
      const initialW = img.naturalWidth * bScale
      const initialH = img.naturalHeight * bScale
      // 居中对齐裁剪框
      const initialOx = CROP_OFFSET + (CROP_SIZE - initialW) / 2
      const initialOy = CROP_OFFSET + (CROP_SIZE - initialH) / 2
      setOffset({ x: initialOx, y: initialOy })
      setZoom(1)
      setImgLoaded(true)
    }
    img.onerror = () => {
      if (!active) return
      setLoadError(true)
    }
    img.src = imageSrc
    return () => {
      active = false
    }
  }, [imageSrc])

  const zoomRef = useRef(zoom)
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  // 键盘快捷键监听：Escape 退出，方向键微调裁剪位置（Shift 20px / 默认 5px）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
        return
      }

      const step = e.shiftKey ? 20 : 5
      let dx = 0
      let dy = 0

      if (e.key === 'ArrowLeft') {
        dx = step
      } else if (e.key === 'ArrowRight') {
        dx = -step
      } else if (e.key === 'ArrowUp') {
        dy = step
      } else if (e.key === 'ArrowDown') {
        dy = -step
      } else {
        return
      }

      // 如果焦点在 range 滑块上，左右键留给原生滑块调节缩放，不干扰图片移动
      const activeEl = document.activeElement
      if (activeEl instanceof HTMLInputElement && activeEl.type === 'range') {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return
      }

      e.preventDefault()
      setOffset((prev) => clamp(prev.x + dx, prev.y + dy, zoomRef.current))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel, clamp])

  // 拖拽移动处理
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    draggingRef.current = true
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    offsetStartRef.current = { ...offset }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    const nextOx = offsetStartRef.current.x + dx
    const nextOy = offsetStartRef.current.y + dy
    setOffset(clamp(nextOx, nextOy, zoom))
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // 容错
    }
  }

  // 滚轮缩放处理
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY < 0 ? 0.08 : -0.08
      const nextZoom = Math.min(3, Math.max(1, Number((zoom + delta).toFixed(2))))
      if (nextZoom === zoom) return
      setZoom(nextZoom)
      setOffset((prev) => clamp(prev.x, prev.y, nextZoom))
    },
    [zoom, clamp],
  )

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // 滑块缩放
  const handleZoomSlider = (val: number) => {
    setZoom(val)
    setOffset((prev) => clamp(prev.x, prev.y, val))
  }

  // 重置居中与 1x 缩放
  const handleReset = () => {
    const img = imgRef.current
    if (!img) return
    const bScale = baseScaleRef.current
    const initialW = img.naturalWidth * bScale
    const initialH = img.naturalHeight * bScale
    setZoom(1)
    setOffset({
      x: CROP_OFFSET + (CROP_SIZE - initialW) / 2,
      y: CROP_OFFSET + (CROP_SIZE - initialH) / 2,
    })
  }

  // 确认并导出
  const handleConfirm = () => {
    const img = imgRef.current
    if (!img) return

    const cropParams = computeCropParams(offset, zoom, baseScaleRef.current, CROP_OFFSET, CROP_SIZE)
    const croppedUrl = exportCroppedCanvas(img, cropParams, {
      exportSize,
      autoCompress,
      maxDataUrlLength,
    })

    if (!croppedUrl) {
      setExportError(true)
      return
    }

    setExportError(false)
    onConfirm(croppedUrl, shape)
  }

  const renderW = imgRef.current
    ? imgRef.current.naturalWidth * baseScaleRef.current * zoom
    : VIEWPORT_SIZE
  const renderH = imgRef.current
    ? imgRef.current.naturalHeight * baseScaleRef.current * zoom
    : VIEWPORT_SIZE

  // 统一文本标签（提供通用默认值）
  const textTitle = labels.title ?? t('tool.qrcode.cropTitle')
  const textHint = labels.hint ?? t('tool.qrcode.cropHint')
  const textShapeLabel = labels.shapeLabel ?? t('tool.qrcode.logoShape')
  const textShapeRounded = labels.shapeRounded ?? t('tool.qrcode.logoShapeRounded')
  const textShapeCircle = labels.shapeCircle ?? t('tool.qrcode.logoShapeCircle')
  const textShapeSquare = labels.shapeSquare ?? t('tool.qrcode.logoShapeSquare')
  const textReset = labels.reset ?? t('tool.qrcode.cropReset')
  const textZoom = labels.zoom ?? t('tool.qrcode.cropZoom')
  const textConfirm = labels.confirm ?? t('tool.qrcode.cropConfirm')
  const textCancel = labels.cancel ?? t('common.cancel')
  const textLoadError = labels.loadError ?? t('tool.qrcode.cropLoadError')
  const textExportError = labels.exportError ?? t('tool.qrcode.cropExportError')

  return (
    <div className='pd-modal' role='dialog' aria-modal='true' aria-label={textTitle}>
      <div className='pd-modal__card pd-crop-modal tw-crop-modal opt-crop-modal'>
        {/* 弹窗头部 */}
        <div className='pd-crop-modal__header tw-crop-modal__header opt-crop-modal__header'>
          <h3 className='pd-modal__title pd-crop-modal__title tw-crop-modal__title opt-crop-modal__title'>
            {textTitle}
          </h3>
          <Tooltip content={textCancel} side='bottom'>
            <button
              type='button'
              className='pd-icon-btn'
              onClick={onCancel}
              aria-label={textCancel}
            >
              <Icon name='close' size={14} />
            </button>
          </Tooltip>
        </div>

        <p className='pd-crop-modal__hint tw-crop-modal__hint opt-crop-modal__hint'>{textHint}</p>

        {/* 裁剪视口 */}
        <div
          ref={viewportRef}
          className='pd-crop-modal__viewport tw-crop-modal__viewport opt-crop-modal__viewport'
          style={{ width: VIEWPORT_SIZE, height: VIEWPORT_SIZE }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {loadError ? (
            <div className='pd-crop-modal__status-error opt-crop-modal__status-error'>
              <p>{textLoadError}</p>
            </div>
          ) : (
            <>
              {imgLoaded && (
                <img
                  src={imageSrc}
                  alt='Crop preview'
                  className='pd-crop-modal__img tw-crop-modal__img opt-crop-modal__img'
                  style={{
                    width: renderW,
                    height: renderH,
                    transform: `translate(${offset.x}px, ${offset.y}px)`,
                  }}
                  draggable={false}
                />
              )}

              {/* 裁剪框与遮罩 */}
              <div
                className={`pd-crop-modal__overlay pd-crop-modal__overlay--${shape} tw-crop-modal__overlay tw-crop-modal__overlay--${shape} opt-crop-modal__overlay opt-crop-modal__overlay--${shape}`}
                style={{
                  width: CROP_SIZE,
                  height: CROP_SIZE,
                  top: CROP_OFFSET,
                  left: CROP_OFFSET,
                }}
              >
                <div className='pd-crop-modal__grid tw-crop-modal__grid opt-crop-modal__grid'>
                  <div className='pd-crop-modal__grid-line pd-crop-modal__grid-line--h1 tw-crop-modal__grid-line tw-crop-modal__grid-line--h1 opt-crop-modal__grid-line opt-crop-modal__grid-line--h1' />
                  <div className='pd-crop-modal__grid-line pd-crop-modal__grid-line--h2 tw-crop-modal__grid-line tw-crop-modal__grid-line--h2 opt-crop-modal__grid-line opt-crop-modal__grid-line--h2' />
                  <div className='pd-crop-modal__grid-line pd-crop-modal__grid-line--v1 tw-crop-modal__grid-line tw-crop-modal__grid-line--v1 opt-crop-modal__grid-line opt-crop-modal__grid-line--v1' />
                  <div className='pd-crop-modal__grid-line pd-crop-modal__grid-line--v2 tw-crop-modal__grid-line tw-crop-modal__grid-line--v2 opt-crop-modal__grid-line opt-crop-modal__grid-line--v2' />
                </div>
              </div>
            </>
          )}
        </div>

        {/* 控制条 */}
        <div className='pd-crop-modal__controls tw-crop-modal__controls opt-crop-modal__controls'>
          {allowShapeSelect && (
            <div className='pd-crop-modal__row tw-crop-modal__row opt-crop-modal__row'>
              <label
                className='pd-crop-modal__label tw-crop-modal__label opt-crop-modal__label'
                htmlFor='tw-crop-shape'
              >
                {textShapeLabel}:
              </label>
              <PdSelect
                id='tw-crop-shape'
                value={shape}
                onChange={(e) => setShape(e.target.value as ImageCropShape)}
              >
                <option value='rounded'>{textShapeRounded}</option>
                <option value='circle'>{textShapeCircle}</option>
                <option value='square'>{textShapeSquare}</option>
              </PdSelect>

              <button
                type='button'
                className='pd-btn pd-btn--sm pd-crop-modal__reset-btn tw-crop-modal__reset-btn opt-crop-modal__reset-btn'
                onClick={handleReset}
              >
                {textReset}
              </button>
            </div>
          )}

          <div className='pd-crop-modal__row tw-crop-modal__row opt-crop-modal__row'>
            <span className='pd-crop-modal__label tw-crop-modal__label opt-crop-modal__label'>
              {textZoom}:
            </span>
            <input
              type='range'
              min='1'
              max='3'
              step='0.02'
              value={zoom}
              onChange={(e) => handleZoomSlider(Number(e.target.value))}
              className='pd-crop-modal__slider tw-crop-modal__slider opt-crop-modal__slider'
              aria-label={textZoom}
            />
            <span className='pd-crop-modal__zoom-val tw-crop-modal__zoom-val opt-crop-modal__zoom-val'>
              {Math.round(zoom * 100)}%
            </span>
            {!allowShapeSelect && (
              <button
                type='button'
                className='pd-btn pd-btn--sm pd-crop-modal__reset-btn tw-crop-modal__reset-btn opt-crop-modal__reset-btn'
                onClick={handleReset}
              >
                {textReset}
              </button>
            )}
          </div>
        </div>

        {/* 导出阶段错误提示 */}
        {exportError && (
          <p className='pd-crop-modal__export-error tw-crop-modal__export-error opt-crop-modal__export-error'>
            {textExportError}
          </p>
        )}

        {/* 底部操作按钮 */}
        <div className='pd-modal__actions pd-crop-modal__actions tw-crop-modal__actions opt-crop-modal__actions'>
          <button type='button' className='pd-btn' onClick={onCancel}>
            {textCancel}
          </button>
          <button
            type='button'
            className='pd-btn pd-btn--primary'
            disabled={!imgLoaded || loadError}
            onClick={handleConfirm}
          >
            {textConfirm}
          </button>
        </div>
      </div>
    </div>
  )
}
