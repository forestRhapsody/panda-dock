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
  pages/home Popup 首页展示组件
  utils/     env(扩展环境守卫) / messages(协议) / clipboard / sidePanel / storage 桥接
vite.config.ts            → 页面多入口构建（base:'./'）
vite.content.config.ts    → content script 打成单个 IIFE（不清空 → 见 build 顺序）
vite.background.config.ts → service worker 打成单个 IIFE
```

## 核心硬约定（违反会导致扩展坏掉/被拒）

1. **两处"非模块"产物必须 IIFE 单文件**：MV3 的 `content_scripts` 与默认 service worker 不能是 ES Module。新增这类入口时仿照 `vite.content.config.ts` / `vite.background.config.ts`（注意 build 顺序：content 先清空 dist，其余 `emptyOutDir:false` 追加）。
2. **Content Script 的样式只准进 Shadow DOM**：样式以 `?inline` 字符串拼进 Shadow Root 的 `<style>`（见 `src/content/main.tsx`）；**禁止**向网页 `<head>`/文档注入 `<link>` 或全局样式（会污染宿主页面 = 最严重事故）。类名前缀：content=`tek-`，工具箱=`tw-`，options=`opt-`，popup=`pop-`，home=`hm-`，preview=`pv-`。
3. **所有 `chrome.*` 调用必须可降级**：`pnpm dev` 浏览器里没有 chrome；凡访问前先 `isExtension()`/`typeof chrome !== 'undefined'` 守卫（参考 `src/utils/env.ts`）。扩展内部（popup/options/sidepanel）与 content script 可用 API 集合不同，跨上下文交互一律走 `src/utils/messages.ts` 里定义的消息（加新消息要同步两端）。
4. **用户手势限制**：`chrome.sidePanel.open()` 必须带 `windowId/tabId` 且在扩展页面里以用户点击触发；从 content script 经消息中转基本会被 Chrome 拒绝——不要承诺"悬浮球唤起原生侧边栏 100% 可行"，失败要优雅回退（回退到抽屉并提示）。
5. **不加新权限**：除非用户明确同意，不往 manifest `permissions` 加项（contextMenus、notifications 等都会再次弹提示）。悬浮球/抽屉用的是已声明的 `content_scripts http(s)` + `storage` + `sidePanel`。
6. **页面侵入最小化**：不在网页上凭空显示高亮/弹层/改动页面元素；需要"就地能力"时优先复用悬浮球/抽屉/工具箱自身 UI。
7. **配置持久化**：chrome.storage.sync 单一对象存 `settings`（Options 里 `normalizeSettings` 兜底旧数据缺字段）；local 存 `toolkit.ballPos`、`toolkit.drawerWidth`。增删配置字段要同时更新 Options 读写与消费方（含 content 的即时同步 onChanged）。

## 新增一个工具（标准流程）

1. `src/tools/registry.ts` 注册 `{ id, label }`（默认顺序即展示顺序，Options 可改）
2. `src/tools/` 下写工具组件（样式进 `tools.css`，前缀 `tw-`；复制工具用 `@/utils/clipboard`）
3. `src/tools/ToolsApp.tsx` 的 `TOOL_COMPONENTS` 补分支（自动滚动/显隐排序均无需额外处理）
4. 若工具依赖页面上下文（localStorage 等），阅读 `src/tools/storage.ts` 的桥接模式（侧边栏→content）
5. `pnpm lint && pnpm build`，刷新扩展验证；更新 `TASKS.md`/README

## 检查清单

- [ ] lint / build 通过
- [ ] 真实 Chrome 里重载验证（不只是 `pnpm dev`）
- [ ] content script 改动后刷新了目标网页
- [ ] 页面无样式污染、无多余权限请求
- [ ] 消息协议两端同步、chrome 缺失时优雅降级
- [ ] TASKS.md 同步
