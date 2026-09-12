import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import i18n from '@/i18n'

import ToolErrorBoundary, {
  describeThrown,
  ERROR_MESSAGE_MAX,
  ToolErrorFallback,
} from './ToolErrorBoundary'

const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/

describe('describeThrown', () => {
  it('Error 实例保留 name 与 message', () => {
    expect(describeThrown(new TypeError('bad'))).toEqual({ name: 'TypeError', message: 'bad' })
  })

  it('字符串直接作为 message，name 留空（不在代码里硬编码 "Error"）', () => {
    expect(describeThrown('boom')).toEqual({ name: '', message: 'boom' })
  })

  it('普通对象序列化；循环引用与 undefined 不抛错', () => {
    expect(describeThrown({ a: 1 }).message).toBe('{"a":1}')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => describeThrown(cyclic)).not.toThrow()
    expect(() => describeThrown(undefined)).not.toThrow()
    expect(() => describeThrown(null)).not.toThrow()
  })

  it('超长 message 截断到上限并追加省略号', () => {
    const { message } = describeThrown('x'.repeat(ERROR_MESSAGE_MAX + 50))
    expect(message).toHaveLength(ERROR_MESSAGE_MAX + 1)
    expect(message.endsWith('…')).toBe(true)
  })
})

describe('ToolErrorBoundary', () => {
  it('无错误时原样渲染子树，不插入任何降级节点', () => {
    const html = renderToStaticMarkup(
      <ToolErrorBoundary>
        <b>child-ok</b>
      </ToolErrorBoundary>,
    )
    expect(html).toContain('child-ok')
    expect(html).not.toContain('tw-error')
  })

  it('捕获异常后进入降级态（hasError 判定不依赖 error === null，可容纳 throw null）', () => {
    expect(ToolErrorBoundary.getDerivedStateFromError(new Error('boom'))).toEqual({
      hasError: true,
      error: expect.any(Error),
    })
    expect(ToolErrorBoundary.getDerivedStateFromError(null)).toEqual({
      hasError: true,
      error: null,
    })
  })
})

describe('ToolErrorFallback', () => {
  it('中文界面下渲染标题 / 说明 / 错误详情 / 重试按钮，且不出现裸 key', async () => {
    await i18n.changeLanguage('zh')
    const html = renderToStaticMarkup(
      <ToolErrorFallback error={{ name: 'TypeError', message: 'boom' }} onRetry={() => {}} />,
    )
    expect(html).toContain(i18n.t('tool.error.title'))
    expect(html).toContain(i18n.t('tool.error.description'))
    expect(html).toContain(i18n.t('common.retry'))
    expect(html).toContain('TypeError: boom')
    expect(html).toContain('role="alert"')
    // 任何 key 漏登记都会在界面上显示成裸 key，这里兜底
    expect(html).not.toContain('tool.error.')
    expect(html).not.toContain('common.')
  })

  it('英文界面下文案为英文且不含中文', async () => {
    await i18n.changeLanguage('en')
    const html = renderToStaticMarkup(
      <ToolErrorFallback error={{ name: '', message: 'boom' }} onRetry={() => {}} />,
    )
    expect(CJK.test(html), `英文降级卡片含中文：${html}`).toBe(false)
    expect(html).toContain(i18n.t('tool.error.title'))
    expect(html).toContain('boom')
  })

  it('name 为空时只展示 message（不出现裸露的冒号前缀）', async () => {
    await i18n.changeLanguage('zh')
    const html = renderToStaticMarkup(
      <ToolErrorFallback error={{ name: '', message: 'only message' }} onRetry={() => {}} />,
    )
    expect(html).toContain('only message')
    expect(html).not.toContain(': only message')
  })
})
