import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import Icon from '@/ui/Icon'
import PdSelect from '@/ui/PdSelect'
import Tooltip from '@/ui/Tooltip'

import type { QrLogoShape } from './qrcode'

interface QrLogoCropModalProps {
  /** 待裁剪的原图 URL（ObjectURL 或 DataURL） */
  imageSrc: string
  /** 初始形状 */
  initialShape?: QrLogoShape
  /** 确认裁剪回调，输出 1:1 高清 DataURL 及所选形状 */
  onConfirm: (croppedDataUrl: string, selectedShape: QrLogoShape) => void
  /** 取消关闭回调 */
  onCancel: () => void
}

const VIEWPORT_SIZE = 260
const CROP_SIZE = 200
const CROP_OFFSET = (VIEWPORT_SIZE - CROP_SIZE) / 2
const EXPORT_SIZE = 600

export default function QrLogoCropModal({
  imageSrc,
  initialShape = 'rounded',
  onConfirm,
  onCancel,
}: QrLogoCropModalProps) {
  const { t } = useTranslation()
  const [shape, setShape] = useState<QrLogoShape>(initialShape)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [imgLoaded, setImgLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  /** 导出阶段失败（如环境不提供 canvas 2D 上下文）：必须显式提示，不能静默无响应 */
  const [exportError, setExportError] = useState(false)

  const imgRef = useRef<HTMLImageElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const offsetStartRef = useRef({ x: 0, y: 0 })
  const baseScaleRef = useRef(1)

  // 限制偏移范围，确保裁剪框内始终填满图像不露白
  const clampOffset = useCallback((ox: number, oy: number, currentZoom: number) => {
    const img = imgRef.current
    if (!img) return { x: ox, y: oy }

    const renderW = img.naturalWidth * baseScaleRef.current * currentZoom
    const renderH = img.naturalHeight * baseScaleRef.current * currentZoom

    // 视口内裁剪框在 [CROP_OFFSET, CROP_OFFSET + CROP_SIZE]
    // 保证图片左边界 <= CROP_OFFSET，右边界 >= CROP_OFFSET + CROP_SIZE
    const minX = CROP_OFFSET + CROP_SIZE - renderW
    const maxX = CROP_OFFSET
    const minY = CROP_OFFSET + CROP_SIZE - renderH
    const maxY = CROP_OFFSET

    return {
      x: Math.min(maxX, Math.max(minX, ox)),
      y: Math.min(maxY, Math.max(minY, oy)),
    }
  }, [])

  // 初始化图片与基础比例
  useEffect(() => {
    let active = true
    setLoadError(false)
    setImgLoaded(false)
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

  // 键盘快捷键监听
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

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
    setOffset(clampOffset(nextOx, nextOy, zoom))
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
      // 必须能拦住默认滚动：否则缩放的同时背后页面会跟着滚（见下方非 passive 注册）
      e.preventDefault()
      const delta = e.deltaY < 0 ? 0.08 : -0.08
      const nextZoom = Math.min(3, Math.max(1, Number((zoom + delta).toFixed(2))))
      if (nextZoom === zoom) return
      setZoom(nextZoom)
      setOffset((prev) => clampOffset(prev.x, prev.y, nextZoom))
    },
    [zoom, clampOffset],
  )

  /**
   * React 对 `wheel` 是**被动（passive）注册**的：`onWheel` 里的 preventDefault() 既无效，
   * 又会打印 "Unable to preventDefault inside passive event listener invocation"，
   * 结果是滚轮缩放时背后页面一起滚动。改为手动注册非 passive 监听（与 DetectResultView 的 Tab 横滚同一写法）。
   */
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // 滑块缩放
  const handleZoomSlider = (val: number) => {
    setZoom(val)
    setOffset((prev) => clampOffset(prev.x, prev.y, val))
  }

  // 重置居中与 1x
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

  // 确认并导出 1:1 高清 DataURL
  const handleConfirm = () => {
    const img = imgRef.current
    if (!img) return

    const canvas = document.createElement('canvas')
    canvas.width = EXPORT_SIZE
    canvas.height = EXPORT_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      // 2D 上下文不可用（环境限制 / 被策略禁用）：静默 return 会让用户以为按钮坏了
      setExportError(true)
      return
    }
    setExportError(false)

    const scaleFactor = baseScaleRef.current * zoom
    // 裁剪框在原图坐标系中的起始与截取尺寸
    const cropX = (CROP_OFFSET - offset.x) / scaleFactor
    const cropY = (CROP_OFFSET - offset.y) / scaleFactor
    const cropSize = CROP_SIZE / scaleFactor

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, cropX, cropY, cropSize, cropSize, 0, 0, EXPORT_SIZE, EXPORT_SIZE)

    const croppedUrl = canvas.toDataURL('image/png')
    onConfirm(croppedUrl, shape)
  }

  const renderW = imgRef.current
    ? imgRef.current.naturalWidth * baseScaleRef.current * zoom
    : VIEWPORT_SIZE
  const renderH = imgRef.current
    ? imgRef.current.naturalHeight * baseScaleRef.current * zoom
    : VIEWPORT_SIZE

  return (
    <div
      className='pd-modal'
      role='dialog'
      aria-modal='true'
      aria-label={t('tool.qrcode.cropTitle')}
      onClick={onCancel}
    >
      <div className='pd-modal__card tw-crop-modal' onClick={(e) => e.stopPropagation()}>
        {/* 弹窗头部 */}
        <div className='tw-crop-modal__header'>
          <h3 className='pd-modal__title tw-crop-modal__title'>{t('tool.qrcode.cropTitle')}</h3>
          <Tooltip content={t('common.cancel')} side='bottom'>
            <button
              type='button'
              className='pd-icon-btn'
              onClick={onCancel}
              aria-label={t('common.cancel')}
            >
              <Icon name='close' size={14} />
            </button>
          </Tooltip>
        </div>

        <p className='tw-crop-modal__hint'>{t('tool.qrcode.cropHint')}</p>

        {/* 裁剪视口 */}
        <div
          ref={viewportRef}
          className='tw-crop-modal__viewport'
          style={{ width: VIEWPORT_SIZE, height: VIEWPORT_SIZE }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {loadError ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--pd-destructive, #ef4444)',
                fontSize: 13,
                padding: 16,
                textAlign: 'center',
              }}
            >
              <p>{t('tool.qrcode.cropLoadError')}</p>
            </div>
          ) : (
            <>
              {imgLoaded && (
                <img
                  src={imageSrc}
                  alt='Crop preview'
                  className='tw-crop-modal__img'
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
                className={`tw-crop-modal__overlay tw-crop-modal__overlay--${shape}`}
                style={{
                  width: CROP_SIZE,
                  height: CROP_SIZE,
                  top: CROP_OFFSET,
                  left: CROP_OFFSET,
                }}
              >
                <div className='tw-crop-modal__grid'>
                  <div className='tw-crop-modal__grid-line tw-crop-modal__grid-line--h1' />
                  <div className='tw-crop-modal__grid-line tw-crop-modal__grid-line--h2' />
                  <div className='tw-crop-modal__grid-line tw-crop-modal__grid-line--v1' />
                  <div className='tw-crop-modal__grid-line tw-crop-modal__grid-line--v2' />
                </div>
              </div>
            </>
          )}
        </div>

        {/* 控制条：形状选择与缩放控制 */}
        <div className='tw-crop-modal__controls'>
          <div className='tw-crop-modal__row'>
            <label className='tw-crop-modal__label' htmlFor='tw-crop-shape'>
              {t('tool.qrcode.logoShape')}:
            </label>
            <PdSelect
              id='tw-crop-shape'
              value={shape}
              onChange={(e) => setShape(e.target.value as QrLogoShape)}
            >
              <option value='rounded'>{t('tool.qrcode.logoShapeRounded')}</option>
              <option value='circle'>{t('tool.qrcode.logoShapeCircle')}</option>
              <option value='square'>{t('tool.qrcode.logoShapeSquare')}</option>
            </PdSelect>

            <button
              type='button'
              className='pd-btn pd-btn--sm tw-crop-modal__reset-btn'
              onClick={handleReset}
            >
              {t('tool.qrcode.cropReset')}
            </button>
          </div>

          <div className='tw-crop-modal__row'>
            <span className='tw-crop-modal__label'>{t('tool.qrcode.cropZoom')}:</span>
            <input
              type='range'
              min='1'
              max='3'
              step='0.02'
              value={zoom}
              onChange={(e) => handleZoomSlider(Number(e.target.value))}
              className='tw-crop-modal__slider'
            />
            <span className='tw-crop-modal__zoom-val'>{Math.round(zoom * 100)}%</span>
          </div>
        </div>

        {/* 导出失败提示：与图片加载失败一样贴在图区下方，点确认后立刻可见 */}
        {exportError && (
          <p
            style={{
              color: 'var(--pd-destructive, #ef4444)',
              fontSize: 13,
              margin: '8px 0 0',
              textAlign: 'center',
            }}
          >
            {t('tool.qrcode.cropExportError')}
          </p>
        )}

        {/* 底部操作按钮 */}
        <div className='pd-modal__actions tw-crop-modal__actions'>
          <button type='button' className='pd-btn' onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type='button'
            className='pd-btn pd-btn--primary'
            disabled={!imgLoaded || loadError}
            onClick={handleConfirm}
          >
            {t('tool.qrcode.cropConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
