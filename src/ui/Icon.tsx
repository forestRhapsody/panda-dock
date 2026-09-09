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
  | 'qr-code' // 二维码
  | 'upload' // 上传
  | 'download' // 下载
  | 'external-link' // 外部链接
  | 'image' // 图片
  | 'chevron-down' // 下拉箭头
  | 'chevron-right' // 右箭头
  | 'chevron-left' // 左箭头
  | 'pin' // 图钉（钉住）
  | 'alert' // 警告 / 错误提示
  | 'refresh' // 刷新 / 重新载入
  | 'swap' // 交换 / 双向转换
  | 'search' // 搜索放大镜
  | 'maximize' // 全屏 / 最大化
  | 'minimize' // 还原 / 退出全屏
  | 'plus' // 新增加号
  | 'edit' // 编辑（铅笔）
  | 'hash' // 哈希 / 校验和（#）

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
  'qr-code': (
    <>
      <rect x='3' y='3' width='7' height='7' rx='1' />
      <rect x='14' y='3' width='7' height='7' rx='1' />
      <rect x='3' y='14' width='7' height='7' rx='1' />
      <path d='M14 14h3v3h-3zM20 14v3M14 20h7M7 7h.01M18 7h.01M7 18h.01' />
    </>
  ),
  upload: (
    <>
      <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
      <polyline points='17 8 12 3 7 8' />
      <line x1='12' y1='3' x2='12' y2='15' />
    </>
  ),
  download: (
    <>
      <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
      <polyline points='7 10 12 15 17 10' />
      <line x1='12' y1='15' x2='12' y2='3' />
    </>
  ),
  'external-link': (
    <>
      <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
      <polyline points='15 3 21 3 21 9' />
      <line x1='10' y1='14' x2='21' y2='3' />
    </>
  ),
  image: (
    <>
      <rect x='3' y='3' width='18' height='18' rx='2' />
      <circle cx='8.5' cy='8.5' r='1.5' />
      <path d='m21 15-5-5L5 21' />
    </>
  ),
  'chevron-down': <path d='m6 9 6 6 6-6' />,
  'chevron-right': <path d='m9 18 6-6-6-6' />,
  'chevron-left': <path d='m15 18-6-6 6-6' />,
  pin: (
    <>
      <path d='M12 17v5' />
      <path d='M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z' />
    </>
  ),
  alert: (
    <>
      <circle cx='12' cy='12' r='10' />
      <line x1='12' y1='8' x2='12' y2='12' />
      <line x1='12' y1='16' x2='12.01' y2='16' />
    </>
  ),
  refresh: (
    <>
      <path d='M21 12a9 9 0 1 1-9-9c2.52 0 4.85.83 6.72 2.24L21 8' />
      <path d='M21 3v5h-5' />
    </>
  ),
  swap: (
    <>
      <path d='m16 3 4 4-4 4' />
      <path d='M20 7H4' />
      <path d='m8 21-4-4 4-4' />
      <path d='M4 17h16' />
    </>
  ),
  search: (
    <>
      <circle cx='11' cy='11' r='7' />
      <path d='m21 21-4.35-4.35' />
    </>
  ),
  maximize: (
    <>
      <path d='M15 3h6v6' />
      <path d='M9 21H3v-6' />
      <path d='M21 3l-7 7' />
      <path d='M3 21l7-7' />
    </>
  ),
  minimize: (
    <>
      <path d='M4 14h6v6' />
      <path d='M20 10h-6V4' />
      <path d='M14 10l7-7' />
      <path d='M10 14l-7 7' />
    </>
  ),
  plus: (
    <>
      <path d='M12 5v14' />
      <path d='M5 12h14' />
    </>
  ),
  edit: (
    <>
      <path d='M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' />
      <path d='m15 5 4 4' />
    </>
  ),
  hash: (
    <>
      <line x1='4' y1='9' x2='20' y2='9' />
      <line x1='4' y1='15' x2='20' y2='15' />
      <line x1='10' y1='3' x2='8' y2='21' />
      <line x1='16' y1='3' x2='14' y2='21' />
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
