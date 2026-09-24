// @vitest-environment happy-dom
import { act } from 'react'
import type { ComponentProps } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import CookieEditModal from '@/tools/CookieEditModal'
import type { CookieSetDetails } from '@/tools/cookieRaw'
import { saveCookies } from '@/tools/storage'
import type { CookieEntry, SimpleResult } from '@/tools/storage'

/**
 * CookieEditModal 的真实 DOM 行为测试。
 * 只 mock 写入入口 `saveCookies`（真实实现依赖 chrome.runtime 消息通道），
 * cookieRaw 的解析/序列化走真实实现——表单与 Raw 的双向同步正是这两个模块的契约，
 * mock 掉就测不到真实载荷形状了。
 *
 * 覆盖：新建/编辑两种模式、字段受控更新、sameSite↔secure 联动、保存载荷（含 oldCookie）、
 * 失败展示、取消/关闭不写数据、Escape 与遮罩行为、Raw 模式解析与批量保存、过期时间边界、
 * 最大化与高级面板、中英双语（不出现裸 key）。
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/tools/storage', () => ({
  saveCookies: vi.fn(),
  // 展示用的纯函数按真实实现提供
  bareCookieDomain: (domain: string) => (domain.startsWith('.') ? domain.slice(1) : domain),
}))

let container: HTMLDivElement
let root: Root
let onClose: ReturnType<typeof vi.fn<() => void>>
let onSaved: ReturnType<typeof vi.fn<(count: number) => void>>

function makeCookie(over: Partial<CookieEntry> = {}): CookieEntry {
  return {
    name: 'sid',
    value: 'abc',
    domain: '.example.com',
    path: '/',
    hostOnly: false,
    secure: true,
    httpOnly: false,
    sameSite: 'lax',
    session: true,
    size: 6,
    ...over,
  }
}

beforeEach(() => {
  vi.mocked(saveCookies).mockReset()
  vi.mocked(saveCookies).mockResolvedValue({ ok: true })
  onClose = vi.fn<() => void>()
  onSaved = vi.fn<(count: number) => void>()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  act(() => root.unmount())
  container.remove()
  // PdSelect 的下拉是 portal 到 body 的，残留会污染下一个用例的选项查询
  document.body.querySelectorAll('.pd-select-popup').forEach((el) => el.remove())
  if (i18n.language !== 'zh') await i18n.changeLanguage('zh')
})

afterAll(async () => {
  await i18n.changeLanguage('zh')
})

function renderModal(props: Partial<ComponentProps<typeof CookieEditModal>> = {}): void {
  act(() => {
    root.render(
      <CookieEditModal
        open
        cookie={null}
        pageUrl='https://example.com/a/b'
        onClose={onClose}
        onSaved={onSaved}
        {...props}
      />,
    )
  })
}

function buttonsIn(scope: ParentNode = container): HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll('button'))
}

function buttonWithText(text: string, scope: ParentNode = container): HTMLButtonElement {
  const btn = buttonsIn(scope).find((el) => el.textContent?.includes(text))
  if (!btn) throw new Error(`未找到按钮：${text}`)
  return btn
}

function title(): string {
  return container.querySelector('.tw-cookie-modal__title')?.textContent ?? ''
}

function tabWithText(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find(
    (el) => el.textContent?.includes(text),
  )
  if (!btn) throw new Error(`未找到选项卡：${text}`)
  return btn
}

function saveButton(): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>(
    '.tw-cookie-modal__foot button.pd-btn--primary',
  )
  if (!btn) throw new Error('未找到保存按钮')
  return btn
}

function cancelButton(): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>(
    '.tw-cookie-modal__foot button.pd-btn:not(.pd-btn--primary)',
  )
  if (!btn) throw new Error('未找到取消按钮')
  return btn
}

function headIconButtons(): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>('.tw-cookie-modal__head-actions .pd-icon-btn'),
  )
}

function advancedToggle(): HTMLButtonElement {
  const btn = buttonsIn().find((el) => /展开高级选项|收起高级选项/.test(el.textContent ?? ''))
  if (!btn) throw new Error('未找到高级选项开关')
  return btn
}

function formTextInputs(): HTMLInputElement[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('.tw-cookie-modal__form input[type="text"]'),
  )
}

function nameInput(): HTMLInputElement {
  return formTextInputs()[0]
}

function domainInput(): HTMLInputElement {
  return formTextInputs()[1]
}

function pathInput(): HTMLInputElement {
  return formTextInputs()[2]
}

function valueArea(): HTMLTextAreaElement {
  const el = container.querySelector<HTMLTextAreaElement>('.tw-cookie-modal__form textarea')
  if (!el) throw new Error('未找到值输入框')
  return el
}

function rawArea(): HTMLTextAreaElement {
  const el = container.querySelector<HTMLTextAreaElement>('.tw-cookie-modal__raw-area')
  if (!el) throw new Error('未找到 Raw 输入框')
  return el
}

function checkboxes(): HTMLInputElement[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>(
      '.tw-cookie-modal__checkboxes input[type="checkbox"]',
    ),
  )
}

function subdomainsBox(): HTMLInputElement {
  return checkboxes()[0]
}

function httpOnlyBox(): HTMLInputElement {
  return checkboxes()[1]
}

function secureBox(): HTMLInputElement {
  return checkboxes()[2]
}

function combos(): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>('.tw-cookie-modal__form button[role="combobox"]'),
  )
}

/** 过期时间下拉与 SameSite 下拉（固定顺序：先 Expires，后 SameSite） */
function expiresCombo(): HTMLButtonElement {
  return combos()[0]
}

function sameSiteCombo(): HTMLButtonElement {
  return combos()[1]
}

function setInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 打开 PdSelect 并选择选项（选项 portal 到 document.body，必须在那里查） */
async function chooseOption(combo: HTMLButtonElement, label: string): Promise<void> {
  await act(async () => combo.click())
  const option = Array.from(document.body.querySelectorAll<HTMLElement>('[data-pds-item]')).find(
    (el) => el.textContent?.includes(label),
  )
  if (!option) throw new Error(`未找到下拉选项：${label}`)
  await act(async () => {
    option.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  })
}

async function clickSave(): Promise<void> {
  await act(async () => saveButton().click())
}

function lastDetails(): CookieSetDetails {
  const call = vi.mocked(saveCookies).mock.calls.at(-1)
  if (!call) throw new Error('saveCookies 未被调用')
  return call[0] as CookieSetDetails
}

describe('CookieEditModal 渲染与初始化', () => {
  it('open=false 时完全不渲染', () => {
    renderModal({ open: false })
    expect(container.innerHTML).toBe('')
  })

  it('新建模式：标题为「新增 Cookie」，域名默认取 pageUrl 主机名、Path 为 /', async () => {
    renderModal({ pageUrl: 'https://sub.example.com/a/b?x=1' })
    expect(title()).toBe('新增 Cookie')
    expect(nameInput().value).toBe('')
    expect(valueArea().value).toBe('')
    // 必填标记常显，避免用户不知道 name 必填
    expect(container.textContent).toContain('名称 *')

    // 高级项默认折叠，展开后才看得到默认 domain / path
    expect(container.querySelector('.tw-cookie-modal__adv-panel')).toBeNull()
    await act(async () => advancedToggle().click())
    expect(domainInput().value).toBe('sub.example.com')
    expect(pathInput().value).toBe('/')
    // https 页面默认勾选 Secure
    expect(secureBox().checked).toBe(true)
    expect(httpOnlyBox().checked).toBe(false)
  })

  it('页面协议与 URL 合法性决定默认 Secure 与默认域名', async () => {
    renderModal({ pageUrl: 'http://plain.test/x' })
    await act(async () => advancedToggle().click())
    expect(domainInput().value).toBe('plain.test')
    expect(secureBox().checked).toBe(false)

    renderModal({ pageUrl: 'about:blank' })
    await act(async () => advancedToggle().click())
    expect(domainInput().value).toBe('')
    expect(secureBox().checked).toBe(false)
  })

  it('编辑模式：按 Cookie 预填全部字段并自动展开高级项', () => {
    const cookie = makeCookie({
      name: 'sid',
      value: 'abc',
      domain: '.example.com',
      path: '/app',
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      session: false,
      expirationDate: 1800000000,
    })
    renderModal({ cookie })
    expect(title()).toBe('编辑 Cookie')
    expect(nameInput().value).toBe('sid')
    expect(valueArea().value).toBe('abc')
    // httpOnly / 非默认 path / 非 session 属于「高级非默认属性」，编辑时自动展开
    expect(container.querySelector('.tw-cookie-modal__adv-panel')).not.toBeNull()
    expect(domainInput().value).toBe('example.com')
    expect(pathInput().value).toBe('/app')
    expect(httpOnlyBox().checked).toBe(true)
    expect(secureBox().checked).toBe(true)
    expect(expiresCombo().textContent).toContain('自定义时间戳')
    expect(sameSiteCombo().textContent).toContain('Strict')
    expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe(
      '1800000000',
    )
  })

  it('编辑会话 Cookie：过期类型为「会话」且不显示时间戳输入', async () => {
    const cookie = makeCookie({
      session: true,
      expirationDate: undefined,
      domain: 'example.com',
      hostOnly: true,
    })
    renderModal({ cookie })
    // 全部字段均为默认值（domain 与页面一致、path=/、非 httpOnly、session）→ 面板保持折叠
    expect(container.querySelector('.tw-cookie-modal__adv-panel')).toBeNull()
    await act(async () => advancedToggle().click())
    expect(expiresCombo().textContent).toContain('会话')
    expect(sameSiteCombo().textContent).toContain('Lax')
    expect(container.querySelector('input[type="number"]')).toBeNull()
  })
})

describe('CookieEditModal 表单字段与校验', () => {
  it('name 为空或全空白时保存按钮禁用，不会调用 saveCookies', async () => {
    renderModal()
    expect(saveButton().disabled).toBe(true)
    await clickSave()
    expect(saveCookies).not.toHaveBeenCalled()

    await act(async () => setInput(nameInput(), '   '))
    expect(saveButton().disabled).toBe(true)

    await act(async () => setInput(nameInput(), 'tok'))
    expect(saveButton().disabled).toBe(false)
  })

  it('字段受控更新：name / value / domain / path 与两个复选框', async () => {
    renderModal()
    await act(async () => setInput(nameInput(), 'foo'))
    expect(nameInput().value).toBe('foo')
    await act(async () => setInput(valueArea(), 'bar'))
    expect(valueArea().value).toBe('bar')

    await act(async () => advancedToggle().click())
    await act(async () => setInput(domainInput(), 'x.test'))
    expect(domainInput().value).toBe('x.test')
    await act(async () => setInput(pathInput(), '/p'))
    expect(pathInput().value).toBe('/p')

    await act(async () => httpOnlyBox().click())
    expect(httpOnlyBox().checked).toBe(true)
    await act(async () => secureBox().click())
    expect(secureBox().checked).toBe(false)
  })

  it('sameSite=no_restriction 时自动勾选 Secure；取消 Secure 会回退到 lax', async () => {
    renderModal()
    await act(async () => advancedToggle().click())
    expect(secureBox().checked).toBe(true)

    await chooseOption(sameSiteCombo(), i18n.t('tool.storage.sameSiteNone'))
    expect(sameSiteCombo().textContent).toContain(i18n.t('tool.storage.sameSiteNone'))
    expect(secureBox().checked).toBe(true)

    // SameSite=None 必须搭配 Secure：取消 Secure 后源码把 sameSite 回退为 lax
    await act(async () => secureBox().click())
    expect(secureBox().checked).toBe(false)
    expect(sameSiteCombo().textContent).toContain('Lax')
  })
})

describe('CookieEditModal 保存', () => {
  it('保存表单：saveCookies 收到裁剪后的完整 details 与 pageUrl', async () => {
    renderModal({ pageUrl: 'https://example.com/a' })
    await act(async () => setInput(nameInput(), ' token '))
    await act(async () => setInput(valueArea(), 'v1'))
    await act(async () => advancedToggle().click())
    await act(async () => setInput(domainInput(), ' example.com '))
    await act(async () => setInput(pathInput(), '/p'))
    await act(async () => httpOnlyBox().click())
    await clickSave()

    expect(saveCookies).toHaveBeenCalledTimes(1)
    expect(lastDetails()).toEqual({
      name: 'token',
      value: 'v1',
      domain: 'example.com',
      hostOnly: true,
      path: '/p',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: undefined,
    })
    const [, url, old] = vi.mocked(saveCookies).mock.calls[0]
    expect(url).toBe('https://example.com/a')
    expect(old).toBeUndefined()
    expect(onSaved).toHaveBeenCalledWith(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('编辑 host-only Cookie：不改域名就仍是 host-only（不会被提升为 .example.com）', async () => {
    const cookie = makeCookie({
      name: 'sid',
      value: 'old',
      domain: 'example.com',
      hostOnly: true,
      secure: true,
    })
    renderModal({ cookie, pageUrl: 'https://example.com/' })
    await act(async () => setInput(valueArea(), 'new'))
    await clickSave()

    expect(lastDetails()).toMatchObject({ domain: 'example.com', hostOnly: true })
    await act(async () => advancedToggle().click())
    expect(domainInput().value).toBe('example.com')
    expect(subdomainsBox().checked).toBe(false)
  })

  it('编辑覆盖子域的 Cookie：保存后仍覆盖子域', async () => {
    const cookie = makeCookie({ domain: '.example.com', hostOnly: false, secure: true })
    renderModal({ cookie, pageUrl: 'https://example.com/' })
    await act(async () => setInput(valueArea(), 'new'))
    await clickSave()

    expect(lastDetails()).toMatchObject({ domain: 'example.com', hostOnly: false })
  })

  it('域名输入框接受前导点写法：自动勾选「含子域」并只保留裸域名', async () => {
    renderModal({ pageUrl: 'https://example.com/' })
    await act(async () => setInput(nameInput(), 'tok'))
    await act(async () => advancedToggle().click())
    await act(async () => setInput(domainInput(), '.example.com'))

    expect(domainInput().value).toBe('example.com')
    expect(subdomainsBox().checked).toBe(true)
    await clickSave()
    expect(lastDetails()).toMatchObject({ domain: 'example.com', hostOnly: false })
  })

  it('编辑模式保存时把原 Cookie 作为 oldCookie 传给 saveCookies', async () => {
    const cookie = makeCookie({
      name: 'sid',
      value: 'old',
      domain: 'example.com',
      secure: true,
    })
    renderModal({ cookie, pageUrl: 'https://example.com/' })
    await act(async () => setInput(valueArea(), 'new'))
    await clickSave()

    expect(lastDetails()).toMatchObject({ name: 'sid', value: 'new' })
    const [, , old] = vi.mocked(saveCookies).mock.calls[0]
    expect(old).toBe(cookie)
    expect(onSaved).toHaveBeenCalledWith(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('保存失败展示错误文案，不关闭弹窗也不回调 onSaved', async () => {
    vi.mocked(saveCookies).mockResolvedValue({
      ok: false,
      error: '写入 Cookie 失败，请检查 Domain 作用域与 Secure 属性是否匹配',
    })
    renderModal()
    await act(async () => setInput(nameInput(), 'tok'))
    await clickSave()

    expect(container.querySelector('.tw-cookie-modal__err')?.textContent).toBe(
      '写入 Cookie 失败，请检查 Domain 作用域与 Secure 属性是否匹配',
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    // submitting 已复位，用户可以改完再存
    expect(saveButton().disabled).toBe(false)
  })

  it('保存进行中：主按钮显示「保存中…」且保存/取消都禁用', async () => {
    let resolveSave: (value: SimpleResult) => void = () => {}
    vi.mocked(saveCookies).mockImplementation(
      () =>
        new Promise<SimpleResult>((resolve) => {
          resolveSave = resolve
        }),
    )
    renderModal()
    await act(async () => setInput(nameInput(), 'tok'))
    await clickSave()

    expect(saveButton().disabled).toBe(true)
    expect(saveButton().textContent).toContain('保存中…')
    expect(cancelButton().disabled).toBe(true)

    await act(async () => resolveSave({ ok: true }))
    expect(onSaved).toHaveBeenCalledWith(1)
  })

  it('saveCookies 直接抛异常时展示异常信息，不关闭弹窗', async () => {
    vi.mocked(saveCookies).mockRejectedValue(new Error('扩展上下文已失效'))
    renderModal()
    await act(async () => setInput(nameInput(), 'tok'))
    await clickSave()

    expect(container.querySelector('.tw-cookie-modal__err')?.textContent).toBe('扩展上下文已失效')
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('取消与右上角关闭只调用 onClose，绝不写数据', async () => {
    renderModal()
    await act(async () => cancelButton().click())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(saveCookies).not.toHaveBeenCalled()

    await act(async () => headIconButtons()[1].click())
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(saveCookies).not.toHaveBeenCalled()
  })

  it('Escape 关闭弹窗；点击遮罩不关闭', async () => {
    renderModal()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    // 源码未给遮罩绑定关闭（避免误触丢失输入），点击 overlay 不应关闭
    const modal = container.querySelector<HTMLElement>('.pd-modal')
    await act(async () => modal?.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('CookieEditModal Raw 模式', () => {
  it('Raw 模式实时反馈解析状态，非法/空输入禁用保存', async () => {
    renderModal()
    await act(async () => tabWithText('Raw 格式').click())
    expect(rawArea().value).toBe('')
    expect(saveButton().disabled).toBe(true)

    await act(async () => setInput(rawArea(), 'a=1; b=2'))
    expect(container.querySelector('.tw-status--ok')?.textContent).toContain(
      '已解析出 2 条 Cookies',
    )
    expect(saveButton().textContent).toContain('批量保存（2 条）')

    await act(async () => setInput(rawArea(), 'garbage'))
    expect(container.querySelector('.tw-status--err')?.textContent).toContain(
      '未识别出合法的 Cookie 键值对',
    )
    expect(saveButton().disabled).toBe(true)
  })

  it('Raw 模式保存：批量写入解析结果并回调条数', async () => {
    renderModal()
    await act(async () => tabWithText('Raw 格式').click())
    await act(async () => setInput(rawArea(), 'a=1; b=2'))
    await clickSave()

    expect(saveCookies).toHaveBeenCalledTimes(1)
    const [cookies, url, old] = vi.mocked(saveCookies).mock.calls[0]
    expect(cookies).toEqual([
      {
        name: 'a',
        value: '1',
        domain: 'example.com',
        path: '/',
        hostOnly: true,
        secure: false,
        httpOnly: false,
        sameSite: 'lax',
      },
      {
        name: 'b',
        value: '2',
        domain: 'example.com',
        path: '/',
        hostOnly: true,
        secure: false,
        httpOnly: false,
        sameSite: 'lax',
      },
    ])
    expect(url).toBe('https://example.com/a/b')
    expect(old).toBeUndefined()
    expect(onSaved).toHaveBeenCalledWith(2)
    expect(onClose).toHaveBeenCalled()
  })

  it('Raw 模式保存失败展示 parseRawCookie 的解析错误', async () => {
    renderModal()
    await act(async () => tabWithText('Raw 格式').click())
    await act(async () => setInput(rawArea(), '{"foo": 1}'))
    // JSON 对象缺少 name → 解析失败，保存按钮禁用
    expect(container.querySelector('.tw-status--err')?.textContent).toContain('缺少 name 字段')
    expect(saveButton().disabled).toBe(true)
    await clickSave()
    expect(saveCookies).not.toHaveBeenCalled()
  })

  it('表单→Raw 按当前输入序列化为 Set-Cookie 文本', async () => {
    renderModal()
    await act(async () => setInput(nameInput(), 'tok'))
    await act(async () => setInput(valueArea(), 'v1'))
    await act(async () => tabWithText('Raw 格式').click())

    // 新增默认 host-only：不写 Domain，避免把作用域悄悄扩大到子域
    expect(rawArea().value).toContain('tok=v1')
    expect(rawArea().value).not.toContain('Domain=')
    expect(rawArea().value).toContain('Path=/')
    expect(rawArea().value).toContain('SameSite=Lax')
    expect(rawArea().value).toContain('Secure')

    await act(async () => tabWithText('表单编辑').click())
    await act(async () => advancedToggle().click())
    expect(subdomainsBox().checked).toBe(false)
    await act(async () => subdomainsBox().click())
    await act(async () => tabWithText('Raw 格式').click())
    expect(rawArea().value).toContain('Domain=example.com')
  })

  it('编辑模式 Raw 预填完整属性；Raw→表单解析回填字段', async () => {
    const cookie = makeCookie({
      name: 'sid',
      value: 'abc',
      domain: '.example.com',
      path: '/app',
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      session: false,
      expirationDate: 1800000000,
    })
    renderModal({ cookie })
    await act(async () => tabWithText('Raw 格式').click())
    expect(rawArea().value).toContain('sid=abc')
    // 切到 Raw 时按表单 state 重新序列化：domain 已由 bareCookieDomain 去掉遗留前导点
    expect(rawArea().value).toContain('Domain=example.com')
    expect(rawArea().value).not.toContain('Domain=.example.com')
    expect(rawArea().value).toContain('Path=/app')
    expect(rawArea().value).toContain('SameSite=Strict')
    expect(rawArea().value).toContain('Secure')
    expect(rawArea().value).toContain('HttpOnly')

    await act(async () => setInput(rawArea(), 'renamed=xyz; Domain=other.test; Path=/q'))
    await act(async () => tabWithText('表单编辑').click())
    expect(nameInput().value).toBe('renamed')
    expect(valueArea().value).toBe('xyz')
    // httpOnly 原始为 true，高级面板保持展开；domain/path 已按 Raw 回填
    expect(container.querySelector('.tw-cookie-modal__adv-panel')).not.toBeNull()
    expect(domainInput().value).toBe('other.test')
    expect(pathInput().value).toBe('/q')
    expect(secureBox().checked).toBe(false)
    expect(httpOnlyBox().checked).toBe(false)
    // Raw 里显式声明了 Domain → 覆盖子域
    expect(subdomainsBox().checked).toBe(true)
  })

  it('Raw 工具栏可在键值串与 JSON / 规范 Set-Cookie 之间转换', async () => {
    renderModal()
    await act(async () => tabWithText('Raw 格式').click())
    await act(async () => setInput(rawArea(), 'a=1'))

    await act(async () => buttonWithText('JSON').click())
    expect(JSON.parse(rawArea().value)).toMatchObject({
      name: 'a',
      value: '1',
      domain: 'example.com',
      hostOnly: true,
      path: '/',
    })

    await act(async () => buttonWithText('Set-Cookie').click())
    // host-only 不写 Domain 属性
    expect(rawArea().value).toBe('a=1; Path=/; SameSite=Lax')
  })
})

describe('CookieEditModal 过期时间', () => {
  it('默认会话不传 expirationDate；选择「1 天后」传 now+86400', async () => {
    renderModal()
    await act(async () => setInput(nameInput(), 'tok'))
    await clickSave()
    expect(lastDetails().expirationDate).toBeUndefined()

    await act(async () => advancedToggle().click())
    await chooseOption(expiresCombo(), '1 天后')
    const now = Math.floor(Date.now() / 1000)
    await clickSave()
    const expires = lastDetails().expirationDate
    expect(expires).toBeGreaterThanOrEqual(now + 86400 - 5)
    expect(expires).toBeLessThanOrEqual(now + 86400 + 5)
  })

  it('自定义时间戳：空/非法解析为 undefined，过去时间戳原样提交（源码不做过去时间校验）', async () => {
    renderModal()
    await act(async () => setInput(nameInput(), 'tok'))
    await act(async () => advancedToggle().click())
    await chooseOption(expiresCombo(), '自定义时间戳')

    const custom = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(custom).not.toBeNull()
    await clickSave()
    expect(lastDetails().expirationDate).toBeUndefined()

    await act(async () => setInput(custom as HTMLInputElement, '1000000000'))
    await clickSave()
    expect(lastDetails().expirationDate).toBe(1000000000)

    await act(async () => setInput(custom as HTMLInputElement, ''))
    await clickSave()
    expect(lastDetails().expirationDate).toBeUndefined()
  })
})

describe('CookieEditModal 视图控制与国际化', () => {
  it('高级面板可收展，最大化按钮切换卡片样式与 aria-label', async () => {
    renderModal()
    expect(container.querySelector('.tw-cookie-modal__adv-panel')).toBeNull()
    await act(async () => advancedToggle().click())
    expect(container.querySelector('.tw-cookie-modal__adv-panel')).not.toBeNull()
    await act(async () => advancedToggle().click())
    expect(container.querySelector('.tw-cookie-modal__adv-panel')).toBeNull()

    expect(container.querySelector('.tw-cookie-modal')?.className).not.toContain('--maximized')
    const maximize = headIconButtons()[0]
    expect(maximize.getAttribute('aria-label')).toBe('最大化 / 全屏')
    await act(async () => maximize.click())
    expect(container.querySelector('.tw-cookie-modal')?.className).toContain(
      'tw-cookie-modal--maximized',
    )
    expect(headIconButtons()[0].getAttribute('aria-label')).toBe('还原窗口')
  })

  it('切换到英文后文案同步更新，且不出现裸 i18n key', async () => {
    renderModal()
    expect(title()).toBe('新增 Cookie')
    expect(cancelButton().textContent).toBe('取消')

    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(title()).toBe('Add Cookie')
    expect(cancelButton().textContent).toBe('Cancel')
    expect(container.textContent).toContain('Form')
    expect(container.textContent).toContain('Raw')
    expect(container.textContent).not.toMatch(/tool\.storage\.|common\./)
  })

  it('编辑与新建的标题不同，避免用户误判当前操作', () => {
    renderModal()
    expect(title()).toBe('新增 Cookie')
    renderModal({ cookie: makeCookie() })
    expect(title()).toBe('编辑 Cookie')
  })
})
