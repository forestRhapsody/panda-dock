# AGENTS.md

> 给在仓库里工作的 AI / 协作者看的项目守则。
> 先读本文再动手；遇到与事实不符的地方，改本文而不是绕开约定。

## 项目是什么

Chrome 扩展（Manifest V3）：一个「开发者工具箱」，形态 = 工具栏 Popup + 原生 Side Panel 侧边栏 + 网页内悬浮球/抽屉（Content Script 注入），工具箱页由 Base64 / JSON / JWT / 时间戳 / 本地存储等工具组成。

- 栈：React 19 + Vite 7 + TypeScript（pnpm 10、Node ≥ 20）
- 仓库：`git@github.com:forestRhapsody/dev-box.git`
- 产品路线/任务清单见 `TASKS.md`；当前方向是「网页就地工具 + 可配置工具箱」，轻量高效，侵入性低，可配置

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 浏览器内开发预览全部 UI（`index.html`）；chrome API 缺失时自动降级 |
| `pnpm build` | 完整构建到 `dist/`（type-check + content + background + 页面 四段） |
| `pnpm lint` | ESLint 全量自动修复（含 prettier 格式） |
| `pnpm type-check` | `tsc -b` 类型检查 |
| `pnpm icons` | 重新生成 `public/icons/*.png` 占位图标 |

## 工作流约定

1. **动代码前**：读相关文件与 `TASKS.md`；不确定就先向用户确认，不要猜需求方向。
2. **每次改动后**：必须 `pnpm lint` + `pnpm build` 通过；`dist/` 不入库（已在 .gitignore）。
3. Content Script 改动后验证：扩展管理页「重新加载」并**刷新目标网页**；弹窗/侧边栏改动重载即可。
4. 任务完成后更新 `TASKS.md`（勾选 + 变更记录）。

## 架构地图（随项目演进更新）

```
index.html / popup.html / options.html / sidepanel.html   → 各页面入口（vite 多入口）
public/manifest.json                                      → MV3 配置（构建时复制进 dist）
src/
  popup/     Popup 弹窗（含「在浏览器侧边栏打开」）
  options/   Options 设置页（悬浮球行为 / 工具箱能力显隐排序）
  sidepanel/ 原生 Side Panel 页（承载 ToolsApp）
  content/   Content Script：悬浮球(FloatingBall) + 抽屉(Drawer) + 工具箱浮层
  background/ Service Worker（sidePanel 唤起中转等）
  tools/     共享「工具箱」：registry(工具注册) + ToolsApp + 各工具组件
  ui/        共享 UI 基础：Icon.tsx(内联 SVG 图标集) + ui.css(按钮体系 tk-btn/tk-icon-btn)
  pages/home Popup 首页展示组件
  utils/     env(扩展环境守卫) / messages(协议) / clipboard / sidePanel / storage 桥接
vite.config.ts            → 页面多入口构建（base:'./'）
vite.content.config.ts    → content script 打成单个 IIFE（不清空 → 见 build 顺序）
vite.background.config.ts → service worker 打成单个 IIFE
```

## 核心硬约定（违反会导致扩展坏掉/被拒）

1. **两处"非模块"产物必须 IIFE 单文件**：MV3 的 `content_scripts` 与默认 service worker 不能是 ES Module。新增这类入口时仿照 `vite.content.config.ts` / `vite.background.config.ts`（注意 build 顺序：content 先清空 dist，其余 `emptyOutDir:false` 追加）。
2. **Content Script 的样式只准进 Shadow DOM**：样式以 `?inline` 字符串拼进 Shadow Root 的 `<style>`（见 `src/content/main.tsx`）；**禁止**向网页 `<head>`/文档注入 `<link>` 或全局样式（会污染宿主页面 = 最严重事故）。类名前缀：content=`tek-`，工具箱=`tw-`，options=`opt-`，popup=`pop-`，home=`hm-`，preview=`pv-`，共享 UI（`src/ui/`）=`tk-`。图标一律用 `src/ui/Icon.tsx` 的内联 SVG，不用 emoji。
3. **所有 `chrome.*` 调用必须可降级**：`pnpm dev` 浏览器里没有 chrome；凡访问前先 `isExtension()`/`typeof chrome !== 'undefined'` 守卫（参考 `src/utils/env.ts`）。扩展内部（popup/options/sidepanel）与 content script 可用 API 集合不同，跨上下文交互一律走 `src/utils/messages.ts` 里定义的消息（加新消息要同步两端）。
4. **用户手势限制**：`chrome.sidePanel.open()` 必须带 `windowId/tabId` 且在扩展页面里以用户点击触发；从 content script 经消息中转基本会被 Chrome 拒绝——不要承诺"悬浮球唤起原生侧边栏 100% 可行"，失败要优雅回退（回退到抽屉并提示）。
5. **不加新权限**：除非用户明确同意，不往 manifest `permissions` 加项（contextMenus、notifications 等都会再次弹提示）。悬浮球/抽屉用的是已声明的 `content_scripts http(s)` + `storage` + `sidePanel`。
6. **页面侵入最小化**：不在网页上凭空显示高亮/弹层/改动页面元素；需要"就地能力"时优先复用悬浮球/抽屉/工具箱自身 UI。
7. **配置持久化**：chrome.storage.sync 单一对象存 `settings`（Options 里 `normalizeSettings` 兜底旧数据缺字段）；local 存 `toolkit.ballPos`、`toolkit.drawerWidth`。增删配置字段要同时更新 Options 读写与消费方（含 content 的即时同步 onChanged）。

## UI 一致性硬约定（新增能力必须复用）

**新能力/新工具的界面不得自创一套样式**，必须直接复用下面的共享构件与类名，保证各工具观感一致（布局、间距、圆角、配色、字号全走 `theme.css` 设计令牌）。这是合并门槛，不是建议。

| 场景 | 复用 | 备注 |
| --- | --- | --- |
| 工具卡片外壳 | `tw-card` | 每个工具的根容器 |
| 能力内子切换（编解码/格式化压缩/存储区/生成解析…） | `src/tools/ToolTabs.tsx` | 别手写一组 `.tw-tabs__btn` |
| 字段 label | `tw-field` / `tw-field__label` | 字段标题 + 右侧动作位（复制按钮等） |
| 多行输入/只读输出 | `AutoArea` + `tw-area`（输出可加 `--result`/`--tall`） | 别用裸 `<textarea>` |
| 单行输入 / 筛选 | `tw-input` | 高度统一为 `--tk-control-h`；不要往下叠加小号高度 |
| 下拉选择 | `src/ui/TkSelect.tsx`（默认 `md`） | 与同排输入框同高 `--tk-control-h`；`variant='sm'` 仅用于**真正紧凑**场景（如弹窗快捷设置、头部动作），不要为此让工具箱里的下拉显得比旁边的输入框矮 |
| 按钮 | `ui.css` 的 `tk-btn`（主按钮 `--primary`，紧凑 `--sm`），通栏 `--block` | **工具内禁用**新按钮样式 |
| 复制 | `src/tools/CopyButton.tsx` | 图标/文字变体；失败回调接状态 |
| 图标 | `src/ui/Icon.tsx` 内联 SVG | **禁用 emoji** |
| 状态提示 | `src/tools/StatusText.tsx` + `ToolStatus` 类型 | `kind='ok'\|'err'\|'info'` |
| 确认弹窗 | `src/ui/ConfirmDialog.tsx`（`.tk-modal`） | 替代 `window.confirm`（content 抽屉里会被禁用）；Escape/点遮罩取消 + 聚焦确定 |
| 说明/切分 | `tw-note` / `tw-status--*` / `tw-actions` | 灰色说明、状态行、按钮行 |
| 颜色/圆角/阴影/字色 | 只用 `var(--tk-*)` | 禁止硬编码色值、圆角、shadow |

硬约束：
- 类名前缀：content=`tek-`、工具=`tw-`、options=`opt-`、popup=`pop-`、共享 UI（`src/ui/`）=`tk-`；新工具样式一律进 `tools.css`，不要在组件文件里写 `<style>` 或内联样式刷色。
- 只有"确实无法用以上构件表达、且全工具唯一"的定制（如二维码画布、拖拽上传区）才允许新增 `tw-` 类，且要写注释说明为何不复用。
- 新增公共构件时优先放进 `src/tools/`（工具间共享）或 `src/ui/`（跨入口共享），并在本节登记一行，避免各工具各写一套。

## 新增一个工具（标准流程）

1. `src/tools/registry.ts` 注册 `{ id, label }`（默认顺序即展示顺序，Options 可改）
2. `src/tools/` 下写工具组件；界面**先对照「UI 一致性硬约定」的构件表**复用，样式进 `tools.css`（前缀 `tw-`），复制工具用 `@/utils/clipboard`
3. `src/tools/ToolsApp.tsx` 的 `TOOL_COMPONENTS` 补分支（自动滚动/显隐排序均无需额外处理）
4. 若工具依赖页面上下文（localStorage 等），阅读 `src/tools/storage.ts` 的桥接模式（侧边栏→content）
5. `pnpm lint && pnpm build`，刷新扩展验证；更新 `TASKS.md`/README

## 检查清单

- [ ] lint / build 通过
- [ ] 真实 Chrome 里重载验证（不只是 `pnpm dev`）
- [ ] content script 改动后刷新了目标网页
- [ ] 页面无样式污染、无多余权限请求
- [ ] 消息协议两端同步、chrome 缺失时优雅降级
- [ ] 新增能力复用了统一 UI 构件（无自创样式 / emoji / 硬编码色值，见「UI 一致性硬约定」）
- [ ] TASKS.md 同步
