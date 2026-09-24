/**
 * 多行框的 Tab 缩进（纯逻辑，DOM 写入见 useTabIndent）。
 * 约定与主流代码编辑器一致：
 * - 光标折叠时 Tab 在光标处插入一个缩进单元（不是把整行推走）；
 * - 有选区时对选区覆盖到的整行缩进 / 反缩进，选区保持覆盖整块，可连续按 Tab 层层缩进。
 */

/** 缩进单元：与 JSON 工作台的格式化缩进（`JSON.stringify(x, null, 2)`）保持一致 */
export const TAB_INDENT = '  '

export interface TabIndentEdit {
  value: string
  /** 编辑后的新选区 */
  start: number
  end: number
}

function lineStartOf(value: string, index: number): number {
  return value.lastIndexOf('\n', index - 1) + 1
}

function lineEndOf(value: string, index: number): number {
  const nl = value.indexOf('\n', index)
  return nl === -1 ? value.length : nl
}

/** 去掉行首最多一个缩进单元（空格 / Tab 混排按字符数算），返回剩余文本与去掉的字符数 */
function stripIndent(line: string, width: number): { text: string; removed: number } {
  let removed = 0
  while (removed < width && (line[removed] === ' ' || line[removed] === '\t')) removed++
  return { text: line.slice(removed), removed }
}

export function computeTabIndent(
  value: string,
  selStart: number,
  selEnd: number,
  dedent = false,
  indent = TAB_INDENT,
): TabIndentEdit {
  const start = Math.max(0, Math.min(selStart, selEnd))
  const end = Math.min(value.length, Math.max(selStart, selEnd))
  const collapsed = start === end

  // 折叠光标 + Tab：在光标处插入缩进
  if (collapsed && !dedent) {
    const caret = start + indent.length
    return {
      value: `${value.slice(0, start)}${indent}${value.slice(end)}`,
      start: caret,
      end: caret,
    }
  }

  const blockStart = lineStartOf(value, start)
  // 选区正好停在行首时，最后一行不在选区内，否则会多缩进一行
  const blockEnd =
    !collapsed && end > 0 && value[end - 1] === '\n' ? end - 1 : lineEndOf(value, end)
  const lines = value.slice(blockStart, blockEnd).split('\n')

  let added = 0
  let removedFirst = 0
  let removedTotal = 0
  const nextLines = lines.map((line, idx) => {
    if (!dedent) {
      // 空行不补缩进，避免留下只有空白的行
      const add = line ? indent : ''
      added += add.length
      return add + line
    }
    const { text, removed } = stripIndent(line, indent.length)
    if (idx === 0) removedFirst = removed
    removedTotal += removed
    return text
  })

  const nextValue = value.slice(0, blockStart) + nextLines.join('\n') + value.slice(blockEnd)

  // 折叠光标的反缩进：光标跟着被删掉的空白左移，最多退到行首
  if (collapsed) {
    const caret = start - Math.min(removedFirst, start - blockStart)
    return { value: nextValue, start: caret, end: caret }
  }

  return dedent
    ? { value: nextValue, start: blockStart, end: blockEnd - removedTotal }
    : { value: nextValue, start: blockStart, end: blockEnd + added }
}
