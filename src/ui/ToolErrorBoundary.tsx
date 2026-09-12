import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

import { useTranslation } from 'react-i18next'

import Icon from './Icon'

/** 错误摘要展示上限：避免超长报错（如超大 JSON 的解析报错）把卡片撑爆 */
export const ERROR_MESSAGE_MAX = 400

/**
 * 把任意抛出物归一成可展示的错误摘要。
 * React 允许 `throw` 任意值（字符串、对象、甚至 undefined），不一定是 Error 实例，
 * 因此这里统一收口；`name` 缺失时返回空串，由 UI 省略，避免在代码里硬编码 "Error" 这类文案。
 */
export function describeThrown(value: unknown): { name: string; message: string } {
  let name = ''
  let message = ''
  if (value instanceof Error) {
    name = value.name
    message = value.message
  } else if (typeof value === 'string') {
    message = value
  } else {
    try {
      message = JSON.stringify(value) ?? String(value)
    } catch {
      // 循环引用等无法序列化的情况：退化为 String
      message = String(value)
    }
  }
  return {
    name,
    message:
      message.length > ERROR_MESSAGE_MAX ? `${message.slice(0, ERROR_MESSAGE_MAX)}…` : message,
  }
}

interface ToolErrorFallbackProps {
  error: { name: string; message: string }
  onRetry: () => void
}

/** 降级卡片：用函数组件以便随语言切换重新渲染 */
export function ToolErrorFallback({ error, onRetry }: ToolErrorFallbackProps) {
  const { t } = useTranslation()
  return (
    <div className='tw-error' role='alert'>
      <div className='tw-error__head'>
        <Icon name='alert' size={15} />
        <strong className='tw-error__title'>{t('tool.error.title')}</strong>
      </div>
      <p className='tw-error__desc'>{t('tool.error.description')}</p>
      <pre className='tw-error__detail' aria-label={t('tool.error.detailLabel')}>
        {error.name ? `${error.name}: ${error.message}` : error.message}
      </pre>
      <button type='button' className='tk-btn tk-btn--sm' onClick={onRetry}>
        <Icon name='refresh' size={13} />
        {t('common.retry')}
      </button>
    </div>
  )
}

interface ToolErrorBoundaryProps {
  children: ReactNode
}

interface ToolErrorBoundaryState {
  hasError: boolean
  error: unknown
}

/**
 * 工具级错误边界：单个工具在渲染期抛错时只降级该工具面板，
 * 不再让整个网页内抽屉 / 原生侧边栏白屏。
 * - 宿主必须以 `key={activeToolId}` 挂载：切换工具即卸载重建，错误状态随之清空；
 * - 类组件不产生额外 DOM 节点，因此不影响 `.tw__body--json` 这类 flex 布局；
 * - 仅覆盖子树的渲染 / 生命周期异常：事件回调与异步 Promise 里的异常不在其范围内（各工具需自行 catch）。
 * - 用 `hasError` 布尔位而非 `error === null` 判断，避免子组件 `throw null` 时状态判定失效。
 */
export default class ToolErrorBoundary extends Component<
  ToolErrorBoundaryProps,
  ToolErrorBoundaryState
> {
  state: ToolErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: unknown): ToolErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // 开发者面板日志：保留组件栈，便于定位是哪个工具出的问题
    console.error('[PandaDock] tool crashed:', error, info.componentStack)
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    return <ToolErrorFallback error={describeThrown(this.state.error)} onRetry={this.handleRetry} />
  }
}
