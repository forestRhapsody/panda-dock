import { describe, expect, it } from 'vitest'

import { detect } from './detect'

/** 断言识别结果的主体类型与复制内容 */
function expectKind(input: string, kind: string, copy?: string) {
  const res = detect(input)
  expect(res, `detect(${JSON.stringify(input)}) 应为非空`).not.toBeNull()
  expect(res?.kind).toBe(kind)
  if (copy !== undefined) expect(res?.copy).toBe(copy)
  return res
}

describe('detect：纯净目标', () => {
  it('纯 Base64 解码并保持「免高亮」（sourceMatches 为空）', () => {
    const res = expectKind('YWFh', 'base64', 'aaa')
    expect(res?.sourceMatches).toBeUndefined()
  })

  it('支持 4 字符标准最小单元（YQ== / YWI=）', () => {
    expectKind('YQ==', 'base64', 'a')
    expectKind('YWI=', 'base64', 'ab')
  })

  it('纯 JSON / URL / 时间戳 / UUID / Hex 各自命中正确类型', () => {
    expectKind('{"a":1}', 'json')
    expectKind('https://example.com/a', 'url')
    expectKind('1780000000', 'timestamp')
    expectKind('550e8400-e29b-41d4-a716-446655440000', 'uuid')
    expectKind('deadbeef', 'hex')
  })

  it('纯 Base64 解出 JSON 时给出格式化与压缩两份内容', () => {
    // {"a":1} 的 Base64
    const res = expectKind('eyJhIjoxfQ==', 'base64')
    const block = res?.blocks[0]
    expect(block?.json).toBe(true)
    expect(block?.formattedValue).toBe('{\n  "a": 1\n}')
    expect(block?.minifiedValue).toBe('{"a":1}')
  })

  it('纯 Data URL 识别 MIME 与体积', () => {
    const res = expectKind('data:image/png;base64,iVBORw==', 'dataurl')
    const fields = Object.fromEntries((res?.fields ?? []).map((f) => [f.key, f.value]))
    expect(fields.mime).toBe('image/png')
    expect(fields.bytes).toBe('4 B')
  })
})

describe('detect：Base64 误判护栏（T44 边界）', () => {
  it('普通 4 字母英文单词不被误判', () => {
    for (const word of ['this', 'that', 'word', 'test', 'code', 'from', 'have', 'more']) {
      expect(detect(word), `${word} 不应被识别`).toBeNull()
    }
  })

  it('普通英文句子不被误判', () => {
    for (const sentence of [
      'The quick brown fox jumps over the lazy dog',
      'This is a normal English sentence and it must not be parsed',
      "it's fine, don't worry",
    ]) {
      expect(detect(sentence), `${sentence} 不应被识别`).toBeNull()
    }
  })

  it('二进制字母串未命中已知文件魔数时不识别', () => {
    // 合法 Base64 但解出的字节既非可读文本、也不匹配任何文件头
    expect(detect('qwertyui')).toBeNull()
  })

  it('T136：全小写 4 字母词不再被误判，且 4 字符短密文支持零回归', () => {
    // 收紧前 file→"~)^"、edit→"yح"、aced→"iǝ"，现按「长度恰为 4 且全小写纯字母」直接排除
    for (const word of ['file', 'edit', 'aced', 'dead', 'beef', 'cafe']) {
      expect(detect(word), `${word} 不应被识别`).toBeNull()
    }
    // 含大写 / 数字 / padding 的 4 字符短密文仍正常解析（含单个中日韩字符的合法用例）
    const cases: [string, string][] = [
      ['YWFh', 'aaa'],
      ['YQ==', 'a'],
      ['YWI=', 'ab'],
      ['YWJj', 'abc'],
      ['aGk=', 'hi'],
      ['5L2g', '你'],
      ['5aW9', '好'],
      ['44GT', 'こ'],
    ]
    for (const [input, expected] of cases) {
      expect(detect(input)?.copy, `${input} 应解码为 ${expected}`).toBe(expected)
    }
  })
})

describe('detect：多候选与偏移', () => {
  const multi = '第一个 SGVsbG8gV29ybGQ= 第二个 YWJjZGVmZw== 结束'

  it('收集全部候选并默认激活第一项', () => {
    const res = detect(multi)
    expect(res?.items).toHaveLength(2)
    expect(res?.items?.map((i) => i.copy)).toEqual(['Hello World', 'abcdefg'])
    expect(res?.items?.every((i) => i.kind === 'base64')).toBe(true)
    expect(res?.copy).toBe('Hello World')
  })

  it('sourceMatches 记录精确偏移，且仅第一项为 active', () => {
    const res = detect(multi)
    const offset = multi.indexOf('SGVsbG8gV29ybGQ=')
    expect(res?.sourceMatches).toEqual([
      { text: 'SGVsbG8gV29ybGQ=', startIndex: offset, endIndex: offset + 16, active: true },
      {
        text: 'YWJjZGVmZw==',
        startIndex: multi.indexOf('YWJjZGVmZw=='),
        endIndex: multi.indexOf('YWJjZGVmZw==') + 12,
        active: false,
      },
    ])
  })

  it('实体与网址混合时严格按正文出现顺序排列', () => {
    const input = '甲 SGVsbG8gV29ybGQ= 乙 https://a.example.com/1 丙 YWJjZGVmZw== 丁'
    const res = detect(input)
    expect(res?.items?.map((i) => i.kind)).toEqual(['base64', 'url', 'base64'])
    const starts = (res?.items ?? []).map((i) => i.sourceMatch.startIndex)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(starts[0]).toBe(input.indexOf('SGVsbG8gV29ybGQ='))
    expect(res?.items?.[1].copy).toBe('https://a.example.com/1')
  })
})

describe('detect：外壳剥离与引用提取', () => {
  it('剥离 atob(...) 函数外壳并定位内部载荷', () => {
    const input = 'atob("SGVsbG8gV29ybGQ=")'
    const res = detect(input)
    expect(res?.kind).toBe('base64')
    expect(res?.copy).toBe('Hello World')
    expect(res?.sourceMatches?.[0]).toMatchObject({
      text: 'SGVsbG8gV29ybGQ=',
      startIndex: input.indexOf('SGVsbG8gV29ybGQ='),
    })
  })

  it('提取中文引号包裹的载荷', () => {
    const input = '哈哈“SGVsbG8gV29ybGQ=”'
    const res = detect(input)
    expect(res?.kind).toBe('base64')
    expect(res?.sourceMatches?.[0].startIndex).toBe(input.indexOf('SGVsbG8gV29ybGQ='))
  })

  it('夹在中文之间（无空格）的载荷可被挖掘', () => {
    const input = '这个密文SGVsbG8gV29ybGQ=发你'
    const res = detect(input)
    expect(res?.kind).toBe('base64')
    expect(res?.copy).toBe('Hello World')
  })

  it('英文撇号缩写不被当成成对引号', () => {
    expect(detect("it's a test")).toBeNull()
  })
})

describe('detect：输入防护', () => {
  it('空输入 / 纯空白 / 超长输入返回 null', () => {
    expect(detect('')).toBeNull()
    expect(detect('   ')).toBeNull()
    expect(detect('a'.repeat(50001))).toBeNull()
  })

  it('普通短数字不识别为时间戳', () => {
    expect(detect('200')).toBeNull()
    expect(detect('2025')).toBeNull()
  })

  it('系统与软件版本信息不误判为时间戳', () => {
    expect(detect('Debian GNU/Linux 12 (bookworm)')).toBeNull()
    expect(detect('"Debian GNU/Linux 12 (bookworm)"')).toBeNull()
    expect(detect('Ubuntu 22.04')).toBeNull()
    expect(detect('Linux 12')).toBeNull()
    expect(detect('Test 12')).toBeNull()
    expect(detect('Page-12')).toBeNull()
  })
})
