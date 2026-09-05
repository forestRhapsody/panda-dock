/**
 * 应用品牌 logo（小熊猫）。
 * 浏览器/扩展图标即 manifest 的 icons（16/32/48/128），此处复用 icon32.png：
 * 扩展环境经 chrome.runtime.getURL 定位，普通浏览器（pnpm dev 预览）回退到 /icons/icon32.png。
 */
export default function AppLogo({ size = 18, className }: { size?: number; className?: string }) {
  const url =
    typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL('icons/icon32.png')
      : '/icons/icon32.png'
  return (
    <img
      src={url}
      width={size}
      height={size}
      alt=''
      aria-hidden='true'
      draggable={false}
      className={className}
    />
  )
}
