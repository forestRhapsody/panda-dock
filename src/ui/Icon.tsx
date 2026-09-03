/**
 * 全入口统一的内联 SVG 图标集（24×24 viewBox，描边风格，无第三方依赖）。
 * 代替此前散落各处的 emoji，避免不同平台 emoji 渲染差异造成的观感不统一。
 * 颜色继承 currentColor，尺寸经 size 控制（默认 16）。
 */
import type { ReactNode } from 'react'

export type IconName =
  | 'toolbox' // 工具箱（产品标识）
  | 'settings' // 设置（齿轮）
  | 'panel-right' // 浏览器侧边栏
  | 'window' // Popup 弹窗
  | 'code' // 页面注入
  | 'close' // 关闭
  | 'grip' // 拖拽把手（六点）
  | 'check' // 完成 / 已保存
  | 'copy' // 复制

interface IconProps {
  name: IconName
  /** 边长（px），默认 16 */
  size?: number
  className?: string
  /** 可访问名；纯装饰时留空并自动 aria-hidden */
  title?: string
}

/** 各图标的内部元素（grip 为实心点，其余描边 = currentColor） */
const GLYPHS: Record<IconName, ReactNode> = {
  toolbox: (
    <>
      <rect x='3' y='8' width='18' height='12' rx='2' />
      <path d='M8.5 8V6.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V8' />
      <path d='M3 13h18' />
    </>
  ),
  settings: (
    <>
      <path d='M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z' />
      <circle cx='12' cy='12' r='3' />
    </>
  ),
  'panel-right': (
    <>
      <rect x='3' y='3' width='18' height='18' rx='2' />
      <path d='M15 3v18' />
    </>
  ),
  window: (
    <>
      <rect x='3' y='4' width='18' height='16' rx='2' />
      <path d='M3 9h18' />
      <path d='M6.5 6.5h.01M9.5 6.5h.01' />
    </>
  ),
  code: (
    <>
      <path d='m8 7-5 5 5 5' />
      <path d='m16 7 5 5-5 5' />
    </>
  ),
  close: (
    <>
      <path d='M18 6 6 18' />
      <path d='m6 6 12 12' />
    </>
  ),
  grip: (
    <>
      {[9, 15].flatMap((cx) =>
        [6, 12, 18].map((cy) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.4} />),
      )}
    </>
  ),
  check: <path d='M20 6 9 17l-5-5' />,
  copy: (
    <>
      <rect x='9' y='9' width='11' height='11' rx='2' />
      <path d='M5 15V5a2 2 0 0 1 2-2h9' />
    </>
  ),
}

export default function Icon({ name, size = 16, className, title }: IconProps) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const }
  const filled = name === 'grip'

  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap='round'
      strokeLinejoin='round'
      className={className}
      {...a11y}
    >
      {GLYPHS[name]}
    </svg>
  )
}
