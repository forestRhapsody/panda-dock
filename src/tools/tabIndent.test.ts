import { describe, expect, it } from 'vitest'

import { computeTabIndent } from './tabIndent'

/**
 * Tab / Shift+Tab 的缩进计算是纯函数，DOM 写入与键盘门控在 useTabIndent（见 AutoArea.dom.test.tsx）。
 * 这里守住的核心不变量：折叠光标插入、多行整块缩进可连续按、反缩进最多吃一个缩进单元、
 * 选区停在行首时不牵连下一行、光标不会因反缩进越界到上一行。
 */
describe('computeTabIndent', () => {
  it('光标折叠：在光标处插入一个缩进单元，光标随之右移', () => {
    expect(computeTabIndent('a=1', 3, 3)).toEqual({ value: 'a=1  ', start: 5, end: 5 })
  })

  it('选中片段的单行：整行缩进，选区覆盖整块（可连续按 Tab）', () => {
    const once = computeTabIndent('a=1; b=2', 1, 3)
    expect(once).toEqual({ value: '  a=1; b=2', start: 0, end: 10 })
    const twice = computeTabIndent(once.value, once.start, once.end)
    expect(twice.value).toBe('    a=1; b=2')
  })

  it('多行选区：每行都缩进，空行不补空白', () => {
    const res = computeTabIndent('{\n\n"a": 1\n}', 0, 11)
    expect(res.value).toBe('  {\n\n  "a": 1\n  }')
    expect({ start: res.start, end: res.end }).toEqual({ start: 0, end: 17 })
  })

  it('Shift+Tab：多行反缩进最多去掉一个缩进单元，空格与制表符混排都能去', () => {
    const res = computeTabIndent('  {\n\t"a": 1\n  }', 0, 15, true)
    expect(res.value).toBe('{\n"a": 1\n}')
    expect({ start: res.start, end: res.end }).toEqual({ start: 0, end: 10 })
  })

  it('折叠光标反缩进：光标跟着左移，最多退到行首', () => {
    expect(computeTabIndent('  abc', 4, 4, true)).toEqual({ value: 'abc', start: 2, end: 2 })
    // 光标已在缩进之前，不能越界到上一行
    expect(computeTabIndent('  abc', 0, 0, true)).toEqual({ value: 'abc', start: 0, end: 0 })
  })

  it('选区正好停在行首时，不牵连下一行', () => {
    const res = computeTabIndent('a\nb\nc', 0, 2)
    expect(res.value).toBe('  a\nb\nc')
    expect({ start: res.start, end: res.end }).toEqual({ start: 0, end: 3 })
  })

  it('缩进单元可自定义（如制表符）', () => {
    expect(computeTabIndent('x', 0, 0, false, '\t')).toEqual({ value: '\tx', start: 1, end: 1 })
    expect(computeTabIndent('\tx', 1, 1, true, '\t')).toEqual({ value: 'x', start: 0, end: 0 })
  })
})
