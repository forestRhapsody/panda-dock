// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import {
  clearAllCookies,
  clearStorageArea,
  isPageContext,
  listCookies,
  listStorage,
  removeCookie,
  removeStorageKey,
  setStorageValue,
} from '@/tools/storage'
import type { CookieEntry, CookieSnapshot, StorageEntry, StorageSnapshot } from '@/tools/storage'
import StorageTool from '@/tools/StorageTool'
import { toast } from '@/ui/toast'
import { setDraftValue } from '@/utils/draft'

/**
 * StorageTool 的真实 DOM 行为测试。
 * 只 mock 存储桥接层（`@/tools/storage`）与 toast：前者依赖 chrome 消息通道、
 * 无法在 happy-dom 里跑通；后者会用定时器排队，直接用 spy 断言提示文案更稳定。
 * 其余（编辑器、确认弹窗、PdSelect、i18n）全部走真实实现，断言用户可观察的结果。
 *
 * 红线校验：所有破坏性写操作（删 key / 清空区域 / 删 Cookie / 清空 Cookie）都必须
 * 经过 ConfirmDialog 二次确认，且不得走 window.confirm（§4 第 14 条 / §8）。
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    create: vi.fn(),
    dismiss: vi.fn(),
  },
}))

vi.mock('@/tools/storage', () => ({
  listStorage: vi.fn(),
  listCookies: vi.fn(),
  removeStorageKey: vi.fn(),
  setStorageValue: vi.fn(),
  clearStorageArea: vi.fn(),
  removeCookie: vi.fn(),
  clearAllCookies: vi.fn(),
  saveCookies: vi.fn(),
  // 非扩展页面上下文：走「扩展页读活动标签页」分支，页面底部会给出提示
  isPageContext: vi.fn(() => false),
  // 展示用的纯函数按真实实现提供，避免 mock 把断言带偏
  bareCookieDomain: (domain: string) => (domain.startsWith('.') ? domain.slice(1) : domain),
}))

let container: HTMLDivElement
let root: Root
let confirmSpy: ReturnType<typeof vi.fn>

function makeEntry(key: string, value: string, over: Partial<StorageEntry> = {}): StorageEntry {
  return { key, value, size: new TextEncoder().encode(value).length, truncated: false, ...over }
}

function makeSnapshot(over: Partial<StorageSnapshot> = {}): StorageSnapshot {
  return {
    origin: 'https://site.test',
    area: 'local',
    entries: [],
    totalCount: 0,
    listTruncated: false,
    ...over,
  }
}

function makeCookie(over: Partial<CookieEntry> = {}): CookieEntry {
  return {
    name: 'sid',
    value: 'abc',
    domain: '.example.com',
    path: '/',
    hostOnly: false,
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    session: true,
    size: 6,
    ...over,
  }
}

function makeCookieSnapshot(over: Partial<CookieSnapshot> = {}): CookieSnapshot {
  return {
    url: 'https://site.test/page',
    origin: 'https://site.test',
    cookies: [],
    totalCount: 0,
    ...over,
  }
}

beforeEach(async () => {
  confirmSpy = vi.fn(() => true)
  vi.stubGlobal('confirm', confirmSpy)

  vi.mocked(isPageContext).mockReturnValue(false)
  vi.mocked(listStorage).mockReset()
  vi.mocked(listStorage).mockResolvedValue({ ok: true, data: makeSnapshot() })
  vi.mocked(listCookies).mockReset()
  vi.mocked(listCookies).mockResolvedValue({ ok: true, data: makeCookieSnapshot() })
  vi.mocked(removeStorageKey).mockReset()
  vi.mocked(removeStorageKey).mockResolvedValue({ ok: true })
  vi.mocked(setStorageValue).mockReset()
  vi.mocked(setStorageValue).mockResolvedValue({ ok: true })
  vi.mocked(clearStorageArea).mockReset()
  vi.mocked(clearStorageArea).mockResolvedValue({ ok: true })
  vi.mocked(removeCookie).mockReset()
  vi.mocked(removeCookie).mockResolvedValue({ ok: true })
  vi.mocked(clearAllCookies).mockReset()
  vi.mocked(clearAllCookies).mockResolvedValue({ ok: true })
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
  // 草稿的 memoryCache 是模块级常驻的：显式重置区域，避免用例之间互相污染
  await setDraftValue('storage.area', 'local')

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  // 语言是 i18n 全局状态：每个用例后恢复中文，避免用例间互相污染
  if (i18n.language !== 'zh') await i18n.changeLanguage('zh')
})

afterAll(async () => {
  await i18n.changeLanguage('zh')
})

async function renderTool(): Promise<void> {
  await act(async () => {
    root.render(<StorageTool />)
  })
}

/** 模拟「切到别的工具再切回来」：整棵组件卸载后重新挂载 */
async function remount(): Promise<void> {
  act(() => root.unmount())
  container.remove()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await renderTool()
}

function buttonsIn(scope: ParentNode = container): HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll('button'))
}

function buttonWithText(text: string, scope: ParentNode = container): HTMLButtonElement {
  const btn = buttonsIn(scope).find((el) => el.textContent?.includes(text))
  if (!btn) throw new Error(`未找到按钮：${text}`)
  return btn
}

function dialog(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[role="alertdialog"]')
  if (!el) throw new Error('确认弹窗未出现')
  return el
}

function firstRow(): HTMLElement {
  const row = container.querySelector<HTMLElement>('.tw-store__row')
  if (!row) throw new Error('未找到存储条目行')
  return row
}

function keys(): (string | null | undefined)[] {
  return Array.from(container.querySelectorAll('.tw-store__key')).map((el) => el.textContent)
}

function summary(): string {
  return container.querySelector('.tw-store__summary')?.textContent ?? ''
}

function setInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function editorKeyInput(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('.tw-store__edit input')
  if (!el) throw new Error('编辑器未打开')
  return el
}

function editorValueArea(): HTMLTextAreaElement {
  const el = container.querySelector<HTMLTextAreaElement>('.tw-store__edit textarea')
  if (!el) throw new Error('编辑器未打开')
  return el
}

function clickSave(): Promise<void> {
  return act(async () => {
    const btn = container.querySelector<HTMLButtonElement>('.tw-store__save-btn')
    if (!btn) throw new Error('未找到保存按钮')
    btn.click()
  })
}

describe('StorageTool 存储浏览', () => {
  it('默认拉取 local，切到 session 时按区域重新请求并替换列表', async () => {
    vi.mocked(listStorage).mockImplementation(async (area) =>
      area === 'local'
        ? {
            ok: true,
            data: makeSnapshot({
              area: 'local',
              entries: [makeEntry('alpha', 'local-value')],
              totalCount: 1,
            }),
          }
        : {
            ok: true,
            data: makeSnapshot({
              area: 'session',
              entries: [makeEntry('beta', 'session-value')],
              totalCount: 1,
            }),
          },
    )
    await renderTool()
    expect(listStorage).toHaveBeenCalledWith('local')
    expect(keys()).toEqual(['alpha'])
    expect(container.textContent).toContain('local-value')

    await act(async () => buttonWithText('sessionStorage').click())
    expect(listStorage).toHaveBeenLastCalledWith('session')
    expect(keys()).toEqual(['beta'])
    expect(container.textContent).toContain('session-value')
    expect(container.textContent).not.toContain('alpha')
  })

  it('区域 tab 跨挂载保留：切到 session 后重挂载仍停在 session（回归）', async () => {
    await renderTool()
    expect(listStorage).toHaveBeenCalledWith('local')

    await act(async () => buttonWithText('sessionStorage').click())
    expect(listStorage).toHaveBeenLastCalledWith('session')

    await remount()

    // 回归：源码曾用 useState 存区域，切到别的工具再回来会跳回 localStorage
    expect(listStorage).toHaveBeenLastCalledWith('session')
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      'sessionStorage',
    )
  })

  it('草稿里的脏区域值回落到 local（草稿不做校验）', async () => {
    await setDraftValue('storage.area', '这不是一个合法区域')

    await renderTool()

    expect(listStorage).toHaveBeenCalledWith('local')
  })

  it('渲染 key、值与字节 size，并给出站点/条数摘要', async () => {
    vi.mocked(listStorage).mockResolvedValue({
      ok: true,
      data: makeSnapshot({
        entries: [
          makeEntry('alpha', 'v1', { size: 37 }),
          makeEntry('big', 'x', { size: 2048 }),
          makeEntry('blank', '', { size: 0 }),
        ],
        totalCount: 3,
      }),
    })
    await renderTool()
    expect(keys()).toEqual(['alpha', 'big', 'blank'])
    expect(
      Array.from(container.querySelectorAll('.tw-store__size')).map((el) => el.textContent),
    ).toEqual(['37 B', '2.0 KB', '0 B'])
    expect(summary()).toContain('https://site.test')
    expect(summary()).toContain('共 3 项')
    // 空值不能渲染成空白，否则用户无法区分「空字符串」与「没读到」
    expect(container.textContent).toContain('（空字符串）')
  })

  it('值超长时展示截断预览，并禁用编辑与复制', async () => {
    vi.mocked(listStorage).mockResolvedValue({
      ok: true,
      data: makeSnapshot({
        entries: [makeEntry('long', 'abcdef', { truncated: true })],
        totalCount: 1,
      }),
    })
    await renderTool()
    const value = container.querySelector<HTMLElement>('.tw-store__value')
    expect(value?.textContent).toBe('abcdef…（值过长，仅显示前 8000 字符）')

    const row = firstRow()
    expect(buttonWithText('编辑', row).disabled).toBe(true)
    expect(row.querySelector<HTMLButtonElement>('button[aria-label="复制"]')?.disabled).toBe(true)

    // 编辑按钮禁用后，双击值仍会走 startEdit 的截断守卫给出提示
    await act(async () => {
      value?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(container.querySelector('.tw-status')?.textContent).toContain('值过长已截断，不支持编辑')
    expect(container.querySelector('.tw-store__edit')).toBeNull()
  })

  it('listTruncated 提示只列出前 2000 项，session 区域附「仅当前会话有效」说明', async () => {
    vi.mocked(listStorage).mockImplementation(async (area) => ({
      ok: true,
      data: makeSnapshot({
        area,
        entries: [makeEntry('a', '1')],
        totalCount: 5000,
        listTruncated: true,
      }),
    }))
    await renderTool()
    expect(summary()).toContain('（仅显示前 2000 项）')
    expect(summary()).not.toContain('仅当前会话有效')

    await act(async () => buttonWithText('sessionStorage').click())
    expect(summary()).toContain('（仅显示前 2000 项）')
    expect(summary()).toContain('仅当前会话有效')
  })

  it('空区域展示空状态引导，并禁用清空按钮', async () => {
    await renderTool()
    const notes = Array.from(container.querySelectorAll('.tw-note')).map((el) => el.textContent)
    expect(notes).toContain('该区域暂无数据。')
    // isPageContext=false：扩展页场景下要提醒用户读的是活动标签页
    expect(container.textContent).toContain('请先切到目标网页再刷新')
    expect(buttonWithText('清空全部').disabled).toBe(true)
  })

  it('搜索按 key 与值过滤，支持无匹配提示、清除与 Escape 复位', async () => {
    vi.mocked(listStorage).mockResolvedValue({
      ok: true,
      data: makeSnapshot({
        entries: [makeEntry('token', 'secret-abc'), makeEntry('theme', 'dark')],
        totalCount: 2,
      }),
    })
    await renderTool()
    const search = container.querySelector<HTMLInputElement>('.tw-store__search-input')
    expect(search).not.toBeNull()

    await act(async () => setInput(search as HTMLInputElement, 'dark'))
    expect(keys()).toEqual(['theme'])
    expect(summary()).toContain('，匹配 1 项')

    await act(async () => setInput(search as HTMLInputElement, 'secret'))
    expect(keys()).toEqual(['token'])

    await act(async () => setInput(search as HTMLInputElement, 'zzz'))
    expect(container.querySelector('.tw-store__nomatch')).not.toBeNull()
    expect(container.textContent).toContain('未找到匹配项。')
    await act(async () => buttonWithText('清除搜索').click())
    expect(container.querySelectorAll('.tw-store__row')).toHaveLength(2)

    await act(async () => setInput(search as HTMLInputElement, 'dark'))
    await act(async () => {
      search?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelectorAll('.tw-store__row')).toHaveLength(2)
    expect((search as HTMLInputElement).value).toBe('')
  })

  it('读取失败时展示错误文案且界面不白屏', async () => {
    vi.mocked(listStorage).mockResolvedValue({ ok: false, error: '当前标签页不支持访问网页存储' })
    await renderTool()
    expect(container.querySelector('.tw-status--err')?.textContent).toBe(
      '当前标签页不支持访问网页存储',
    )
    expect(buttonWithText('刷新')).toBeTruthy()
    expect(buttonWithText('新增').disabled).toBe(false)
    expect(container.querySelector('.tw-store')).toBeNull()
    expect(container.querySelector('.tw-store__summary')).toBeNull()
  })
})

describe('StorageTool 破坏性操作二次确认', () => {
  async function renderWithEntries(): Promise<void> {
    vi.mocked(listStorage).mockResolvedValue({
      ok: true,
      data: makeSnapshot({ entries: [makeEntry('alpha', '1')], totalCount: 1 }),
    })
    await renderTool()
  }

  it('点击删除只弹 ConfirmDialog，未确认前不调用 removeStorageKey', async () => {
    await renderWithEntries()
    await act(async () => buttonWithText('删除', firstRow()).click())

    expect(removeStorageKey).not.toHaveBeenCalled()
    const d = dialog()
    expect(d.textContent).toContain('删除存储项')
    expect(d.textContent).toContain('确定删除「alpha」吗？（localStorage）')
    // 破坏性写操作绝不能走 window.confirm
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('取消删除不写数据；确认后才删除并重新拉取，同时提示成功', async () => {
    await renderWithEntries()

    await act(async () => buttonWithText('删除', firstRow()).click())
    await act(async () => buttonWithText('取消', dialog()).click())
    expect(removeStorageKey).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()

    await act(async () => buttonWithText('删除', firstRow()).click())
    await act(async () => buttonWithText('删除', dialog()).click())
    expect(removeStorageKey).toHaveBeenCalledWith('local', 'alpha')
    expect(toast.success).toHaveBeenCalledWith('已删除 alpha')
    expect(confirmSpy).not.toHaveBeenCalled()
    // 删除成功后重新拉取快照
    expect(vi.mocked(listStorage).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('删除失败时展示错误且不提示成功', async () => {
    await renderWithEntries()
    vi.mocked(removeStorageKey).mockResolvedValue({ ok: false, error: '目标页面已关闭' })

    await act(async () => buttonWithText('删除', firstRow()).click())
    await act(async () => buttonWithText('删除', dialog()).click())
    expect(removeStorageKey).toHaveBeenCalledWith('local', 'alpha')
    expect(toast.success).not.toHaveBeenCalled()
    expect(container.querySelector('.tw-status--err')?.textContent).toBe('目标页面已关闭')
  })

  it('清空整个区域：取消不调用 clearStorageArea，确认后才清空', async () => {
    vi.mocked(listStorage).mockResolvedValue({
      ok: true,
      data: makeSnapshot({ entries: [makeEntry('a', '1'), makeEntry('b', '2')], totalCount: 2 }),
    })
    await renderTool()

    await act(async () => buttonWithText('清空全部').click())
    expect(clearStorageArea).not.toHaveBeenCalled()
    expect(dialog().textContent).toContain(
      '确定清空 https://site.test 的 localStorage 吗？（共 2 项）',
    )
    await act(async () => buttonWithText('取消', dialog()).click())
    expect(clearStorageArea).not.toHaveBeenCalled()

    await act(async () => buttonWithText('清空全部').click())
    await act(async () => buttonWithText('清空全部', dialog()).click())
    expect(clearStorageArea).toHaveBeenCalledWith('local')
    expect(toast.success).toHaveBeenCalledWith('已清空')
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})

describe('StorageTool 编辑与写入', () => {
  it('点击新增时默认聚焦在 Key 输入框，而编辑已有项时默认聚焦在值输入框', async () => {
    vi.mocked(listStorage).mockResolvedValue({
      ok: true,
      data: makeSnapshot({ entries: [makeEntry('item1', 'value1')], totalCount: 1 }),
    })
    await renderTool()

    // 1. 点击新增：焦点默认在 Key 上
    await act(async () => buttonWithText('新增').click())
    expect(document.activeElement).toBe(editorKeyInput())

    // 取消新增
    await act(async () => {
      const cancelBtn = container.querySelector<HTMLButtonElement>('.tw-store__ghost-btn')
      cancelBtn?.click()
    })

    // 2. 点击已有项编辑：焦点默认在值上
    await act(async () => buttonWithText('编辑', firstRow()).click())
    expect(document.activeElement).toBe(editorValueArea())
  })

  it('新增键值：合法 JSON 保存时自动压缩，写入后关闭编辑器', async () => {
    await renderTool()
    await act(async () => buttonWithText('新增').click())
    expect(document.activeElement).toBe(editorKeyInput())
    expect(editorKeyInput().value).toBe('')

    await act(async () => setInput(editorKeyInput(), ' cfg '))
    await act(async () => setInput(editorValueArea(), '{ "a": 1 }'))
    // 输入合法 JSON 后实时切换成 JSON 编辑器并给出校验状态
    expect(container.querySelector('.tw-store__status-bar--ok')?.textContent).toContain(
      'JSON 格式正确',
    )

    await clickSave()
    expect(setStorageValue).toHaveBeenCalledWith('local', 'cfg', '{"a":1}')
    expect(toast.success).toHaveBeenCalledWith('已新增 cfg')
    expect(container.querySelector('.tw-store__edit')).toBeNull()
  })

  it('裸标量（如 1251）不算 JSON 文档：不进 JSON 编辑器、按原文保存不被改写', async () => {
    await renderTool()
    await act(async () => buttonWithText('新增').click())
    await act(async () => setInput(editorKeyInput(), 'width'))
    await act(async () => setInput(editorValueArea(), '1251'))

    // 没有 JSON 校验条，也拿不到「格式化 / 压缩」
    expect(container.querySelector('.tw-store__status-bar--ok')).toBeNull()
    expect(buttonsIn().some((b) => b.textContent?.includes('格式化'))).toBe(false)

    // 科学计数法这类「合法 JSON 标量」绝不能被 stringify 改写
    await act(async () => setInput(editorValueArea(), '1e3'))
    await clickSave()
    expect(setStorageValue).toHaveBeenCalledWith('local', 'width', '1e3')
  })

  it('编辑值为裸标量的已有条目：按普通值打开（不美化、不套 JSON 编辑器）', async () => {
    vi.mocked(listStorage).mockResolvedValue({
      ok: true,
      data: makeSnapshot({ entries: [makeEntry('width', '1251')], totalCount: 1 }),
    })
    await renderTool()

    await act(async () => buttonWithText('编辑', firstRow()).click())
    expect(editorValueArea().value).toBe('1251')
    expect(container.querySelector('.tw-store__status-bar--ok')).toBeNull()
    expect(buttonsIn().some((b) => b.textContent?.includes('格式化'))).toBe(false)
  })

  it('新增时 Key 为空给出内联校验提示且不写数据', async () => {
    await renderTool()
    await act(async () => buttonWithText('新增').click())
    await act(async () => setInput(editorValueArea(), 'v'))
    await clickSave()

    expect(setStorageValue).not.toHaveBeenCalled()
    expect(container.querySelector('.tw-store__status-bar--err')?.textContent).toContain(
      '请输入 Key',
    )
    // 修改 Key 后错误提示被清除
    await act(async () => setInput(editorKeyInput(), 'k'))
    expect(container.querySelector('.tw-store__status-bar--err')).toBeNull()
  })

  it('写入失败时展示桥接层返回的错误文案，并保留编辑器内容', async () => {
    vi.mocked(setStorageValue).mockResolvedValue({ ok: false, error: '写入被拒绝：目标页面已关闭' })
    await renderTool()
    await act(async () => buttonWithText('新增').click())
    await act(async () => setInput(editorKeyInput(), 'k'))
    await act(async () => setInput(editorValueArea(), 'plain'))
    await clickSave()

    expect(setStorageValue).toHaveBeenCalledWith('local', 'k', 'plain')
    expect(container.querySelector('.tw-status--err')?.textContent).toBe(
      '写入被拒绝：目标页面已关闭',
    )
    expect(editorKeyInput().value).toBe('k')
    expect(editorValueArea().value).toBe('plain')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('编辑 JSON 值时进入 JSON 编辑器，压缩/格式化改写草稿', async () => {
    vi.mocked(listStorage).mockResolvedValue({
      ok: true,
      data: makeSnapshot({ entries: [makeEntry('cfg', '{"b":2,   "a": 1}')], totalCount: 1 }),
    })
    await renderTool()
    await act(async () => buttonWithText('编辑', firstRow()).click())

    const area = editorValueArea()
    expect(area.value).toBe('{\n  "b": 2,\n  "a": 1\n}')
    const editor = container.querySelector<HTMLElement>('.tw-store__edit')
    await act(async () => buttonWithText('压缩', editor as HTMLElement).click())
    expect(area.value).toBe('{"b":2,"a":1}')
    await act(async () => buttonWithText('格式化', editor as HTMLElement).click())
    expect(area.value).toBe('{\n  "b": 2,\n  "a": 1\n}')
  })

  it('把原 JSON 值改成非法 JSON：确认前不写，确认后按去换行文本保存', async () => {
    vi.mocked(listStorage).mockResolvedValue({
      ok: true,
      data: makeSnapshot({ entries: [makeEntry('cfg', '{"a":1}')], totalCount: 1 }),
    })
    await renderTool()
    await act(async () => buttonWithText('编辑', firstRow()).click())
    await act(async () => setInput(editorValueArea(), 'not\njson'))
    expect(container.querySelector('.tw-store__status-bar--err')).not.toBeNull()

    await clickSave()
    expect(setStorageValue).not.toHaveBeenCalled()
    expect(dialog().textContent).toContain('当前内容不是合法 JSON，仍要保存吗？')

    await act(async () => buttonWithText('确认', dialog()).click())
    expect(setStorageValue).toHaveBeenCalledWith('local', 'cfg', 'not json')
    expect(toast.success).toHaveBeenCalledWith('已更新 cfg')
  })

  it('编辑时改 Key 会写新 key 再删旧 key', async () => {
    vi.mocked(listStorage).mockResolvedValue({
      ok: true,
      data: makeSnapshot({ entries: [makeEntry('old', 'v')], totalCount: 1 }),
    })
    await renderTool()
    await act(async () => buttonWithText('编辑', firstRow()).click())
    await act(async () => setInput(editorKeyInput(), 'renamed'))
    await clickSave()

    expect(setStorageValue).toHaveBeenCalledWith('local', 'renamed', 'v')
    expect(removeStorageKey).toHaveBeenCalledWith('local', 'old')
    expect(toast.success).toHaveBeenCalledWith('已更新 renamed')
  })

  it('刷新按钮立即重新拉取，并在最短动画时长内保持禁用', async () => {
    vi.mocked(listStorage).mockResolvedValue({
      ok: true,
      data: makeSnapshot({ entries: [makeEntry('a', '1')], totalCount: 1 }),
    })
    await renderTool()
    expect(listStorage).toHaveBeenCalledTimes(1)

    const refresh = buttonWithText('刷新')
    await act(async () => refresh.click())
    expect(refresh.disabled).toBe(true)
    expect(listStorage).toHaveBeenCalledTimes(2)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600))
    })
    expect(buttonWithText('刷新').disabled).toBe(false)
  })

  it('内联编辑时按 Escape 退出编辑：丢弃草稿、不写存储，并声明接管 Escape 供抽屉让行', async () => {
    vi.mocked(listStorage).mockResolvedValue({
      ok: true,
      data: makeSnapshot({ entries: [makeEntry('a', '1')], totalCount: 1 }),
    })
    await renderTool()
    await act(async () => buttonWithText('编辑', firstRow()).click())
    await act(async () => setInput(editorValueArea(), 'changed'))

    const editor = container.querySelector<HTMLElement>('.tw-store__edit')
    if (!editor) throw new Error('编辑器未打开')
    // 抽屉的 Escape 守卫（content/Drawer.tsx）据此标记 + 焦点判断「内层正在处理键盘」
    expect(editor.hasAttribute('data-pd-escape')).toBe(true)

    const escaped = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => {
      editor.dispatchEvent(escaped)
    })

    // Escape = 取消编辑：编辑器关闭、草稿丢弃、不落盘
    expect(escaped.defaultPrevented).toBe(true)
    expect(container.querySelector('.tw-store__edit')).toBeNull()
    expect(keys()).toEqual(['a'])
    expect(setStorageValue).not.toHaveBeenCalled()
  })

  it('搜索框只在存在筛选词时声明接管 Escape（否则焦点停在这里会让抽屉关不掉）', async () => {
    vi.mocked(listStorage).mockResolvedValue({
      ok: true,
      data: makeSnapshot({ entries: [makeEntry('a', '1')], totalCount: 1 }),
    })
    await renderTool()
    const search = container.querySelector<HTMLInputElement>('.tw-store__search-input')
    if (!search) throw new Error('未找到搜索框')

    expect(search.hasAttribute('data-pd-escape')).toBe(false)

    await act(async () => setInput(search, 'a'))
    expect(search.hasAttribute('data-pd-escape')).toBe(true)

    // 有筛选词时接管：Escape 复位筛选，而不是关掉抽屉
    const escaped = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => {
      search.dispatchEvent(escaped)
    })
    expect(escaped.defaultPrevented).toBe(true)
    expect(search.value).toBe('')
    expect(search.hasAttribute('data-pd-escape')).toBe(false)
  })
})

describe('StorageTool Cookies 区域', () => {
  it('展示 Cookie 徽章与元数据，删除需二次确认', async () => {
    const cookie = makeCookie({
      name: 'sid',
      value: 'abc',
      domain: '.example.com',
      path: '/app',
      sameSite: 'strict',
      session: false,
      expirationDate: 1800000000,
    })
    vi.mocked(listCookies).mockResolvedValue({
      ok: true,
      data: makeCookieSnapshot({ cookies: [cookie], totalCount: 1 }),
    })
    await renderTool()
    await act(async () => buttonWithText('Cookies').click())
    expect(listCookies).toHaveBeenCalled()

    const text = container.textContent ?? ''
    expect(text).toContain('HttpOnly')
    expect(text).toContain('Secure')
    expect(text).toContain('Strict')
    expect(text).toContain('含子域')
    // domain 原样显示（带前导点，与 chrome.cookies / DevTools 一致），作用域另由「含子域」徽章表达
    expect(text).toContain('.example.com')
    expect(text).toContain('/app')

    await act(async () => buttonWithText('删除', firstRow()).click())
    expect(removeCookie).not.toHaveBeenCalled()
    expect(dialog().textContent).toContain('确定删除 Cookie「sid」吗？')
    await act(async () => buttonWithText('删除', dialog()).click())
    expect(removeCookie).toHaveBeenCalledWith(cookie, 'https://site.test/page')
    expect(toast.success).toHaveBeenCalledWith('已删除 Cookie「sid」')
  })

  it('清空 Cookies 需二次确认，确认后调用 clearAllCookies', async () => {
    vi.mocked(listCookies).mockResolvedValue({
      ok: true,
      data: makeCookieSnapshot({ cookies: [makeCookie()], totalCount: 1 }),
    })
    await renderTool()
    await act(async () => buttonWithText('Cookies').click())

    await act(async () => buttonWithText('清空全部').click())
    expect(clearAllCookies).not.toHaveBeenCalled()
    expect(dialog().textContent).toContain(
      '确定清空 https://site.test 的所有 Cookies 吗？（共 1 项）',
    )

    await act(async () => buttonWithText('清空全部', dialog()).click())
    expect(clearAllCookies).toHaveBeenCalledWith('https://site.test/page')
    expect(toast.success).toHaveBeenCalledWith('已清空当前网页 Cookies')
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('Cookies 为空时展示空状态引导并禁用清空', async () => {
    await renderTool()
    await act(async () => buttonWithText('Cookies').click())
    expect(container.textContent).toContain('当前网页暂无 Cookies。')
    expect(buttonWithText('清空全部').disabled).toBe(true)
  })

  it('Cookies 搜索支持按域名过滤并给出无匹配提示', async () => {
    vi.mocked(listCookies).mockResolvedValue({
      ok: true,
      data: makeCookieSnapshot({
        cookies: [makeCookie({ name: 'sid' }), makeCookie({ name: 'theme', domain: 'other.test' })],
        totalCount: 2,
      }),
    })
    await renderTool()
    await act(async () => buttonWithText('Cookies').click())

    const search = container.querySelector<HTMLInputElement>('.tw-store__search-input')
    await act(async () => setInput(search as HTMLInputElement, 'other.test'))
    expect(keys()).toEqual(['theme'])
    expect(summary()).toContain('，匹配 1 项')

    await act(async () => setInput(search as HTMLInputElement, 'nope.test'))
    expect(container.textContent).toContain('未找到匹配项。')
  })
})

describe('StorageTool 国际化', () => {
  it('切换到英文后界面文案同步更新，且不出现裸 i18n key', async () => {
    vi.mocked(listStorage).mockResolvedValue({
      ok: true,
      data: makeSnapshot({ entries: [makeEntry('alpha', '1')], totalCount: 1 }),
    })
    await renderTool()
    expect(container.textContent).toContain('清空全部')

    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(container.textContent).toContain('Clear all')
    expect(container.textContent).toContain('Refresh')
    expect(container.textContent).toContain('Delete')
    expect(container.textContent).not.toMatch(/tool\.storage\.|common\./)
  })
})
