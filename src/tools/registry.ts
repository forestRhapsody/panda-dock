/** 工具箱工具注册表：工具的唯一事实来源（id / 显示名 / 默认顺序）。
 *  新增工具：1) 在这里登记；2) 在 ToolsApp 里补组件映射；3) Options 配置列表自动出现。
 *  label 为英文规范名；界面显示经 `t(\`tool.registry.${id}\`)` 本地化（见 ToolsApp / Options）。 */

export type ToolId = 'base64' | 'json' | 'jwt' | 'timestamp' | 'storage'

export interface ToolMeta {
  id: ToolId
  label: string
  /** 排序用序号，默认顺序即注册顺序 */
}

export const DEFAULT_TOOLS: ToolMeta[] = [
  { id: 'base64', label: 'Base64' },
  { id: 'json', label: 'JSON' },
  { id: 'jwt', label: 'JWT' },
  { id: 'timestamp', label: 'Timestamp' },
  { id: 'storage', label: 'Local Storage' },
]

export function isToolId(value: unknown): value is ToolId {
  return DEFAULT_TOOLS.some((t) => t.id === value)
}

/** 工具显示配置：顺序（含被隐藏的工具）+ 显隐 map */
export interface ToolLayout {
  /** 所有工具的展示顺序（未被工具列表收录的 id 会被剔除） */
  order: ToolId[]
  /** 是否显示（缺省为 true） */
  enabled: Record<string, boolean>
}

export function defaultToolLayout(): ToolLayout {
  return {
    order: DEFAULT_TOOLS.map((t) => t.id),
    enabled: Object.fromEntries(DEFAULT_TOOLS.map((t) => [t.id, true])),
  }
}

/** 归一化存储的配置：保证包含全部已注册工具且顺序完整 */
export function normalizeToolLayout(storedOrder?: unknown, storedEnabled?: unknown): ToolLayout {
  const enabledRaw = (storedEnabled ?? {}) as Record<string, unknown>
  const ordered = Array.isArray(storedOrder) ? (storedOrder as unknown[]).filter(isToolId) : []
  // 去重并按存储顺序排列
  const seen = new Set<ToolId>()
  const order: ToolId[] = []
  for (const id of ordered) {
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
  }
  // 追加未出现在存储里的新工具（保持注册表默认顺序，出现在尾部）
  for (const t of DEFAULT_TOOLS) {
    if (!seen.has(t.id)) order.push(t.id)
  }
  const enabled: Record<string, boolean> = {}
  for (const t of DEFAULT_TOOLS) {
    enabled[t.id] = enabledRaw[t.id] !== false
  }
  return { order, enabled }
}

/** 根据配置得到最终要展示的工具（顺序 = 可见且注册的工具顺序） */
export function visibleTools(layout: ToolLayout): ToolMeta[] {
  const byId = new Map(DEFAULT_TOOLS.map((t) => [t.id, t]))
  return layout.order
    .filter((id) => layout.enabled[id] !== false && byId.has(id))
    .map((id) => byId.get(id)!)
}
