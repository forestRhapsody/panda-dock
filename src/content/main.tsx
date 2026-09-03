import { StrictMode } from 'react'

import { createRoot } from 'react-dom/client'

import { installStorageBridge } from '@/tools/storage'
import toolsCss from '@/tools/tools.css?inline'

import contentCss from './content.css?inline'
import ToolkitOverlay from './ToolkitOverlay'

const HOST_ID = '__toolkit_extension_host__'

/** 把 React 界面挂载进 Shadow DOM，样式与宿主网页完全隔离 */
function mount() {
  if (document.getElementById(HOST_ID)) return // 防止重复注入

  const host = document.createElement('div')
  host.id = HOST_ID

  const shadow = host.attachShadow({ mode: 'open' })

  // CSS 在构建期以 ?inline 内联进 bundle，写进 Shadow DOM 内的 <style>
  const style = document.createElement('style')
  style.textContent = `${toolsCss}\n${contentCss}`
  shadow.appendChild(style)

  const app = document.createElement('div')
  shadow.appendChild(app)
  ;(document.body ?? document.documentElement).appendChild(host)

  // 存储桥接：让原生侧边栏等扩展页面能读取当前网页的 localStorage/sessionStorage
  installStorageBridge()

  createRoot(app).render(
    <StrictMode>
      <ToolkitOverlay />
    </StrictMode>,
  )
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true })
} else {
  mount()
}
