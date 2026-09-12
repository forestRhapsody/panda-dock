# AGENTS.md

> 本文件是项目的工程约定**唯一出处**，写给在此仓库工作的编码代理（人类贡献者按同样规则提交即可）。
> 只写「改哪里」与「怎么改才对」；项目介绍、截图与终端用户安装说明属 README 范畴。
> 与代码注释冲突时以本文件为准；要改约定，就连同代码一起改。

## 1 项目速览

Panda Dock：Chrome 扩展（Manifest V3）开发者工具箱。

五个入口：Popup、Options、原生侧边栏、网页内 Content Script（悬浮球 / 抽屉 / 划选解析面板）、Background Service Worker。侧边栏与网页抽屉复用同一个工具箱页。

9 个工具 id（**改动一律以 id 为准**，显示名由 i18n 提供）：

| id | 默认可见 |
| --- | --- |
| `detect` | ✓ |
| `storage` | ✓ |
| `base64` | ✓ |
| `json` | ✓ |
| `url` | ✓ |
| `timestamp` | ✓ |
| `qrcode` | ✓ |
| `jwt` | ✗ |
| `hash` | ✗ |

表格顺序 = 注册表顺序 = 默认选项卡顺序。后两个默认隐藏（`DEFAULT_HIDDEN_TOOLS`），用户可在 Options 开启；**顺序与显隐是用户配置，不要写死假设**。

## 2 命令

只能使用 pnpm（`preinstall` 会用 `only-allow` 拦截 npm / yarn）。

| 命令 | 作用与注意 |
| --- | --- |
| `pnpm dev` | 浏览器预览 UI，无需扩展环境（`chrome.*` 自动降级） |
| `pnpm build` | 类型检查（内含 `tsc -b`）+ 打包，顺序 content → background → 页面。**顺序不可乱**（content 先清空 `dist/`）；**不跑测试**；只在交付门禁或要装进浏览器实测时跑（§7） |
| `pnpm type-check` | 仅 `tsc -b`（实测 ~5s）；`pnpm build` 已包含它 |
| `pnpm lint` | ESLint **自动修复**（只覆盖 ts/tsx/js/jsx；css/json 的格式化归 `pnpm format`） |
| `pnpm lint:check` | 只读校验；**CI 用这个**——`lint` 会改写工作区 |
| `pnpm test <文件名片段>` | **过程验证的默认手段**：只跑匹配到的测试文件（`pnpm test theme`、`pnpm test HighlightArea`），实测 ~1s |
| `pnpm test` | 全量单测（76 files / ~1900 例 / 实测 ~11s）。**默认不跑**，只在交付门禁或改动基础全局逻辑时跑（§7） |
| `pnpm test:changed` | 只跑与当前 git 改动有依赖关系的测试（`vitest run --changed`）。成本随波及面走（工作区改了 20+ 文件时实测 ≈ 全量）；筛选不到任何文件会直接失败 |
| `pnpm test:watch` | 交互式监听；**人类专用，代理禁用**（会一直挂住会话） |
| `pnpm format` | Prettier **只覆盖 `src/`**；根配置（`vite*.config.ts`、`vitest.config.ts`、`eslint.config.js`）要手动格式化 |
| `pnpm icons` | 生成 `public/icons/*.png` |

**验证级别**：迭代时默认只做过程验证——「改了什么 → 跑哪条命令」见 §7.1；全量门禁只在收尾时跑一次（§7.2）。

装载扩展：`pnpm build` 后在 `chrome://extensions` 开启开发者模式 → 加载 `dist/`。

## 3 目录地图

**唯一来源**（改这些等于改全局行为，别在别处复制同样的信息）：

| 文件 | 是什么的唯一来源 |
| --- | --- |
| `src/tools/registry.ts` | 工具清单：`ToolId`、`DEFAULT_TOOLS`、默认隐藏集 |
| `src/tools/ToolsApp.tsx` | 工具箱页 + 工具组件映射（侧边栏与抽屉共用） |
| `src/utils/messages.ts` | 跨端消息 `MSG_*` 常量 + 跨端错误码 `ERROR_CODES` |
| `src/utils/env.ts` | 全部 `chrome.*` 访问的降级封装 |
| `src/utils/settings.ts` | `Settings` 类型、默认值、归一化，以及写入入口 `saveSettings` |
| `src/theme.css` | 设计令牌 `--tk-*`、主题切换、全局滚动条 |
| `src/i18n/locales/{zh,en}.json` | 应用内全部文案 |
| `public/_locales/{zh_CN,en}/messages.json` | 清单级文案（商店页、快捷键页、右键菜单） |
| `public/manifest.json` | 权限、入口、快捷键、content script 声明 |

**目录职责：**

- `src/background/` — Service Worker：右键菜单、快捷键分发、Cookie 读写、侧边栏开合中转
- `src/content/` — Content Script：Shadow DOM 注入悬浮球 / 抽屉 / 划选面板（**样式只能内联**）
- `src/popup/` `src/options/` `src/sidepanel/` — 三个扩展页面，各自带 `index.css`（前缀 `pop-*` / `opt-*` / `sp-*`）
- `src/tools/` — 工具层：`{Tool}.tsx` 组件、`{tool}.ts` 纯逻辑、共享件（`AutoArea` / `JsonHighlight` / `CopyButton` / `ToolTabs` / `StatusText` / 编辑弹窗）、`tools.css`
- `src/ui/` — 通用组件与 `ui.css`（前缀 `tk-*`）：Icon / TkSelect / Tooltip / ConfirmDialog / Toaster / ToolErrorBoundary
- `src/utils/` — 无 UI 依赖的工具函数：草稿、备份、快捷键、域名匹配、主题、字体缩放等
- `src/i18n/` — i18next 实例、`useLocale`、语言包，以及文案守卫测试
- 测试与被测模块**同目录**：`*.test.ts(x)`；DOM 用例在文件头写 `// @vitest-environment happy-dom`
- 根配置：三个 vite 构建（`vite.content.config.ts` / `vite.background.config.ts` / `vite.config.ts`，缺一不可）、`vitest.config.ts`、`tsconfig*.json`、`eslint.config.js`
- `index.html` + `src/main.tsx` — 仅 `pnpm dev` 预览用，不进扩展产物
- `.github/workflows/ci.yml` — 质量门禁

## 4 硬约定

违反这些会坏功能、坏构建或让 CI 变红。

**工程**

1. **构建顺序**：`pnpm build` 按 content → background → 页面 串行，content 会先清空 `dist/`；单独跑某个 vite 配置会产出残缺产物。
2. **content / background 必须是 IIFE**（`format:'iife'` + `inlineDynamicImports:true`）：manifest 不支持 ESM。
3. **content 的样式只能内联进 Shadow DOM**（`theme.css` / `ui.css` / `tools.css` / `content.css` 都以 `?inline` 导入）；直接 `import './x.css'` 会污染宿主页。
4. **`chrome.*` 的用法**：`utils/env.ts` 封装了最常用的 6 个通用能力（`isExtension` / `storageGet` / `storageSet` / `storageRemove` / `openOptionsPage` / `extVersion`），优先使用封装；其余 API 可直接调用，但**必须在 `if (!isExtension()) return` 守卫块内**（或等价的 `if (typeof chrome === 'undefined')` 判断后），不能裸调——`pnpm dev` 预览与测试环境里没有 `chrome`。典型模式：`if (!inExt) return; /* 块内可直接用 chrome.storage.onChanged 等 */`。
5. **新工具要登记两处**：`tools/registry.ts`（`ToolId` + `DEFAULT_TOOLS`）与 `ToolsApp.tsx` 的 `TOOL_COMPONENTS`，否则工具不可见或渲染空白。`TOOL_COMPONENTS` 类型是 `Record<ToolId, ...>`，漏登记时 **TypeScript 编译会报错**，这是自动守卫。
6. **跨端通信**：`action` 只能引用 `utils/messages.ts` 的常量；失败响应只回 `{ ok:false, code }`（`ERROR_CODES`），**文案由 UI 侧按当前语言生成**，禁止在 background 里硬编码面向用户的字符串；成功响应建议结构：`{ ok:true, data?: T }`——裸值返回仅存在于历史遗留 handler，新增 handler 统一走 ok 结构。
7. **设置读写**：读取一律过 `normalizeSettings` / `normalizeToolLayout`（旧数据、残缺数据必须能兼容）；写入用 `saveSettings()` 并检查返回值，失败要提示用户（`chrome.storage.sync` 是静默失败）。
8. **content 打开扩展页 / 侧边栏必须经 background 中转**：`sidePanel.open` 依赖用户手势，失败要回退到网页抽屉。
9. **类型零错误**：`strict` + `noUnusedLocals` + `noUnusedParameters` 全开，改完必须过 `pnpm type-check`。
10. **行为改动要带测试**：`tools/*.ts`、`utils/*.ts` 这类纯逻辑模块必须配同目录 `*.test.ts`；`content/` 下的纯逻辑（存储桥、域名匹配）同样适用，Shadow DOM 相关可参考 `ToolErrorBoundary.dom.test.tsx` 的 happy-dom 写法；文案 key 的完整性由 `src/i18n/i18n.test.ts` 守卫。

**UI 与文案**

11. **文案一律走 key 且中英同步**：按钮、选项卡与区域标签、下拉选项、状态与错误提示、占位符、空状态引导、`aria-label` / `title` / Tooltip 都算文案。两套语言包都要补（应用内 `src/i18n/locales/{zh,en}.json`、清单级 `public/_locales/{zh_CN,en}/messages.json`）。**「中英同形」也要登记 key**（`localStorage`、`Base64` 这类专有名词同理）；**单复数按语义判断**（指集合用复数如 `Cookies`，指单个实体用单数）；纯技术示例值（`example.com`、`1780000000`、`/`）可直接写字面量。
12. **只用设计令牌**：颜色 / 字号 / 控件高 / 圆角 / 阴影统统走 `theme.css` 的 `--tk-*`，主题靠 `data-theme`；不要写死色值。
13. **类名前缀分域**：`tk-*` 通用组件（`ui/ui.css`）、`tw-*` 工具箱（`tools/tools.css`）、`tek-*` content 悬浮层（`content/content.css`）、`pop-*` / `opt-*` / `sp-*` 各宿主页。
14. **复用现成组件**：`TkSelect`（禁用原生 `select`）、`ConfirmDialog`（禁用 `window.confirm`——它在 content script 里被 Chrome 禁用；在 Options/Popup 等扩展页里虽可用，但统一走 `ConfirmDialog` 保持风格一致）、`Tooltip`（禁用原生 `title`）、`Icon`（禁用 emoji；新图标在 `ui/Icon.tsx` 里注册 SVG path，通过 `size` prop 控制大小）、`CopyButton` / `DownloadButton` / `StatusText` / `Toaster` / `ToolErrorBoundary`。
15. **统一交互流**：`输入源 ➔ 操作栏 ➔ 状态/错误反馈 ➔ 结果与视图配置`；状态与报错紧贴操作按钮下方按需展示（不要被空结果框隔开），无状态时不保留空白占位；**空输入检测统一用 `useEmptyError` hook**（`src/tools/useEmptyError.ts`）：`triggerEmpty()` 触发红框+聚焦，`clearEmpty()` 清除，不要手动维护 `emptyErr` state + `inputRef`，不弹文字横幅。
16. **结果区只读**：解析 / 解码结果只做展示与复制，不要改成可编辑表单（只有 JSON 工作台与 Cookie 编辑弹窗是编辑态）。

## 5 关键机制与陷阱

- **两套 i18n 并存**：应用内文案是 i18next（`src/i18n/locales/{zh,en}.json`），跟随用户在 Options 里选的语言；清单级文案是 Chrome 原生 `_locales`（`public/_locales/{zh_CN,en}/messages.json`），**只能跟随浏览器界面语言**——扩展无权自选清单 locale。改文案前先判断属于哪一层。
- **会话草稿有两个坑**：
  1. `utils/draft.ts` 的 `memoryCache` 是**模块级常驻**的，`useToolDraft` 的初始值优先取它。所以**从外部写草稿必须用 `setDraftValue()`**（同时更新缓存与存储）；只写 `chrome.storage.session` 会让同一会话内先前用过该工具的用户读到旧值。
  2. 草稿结构**不统一**，写之前先看目标工具怎么读：

  | 工具 key | 值类型 | 说明 |
  | --- | --- | --- |
  | `activeToolTab` | `ToolId \| null` | 工具箱当前激活项（`ToolsApp`） |
  | `base64` | `{ tab, decodeInput, decodeOutput, encodeInput, encodeOutput, fileB64Input }` | 对象，各 tab 独立 |
  | `detect.input` | `string` | 智能解析输入 |
  | `storage.area` | `'local' \| 'session' \| 'cookie'` | 网页存储的区域 tab（切走再回来保持选择） |
  | `hash` | `{ tab, textInput, hmacKey, showHmac, uppercase, expectedChecksum }` | 对象，文本 / 文件两个 tab 共用字段 |
  | `json.workbench` | `JsonDraft` 对象 | `input` / `output` / `indent` / `sortKeys` / `minify` / `lastAction` / `splitRatio` |
  | `jwt.token` | `string` | JWT 输入 |
  | `qrcode.input` | `string` | 二维码生成输入 |
  | `qrcode.tab` | `'generate' \| 'decode'` | 二维码内层 tab（与 `url.tab` 同构） |
  | `timestamp.input` | `string` | 时间戳输入 |
  | `url.tab` | `'parse' \| 'codec'` | URL 工具额外有 tab 草稿 |
  | `url.parse.input` | `string` | URL 解析输入 |
  | `url.codec` | `{ scope, input, output }` | URL 编解码 |
  | 其余新增工具 | `string` | 单一字符串（新增工具时在本表登记） |

  注：表里是传给 `useToolDraft` 的**逻辑 key**，实际存储键由 `draft.ts` 统一加前缀 `toolkit.draft.`；值类型是 `useToolDraft<T>` 的 `T`，`useToolDraft` 不做校验，读取方要自己容错。

- **跨端错误码**：background 没有语言上下文，因此只回 `{ ok:false, code }`；文案由 UI 侧 `resolveStorageError()` 按当前语言映射。**在 background 里写文案不会生效**（那里本来就不该有文案）。
- **存储桥接**：扩展页（侧边栏 / Options）无法直接读网页 `localStorage`，由 content 的 `installStorageBridge()` 代读代写。因此侧边栏的网页存储**依赖当前标签页已注入 content script**——特权页或未注入的页面取不到数据是正常现象，不是 bug。
- **抽屉与原生侧边栏互斥**：靠 `MSG_*` 消息 + 侧边栏 Port 长连接实现，开一个要关掉另一个。`chrome.sidePanel.open` 必须由用户手势触发，快捷键路径已在 background 首帧同步调用（任何前置 `await` 都会让手势令牌失效）。
- **不要在 `setState` 更新器里写存储**：updater 必须是纯函数（StrictMode 下会被调用两次，等于写两遍）。两种合法写法，按场景选：
  - **高频输入用「脏标记 + `useEffect`」**（见 `src/popup/QuickSettings.tsx`）：滑块、连点开关这类会连续变化的控件，合并成一次写入，避免 `storage.sync` 写入频率配额。
  - **显式表单操作可直接写入**（见 `src/options/OptionsPage.tsx` 的 `persist`）：Options 页每次改动都是一次明确的用户操作，事件回调里立即 `saveSettings()` 语义更直接；此时依然要检查返回值并提示失败。
- **错误边界只兜渲染期**：`ToolErrorBoundary` 拦不住事件回调与异步 Promise 里的异常——那些要各自 catch（storage 层统一转成 `{ ok:false }` 结果返回）。
- **工具顺序与显隐是用户配置**：`DEFAULT_TOOLS` / `DEFAULT_HIDDEN_TOOLS` 只决定默认值，运行时一律用 `visibleTools(layout)` 计算；默认激活项 = 第一个可见工具，不要写死某个 id。
- **`pnpm dev` 与扩展环境不等价**：dev 下没有 `chrome`，走 `env.ts` 的降级实现（含 mock 数据）。「dev 里正常」不能证明扩展里正常，涉及 `chrome.*` 的改动要用 `pnpm build` 后在浏览器里验证。
- **`settings` 存储配额**：`chrome.storage.sync` 单条 8KB 上限，**新增字段前估算 JSON 体积**（尤其是字符串数组如 `ballBlacklist`）；大体积或敏感数据（图片 base64 等）强制走 `chrome.storage.local`（参考 `BALL_IMAGE_KEY`，上限 128KB），不要塞进 sync。

## 6 三个常见流程

### 6.1 新增一个工具（id `foo`、组件 `FooTool`）

1. `tools/registry.ts`：`ToolId` 加 `'foo'`；`DEFAULT_TOOLS` 加 `{ id:'foo', label:'Foo' }`——Options 列表与工具箱选项卡会自动出现。
2. `tools/foo.ts`：纯逻辑，不依赖 React，文案用 `i18n.t()`。
3. `tools/foo.test.ts`：补纯逻辑测试（见 §4 第 10 条）。
4. `tools/FooTool.tsx`：`default export`，复用 `AutoArea` / `ToolTabs` / `CopyButton` / `StatusText` / **`useEmptyError`** 等，遵守 §4 的 UI 约定。
5. `tools/ToolsApp.tsx`：`TOOL_COMPONENTS` 加 `foo: () => <FooTool />`。
6. `src/i18n/locales/{zh,en}.json`：补 `tool.registry.foo` 与工具内全部文案（两套都要）。
7. 样式写进 `tools/tools.css`（`tw-*` + 设计令牌）。
8. 可选：`ui/Icon.tsx` 补图标；`tools/detect.ts` 接入智能解析；`tools/handoff.ts` 接入「在 XX 工具中打开」。
9. 收尾：按 §7 选验证级别——过程中只跑最小集（§7.1），交付前才跑全量门禁（§7.2）。

### 6.2 新增或修改文案

先判断属于哪一层（见 §5 第 1 条）：

- **跟随用户设置的语言** → 应用内：`zh.json` + `en.json` 同时加 key（命名 `tool.<tool>.*` / `settings.*` / `common.*`），组件里 `t('key')`、纯逻辑里 `i18n.t('key')`。
- **跟随浏览器界面语言**（扩展名与描述、快捷键说明、右键菜单） → 清单级：`public/_locales/{zh_CN,en}/messages.json` 两套都加，manifest 里用 `__MSG_key__`，`background` 里用 `chrome.i18n.getMessage('key')`。

改完后跑 `pnpm test i18n`：守卫测试会校验 key 是否存在、两套语言包是否对齐（无需跑全量测试）。

### 6.3 改设置字段（`Settings`）

1. `utils/settings.ts`：加字段 → `defaultSettings()` 给默认值 → `normalizeSettings()` 加兜底（非法值回退，必要时补一个 `normalizeXxx()`）。
2. UI：完整项放 `options/OptionsPage.tsx`（用 `TkSelect` 等通用组件，写入走 `persist()`，它内部是 `saveSettings` + 失败提示）；快捷项放 `popup/QuickSettings.tsx`（用 `update()` 的脏标记模式写存储）。
3. 消费端：按现有模式监听 `chrome.storage.onChanged`（`ToolsApp` / `ToolkitOverlay` / `QuickSettings` 都有现成写法）。
4. 大体积或敏感数据（图片 base64 等）放 `chrome.storage.local`（参考 `ballImage`），**不要塞进 sync**（单条 8KB 上限）。
5. 测试：`utils/settings.test.ts` 补归一化用例。
6. ⚠️ **兼容旧数据**：不要改已有字段的含义或删字段（用户升级后会错乱）；要演进就加新字段，并在 `normalizeSettings` 里做迁移。

## 7 验证分级与完工定义

验证分两级：**过程验证**（每次改动都做，默认级别）与**交付门禁**（只在收尾时跑一次）。
不默认跑全量的理由不是"图省事"：改一个颜色跑全量单测既**证明不了颜色对不对**（没有任何测试断言视觉），又要等、还会把几十个文件的输出灌进上下文。

### 7.1 过程验证（默认）

按最小粒度选命令，**能跑一个文件就不要跑一层**：

| 改了什么 | 过程验证（实测耗时） |
| --- | --- |
| 纯文档（`AGENTS.md` / `README` / `TASKS.md`） | 不跑任何命令 |
| `theme.css` 的令牌值 | `pnpm test theme`（~1s；`theme.dom.test.ts` 断言明暗两套的对比度）——**只改一个颜色就是这一类，不要跑全量** |
| 工具纯逻辑 `tools/x.ts` | `pnpm test x.test`（~1s，跑同目录的 `*.test.ts`） |
| 工具组件 `tools/XTool.tsx` | `pnpm test XTool`（happy-dom 用例）+ `pnpm type-check` |
| 文案 key（zh/en、`_locales`） | `pnpm test i18n`（~1s；守卫 key 存在与两套对齐） |
| 纯样式类名 / 布局（`tools.css` / `ui.css` / `content.css`） | 没有自动化能证明视觉效果：顺手改了 `.tsx` 就加 `pnpm type-check`，纯 CSS 直接**目测**（必要时 `pnpm dev`） |
| 公共契约（`registry.ts` / `messages.ts` / `settings.ts` / `manifest.json` / vite、tsconfig、eslint 配置） | `pnpm test:changed` + `pnpm type-check` |
| 拿不准影响面 | 先 `pnpm test:changed`；它挑不出东西、又确实改了行为，再考虑全量 |

三条纪律：

1. **粒度从最小开始**：先跑单个文件/关键词，绿了就停，不要"顺手"再跑全量。
2. **输出卫生**：全量单测默认 reporter 会列出全部文件；只想看总数就加 `--reporter=dot`，长输出命令一律 `| tail -n 20`。**不要把整段测试 / 构建输出贴进上下文**——这是最大的一笔 token 开销。
3. **红了再聚焦**：失败时单独重跑那个文件看完整报错，不要在全量输出里翻。

### 7.2 交付门禁（收尾时跑一次）

满足下列任一条才跑全量：

- 用户明确要求收尾 / 交付 / 提交 / 发版；
- 改动触及**公共契约**（`registry.ts`、`messages.ts`、`settings.ts`、`theme.css` 里令牌的**增删改名**（只调值不算）、`manifest.json`、任一 vite / tsconfig / eslint 配置）；
- 本次任务累计改了 ≥ 3 个模块，或过程验证出现过没吃透的信号。

```
pnpm format && pnpm lint && pnpm test && pnpm build
```

- `pnpm build` 内含 `tsc -b`（即 `pnpm type-check`），所以链里**不再单跑** `type-check`。
- `pnpm build` **不跑测试**、`pnpm lint` 只做静态检查，两者不能互相替代。
- 全量链一轮只跑一次：跑过 `pnpm test` 就不要再顺手跑 `pnpm test:changed`。
- CI 在 push / PR 上跑 `type-check + lint:check + test + build`（只读版），是最终兜底；本地全量是交付前自查，**不必每轮都跑**。
- 涉及 `chrome.*`、content script、快捷键、抽屉/侧边栏互斥的改动，**必须 `pnpm build` 后在浏览器里实测**——`pnpm dev` 没有 `chrome`，这些路径根本跑不到。
- 报告纪律：说清**做了哪一级验证、跑了哪几条命令、结果如何**；只做了过程验证就明说"未跑全量门禁"；没验证的部分要明说，不要让人以为已验过。

> 耗时为本机实测：全量单测 76 files / 1902 例 ≈ 11s、`type-check` ≈ 5s、`lint:check` ≈ 7s、`build` ≈ 14s、全量链 ≈ 35s。换机器会有出入，量级只用来判断"该不该跑"。

## 8 红线

- **不引入网络请求**：全部数据本地处理，代码里不允许出现 `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon`；不上报遥测，不引入远程代码（MV3 明令禁止）。
- **不碰仓库之外的任何路径**：不读写仓库外的文件、不执行影响仓库外环境的命令（装全局包、改系统配置等）。仓库外的一切都不在你的改动范围内。
- **不把凭据、令牌、本机绝对路径写进仓库**（含文档、注释与提交信息）。
- **权限只减不增**：当前是 `storage` / `sidePanel` / `contextMenus` / `cookies` + `<all_urls>` 宿主权限。要扩权限必须在改动说明里给出理由。
- **新增依赖要克制**：能用平台 API 就用平台 API（文本加解密用 Web Crypto 而非 crypto-js；测试用 Vitest + happy-dom）。加了依赖要说明用途与体积影响。
- **不静默毁数据**：`chrome.storage` / 网页存储 / Cookie 的破坏性写操作必须走 `ConfirmDialog` 二次确认。
- **不提交 `dist/`、`node_modules/`、`.pnpm-store/`**（`.gitignore` 已忽略，不要用 `-f` 强推）。
