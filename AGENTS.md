# AGENTS.md

## 项目介绍

Chrome 扩展（Manifest V3），React 19 + TypeScript + Vite。内置 9 个开发/调试小工具：Base64、JSON、JWT、时间戳、Local Storage、URL、二维码、文件转 Base64、智能识别。

入口：Popup、Options、原生侧边栏、Content Script（网页内悬浮球 + 抽屉）、Background Service Worker。核心「工具箱页」`ToolsApp` 被侧边栏与网页内抽屉复用，工具显示/顺序由 Options 配置驱动，经 `chrome.storage.sync` 多端即时同步。支持中/英 i18n、深浅主题、字体缩放、悬浮球域名黑/白名单。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 浏览器预览 UI（无需扩展环境） |
| `pnpm build` | 完整构建：类型检查 + content→background→页面 |
| `pnpm type-check` | 仅 TypeScript 类型检查 |
| `pnpm lint` | ESLint 检查并自动修复（内含 Prettier） |
| `pnpm format` | Prettier 格式化 `src/` |

> 只能用 **pnpm**（npm/yarn 会被 `preinstall` 拦截）。

## 权限与工作区边界（安全红线）

- **权限仅限本项目**：AI 的一切读写、创建、修改、重命名及删除权限**仅严格限定在当前项目工作区根目录及其子目录内**。
- **严禁修改外部文件**：绝对禁止以任何理由修改、创建、覆写或删除本项目目录之外的任何文件或路径（包括但不限于用户家目录 `~`、上层目录 `..`、其他工程项目、系统文件 `/etc`、`/tmp`、`/var`、系统级配置文件等）。
- **命令执行边界限制**：所有终端命令的执行路径（Cwd）必须限定在本项目工作区内，严禁执行任何会对本项目外部环境产生副作用的命令（如跨目录 `rm`、`mv`、`cp`、向外部重定向写入 `>`、安装全局系统包等）。
- **遇外部引用需确认**：若任务涉及跨目录或外部依赖需求，必须主动向用户说明情况并征求确认，绝不可擅自向项目外部进行写操作。

## 任务编排（TASKS.md）

> 本仓库另有一份 `TASKS.md`，是 AI 编排任务的**唯一任务清单**。开始任何开发/排查前，先读 `TASKS.md`，并始终遵守其编排约定。

- **只推进**状态为 `[~]`（进行中）的任务；同一时刻尽量只保留一个进行中（除非任务明确可并行）。
- **完成后**：把该条改为 `[x]` 并在「结果」简述产出；再把下一个 `[ ]` 改为 `[~]` 继续推进。
- **遇到需人拍板的问题**：改为 `[!]`，在「阻塞原因」写清卡点与建议，**不要臆测硬做**。
- 若任务偏离「本次目标」，停下标注并等待确认。
- 具体任务与验收标准以 `TASKS.md` 当前列表为准；本文件的硬约定（核心/UI）与之同时生效。

## 架构地图（随项目演进更新）

```
src/
├─ background/          # Service Worker：右键菜单；sidePanel/open options 中转
├─ content/             # Content Script：Shadow DOM 注入悬浮球/抽屉/识别面板
├─ popup/ options/ sidepanel/  # 三个扩展页面（侧边栏复用 ToolsApp）
├─ tools/               # registry.ts(★工具唯一来源) + ToolsApp(★共享页) + {Tool}.tsx / {tool}.ts
├─ ui/                  # Icon / TkSelect / ConfirmDialog
├─ utils/               # messages(★消息协议) / env(chrome 降级) / settings / theme 等
└─ i18n/                # i18next + locales/{zh,en}.json
```

关键机制：
- **设置单向同步**：Options 写 `chrome.storage.sync.settings`，各端监听 `onChanged` 即时生效。
- **消息协议**：跨端通信统一走 `utils/messages.ts` 常量。
- **存储桥接**：扩展页无法直接读写网页 localStorage，由 content 的 `installStorageBridge()` 代读代写。
- **互斥**：网页内抽屉与原生侧边栏同一时刻只开一个。

## 核心硬约定（违反会导致扩展坏掉/被拒）

1. **权限受限于当前项目**：AI 的写操作（新增/修改/删除文件等）严格受限于本项目工作区，绝对禁止修改项目外的任何文件与系统配置。
2. **构建顺序不可乱**：content 先清空 `dist/`，background、页面随后追加；单跑任一 vite 配置会产出残缺产物。
3. **content/background 必须 IIFE**（`format:'iife'` + `inlineDynamicImports:true`），manifest 不支持 ESM。
4. **content 样式只走 Shadow DOM + `?inline` 内联**，直接 import CSS 会污染宿主页。
5. **所有 `chrome.*` 访问经 `utils/env.ts` 降级**（`isExtension()`/`storageGet/Set()`/`openOptionsPage()`），禁止裸调。
6. **新工具必须登记进 `tools/registry.ts`**（`ToolId` + `DEFAULT_TOOLS`），否则完全不可见。
7. **跨端消息 `action` 必须引用 `utils/messages.ts` 常量**，禁手写字符串。
8. **`settings` 读写经 `normalizeSettings`/`normalizeToolLayout` 兜底**，旧数据/残缺数据要兼容。
9. **content 开扩展页/侧边栏经 background 中转**（`sidePanel.open` 依赖手势，失败回退抽屉）。
10. **类型零错误**：`strict` + `noUnusedLocals/Parameters` 全开，构建前必须先过 `tsc`。

## UI 一致性硬约定（新增能力必须复用）

- **只用设计令牌**：颜色/字号/控件高/圆角/阴影全部走 `theme.css` 的 `--tk-*` 变量，禁硬编码；主题靠 `data-theme` 自动切换。
- **前缀分域**：`tk-*`(通用组件) / `tw-*`(工具箱) / `tek-*`(content 悬浮层) / `pop-*` `opt-*` `sp-*`(各宿主页)。
- **复用现成组件**：`.tk-btn`/`.tk-icon-btn`、`TkSelect`(禁用原生 select)、`ConfirmDialog`(禁用 window.confirm)、`Icon`(禁用 emoji)、`CopyButton`/`DownloadButton`/`StatusText`。
- **文案必须 i18n**：`t()` + 同步补 `zh.json`/`en.json`，禁硬编码；key 语义化（`tool.registry.<id>`、`settings.*`、`common.*` 等）。
- **入口统一挂三 hook**：`useLocale()` / `useFontScale()` / `useTheme()`。
- **路径别名**：用 `@/` 导入 `src/*`，不用深层相对路径（import 排序由 prettier 自动处理，提交前跑 `format`）。
- **全局滚动条严格统一**：全扩展所有滚动容器（宿主页面、侧边栏、抽屉 Shadow DOM、各类弹窗、下拉、表格、代码高亮区及多行输入框）统一复用 `theme.css` 根级定义的 6px 极简悬浮圆角滚动条（`scrollbar-width: thin; scrollbar-color: var(--tk-border-strong) transparent;` + 6px WebKit 胶囊滑块与透明轨道），严禁使用系统原生粗滚动条或各组件自造样式；横向药丸标签栏（`.tw-tabs`、`.tw-nav`、`.tw-detect__tabs`）强制隐藏滚动条（`scrollbar-width: none`）。
- **统一自上而下交互流与就近反馈**：所有工具必须遵循统一心智流：`输入源 ➔ 触发操作栏 ➔ 状态/错误反馈 ➔ 输出结果与视图配置`。报错或状态提示必须紧随操作按钮下方就近按需展示，严禁被空结果框隔开；全扩展保持纯净统一体验，无状态时不保留空白占位。

## 新增一个工具（标准流程）

以 id `foo`、组件 `FooTool` 为例：

1. `tools/registry.ts`：`ToolId` 加 `'foo'`，`DEFAULT_TOOLS` 加 `{ id:'foo', label:'Foo' }`（Options/选项卡自动出现）。
2. 纯逻辑 `tools/foo.ts`：无 React 依赖，文案走 `i18n.t()`。
3. UI 组件 `tools/FooTool.tsx`：`default export`，复用通用组件 + `tw-*`。
4. `ToolsApp.tsx`：`TOOL_COMPONENTS` 加 `foo: () => <FooTool />`。
5. i18n：`zh.json` + `en.json` 同步补 `tool.registry.foo` 及工具内部文案。
6. 样式加进 `tools.css`（`tw-*` + 令牌）。
7. （可选）`ui/Icon.tsx` 补图标；（可选）`tools/detect.ts` 接入智能识别。
8. 验证：`pnpm type-check && pnpm lint && pnpm build`。
