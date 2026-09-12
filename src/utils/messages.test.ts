import { describe, expect, it } from 'vitest'

import { ERROR_CODES, errorResponse, isErrorCode } from './messages'

/**
 * 跨端协议的两条硬约束（AGENTS.md §4 第 6 条）：
 * - background 只回错误码，文案由 UI 侧按语言映射，所以错误码必须是稳定、可穷举、无歧义的；
 * - 新增 handler 统一走 `{ ok:false, code }`，不能再产出旧版 `{ ok:false, error }`——
 *   后者把面向用户的文案写死在 Service Worker 里，英文界面会显示中文。
 */

describe('ERROR_CODES 注册表', () => {
  it('非空且无重复（重复会让 isErrorCode 与 UI 映射表出现歧义）', () => {
    expect(ERROR_CODES.length).toBeGreaterThan(0)
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })

  it('每个码都是 ERR_ 前缀的大写常量', () => {
    for (const code of ERROR_CODES) {
      expect(code).toMatch(/^ERR_[A-Z0-9_]+$/)
    }
  })

  it('保留兜底码 ERR_UNEXPECTED（未预期异常必须有统一出口）', () => {
    expect(ERROR_CODES).toContain('ERR_UNEXPECTED')
  })
})

describe('isErrorCode 的运行时判定', () => {
  it.each(ERROR_CODES)('已注册的 %s 判定为 true', (code) => {
    expect(isErrorCode(code)).toBe(true)
  })

  it.each<[string, string]>([
    ['未注册但格式相同', 'ERR_NOT_REGISTERED'],
    ['大小写不一致', 'err_unexpected'],
    ['只有前缀', 'ERR_'],
    ['空字符串', ''],
    ['尾部带空格', `${ERROR_CODES[0]} `],
    ['只是错误码的子串', ERROR_CODES[0].slice(0, -1)],
  ])('%s的字符串判定为 false', (_label, value) => {
    expect(isErrorCode(value)).toBe(false)
  })

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['null', null],
    ['数字', 1],
    ['布尔值', false],
    ['对象', { code: ERROR_CODES[0] }],
    ['数组', [ERROR_CODES[0]]],
    ['函数', () => ERROR_CODES[0]],
    ['Symbol', Symbol('ERR_UNEXPECTED')],
  ])('非字符串（%s）判定为 false，交由 UI 兜底文案处理', (_label, value) => {
    expect(isErrorCode(value)).toBe(false)
  })

  it('对 errorResponse 产出的每个码都能再次识别（往返一致）', () => {
    for (const code of ERROR_CODES) {
      expect(isErrorCode(errorResponse(code).code)).toBe(true)
    }
  })
})

describe('errorResponse 的响应结构', () => {
  it('带 detail 时同时携带 code 与 detail，且没有旧版 error 字段', () => {
    const res = errorResponse('ERR_COOKIE_SET_FAILED', 'Invalid domain')
    expect(res).toEqual({ ok: false, code: 'ERR_COOKIE_SET_FAILED', detail: 'Invalid domain' })
    expect(Object.keys(res).sort()).toEqual(['code', 'detail', 'ok'])
    expect(res).not.toHaveProperty('error')
  })

  it('不带 detail 时结构里没有 detail 键（而不是 detail: undefined）', () => {
    const res = errorResponse('ERR_NO_TARGET_URL')
    expect(res).toEqual({ ok: false, code: 'ERR_NO_TARGET_URL' })
    expect(Object.keys(res).sort()).toEqual(['code', 'ok'])
    expect('detail' in res).toBe(false)
  })

  it('detail 为空串时同样不产出 detail 键', () => {
    const res = errorResponse('ERR_UNEXPECTED', '')
    expect(res).toEqual({ ok: false, code: 'ERR_UNEXPECTED' })
    expect('detail' in res).toBe(false)
  })

  it('ok 恒为 false，且不等价于旧的 { ok:false, error } 结构', () => {
    const res = errorResponse('ERR_UNEXPECTED', 'boom')
    expect(res.ok).toBe(false)
    // 旧 handler 会把面向用户的文案放进 error；新结构禁止在 background 里携带文案
    expect(res).not.toEqual({ ok: false, error: 'boom' })
    expect(JSON.stringify(res)).not.toContain('"error"')
  })
})
