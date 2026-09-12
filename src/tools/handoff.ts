import { getDraftValue, setDraftValue } from '@/utils/draft'
import { storageGet, storageSet } from '@/utils/env'

import type { DetectKind } from './detect'
import { DEFAULT_JSON_DRAFT, JSON_DRAFT_KEY } from './JsonTool'
import type { ToolId } from './registry'

/**
 * 「智能解析结果 → 对应工具」的手递手（T134）。
 *
 * 只保留**目标工具确有额外能力**的两个映射：评估确认时间戳 / JWT 的展示早已与各自工具对齐
 * （见 T110 / T113 / T122），base64 的方向相反（解析出来的是已解码内容，送过去只能再编码），
 * hex 在其它工具里没有对应能力——给它们加入口只会让用户点过去发现「跟刚才看到的一样」。
 */
const KIND_TOOL: Partial<Record<DetectKind, ToolId>> = {
  json: 'json',
  url: 'url',
}

/** 该解析类型是否有可跳转的目标工具（无则结果区不渲染入口） */
export function toolForDetectKind(kind: DetectKind): ToolId | null {
  return KIND_TOOL[kind] ?? null
}

/** 各工具「主输入」的草稿 key。新增映射时必须在这里补上，否则按「不支持」处理 */
const DETECT_INPUT_KEY = 'detect.input'
const URL_PARSE_INPUT_KEY = 'url.parse.input'
const URL_TAB_KEY = 'url.tab'
const ACTIVE_TAB_KEY = 'activeToolTab'

/**
 * 把文本写进目标工具的输入草稿，并激活该工具（必要时自动启用）。
 * 只负责「让目标工具就位」，不负责打开宿主——各宿主（侧边栏 / 网页抽屉 / 已在工具箱内）
 * 自行决定唤起方式。
 */
export async function prepareToolHandoff(tool: ToolId, text: string): Promise<void> {
  if (tool === 'detect') {
    // 划选面板的「在侧边栏中打开」走这里：把选中文本带回智能解析工具
    await setDraftValue(DETECT_INPUT_KEY, text)
  } else if (tool === 'json') {
    // JSON 工具用的是**对象草稿**：保留用户已有的缩进 / 排序 / 分屏偏好，只替换输入并清空上次输出
    const stored = await getDraftValue<typeof DEFAULT_JSON_DRAFT>(JSON_DRAFT_KEY)
    await setDraftValue(JSON_DRAFT_KEY, {
      ...(stored ?? DEFAULT_JSON_DRAFT),
      input: text,
      output: '',
      lastAction: null,
    })
  } else if (tool === 'url') {
    await setDraftValue(URL_PARSE_INPUT_KEY, text)
    // 用户上次若停在「网址编解码」页，送进来的网址应回到解析页
    await setDraftValue(URL_TAB_KEY, 'parse')
  } else {
    return
  }

  await setDraftValue(ACTIVE_TAB_KEY, tool)

  // 工具被禁用时自动启用，否则切换过去会落到别的 Tab（与 T49 带入侧边栏的行为保持一致）
  const cur = await storageGet<{ toolEnabled?: Record<string, boolean> }>('sync', 'settings')
  if (cur?.toolEnabled && cur.toolEnabled[tool] === false) {
    await storageSet('sync', 'settings', {
      ...cur,
      toolEnabled: { ...cur.toolEnabled, [tool]: true },
    })
  }
}
