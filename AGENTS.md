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
| `qrcode` | ✓ |
| `json` | ✓ |
| `url` | ✓ |
| `jwt` | ✓ |
| `base64` | ✓ |
| `timestamp` | ✓ |
| `hash` | ✓ |

表格顺序 = 注册表顺序 = 默认选项卡顺序。9 个工具默认全部开启，用户可在 Options 自行调整顺序与显隐；**顺序与显隐是用户配置，不要写死假设**。

## 2 命令

只能使用 pnpm（`preinstall` 会用 `only-allow` 拦截 npm / yarn）。

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 浏览器预览 UI，`chrome.*` 自动降级 |
| `pnpm gate` | **交付门禁**：`format && lint && test && build`（静音版）。触发条件见 §7.2 |
| `pnpm build` | `tsc -b` + 打包，顺序 content → background → 页面（**顺序不可乱**，content 先清空 `dist/`）；不跑测试 |
| `pnpm type-check` | 仅 `tsc -b`（~5s）；`pnpm build` 已包含 |
| `pnpm lint` | ESLint **自动修复**（ts/tsx/js/jsx；css/json 归 `pnpm format`） |
| `pnpm lint:check` | 只读校验（CI 用） |
| `pnpm test <片段>` | **开发期默认验证**：只跑匹配文件（`pnpm test theme`）~1s |
| `pnpm test` | 全量单测（76 files / ~1900 例 / ~11s，dot reporter）。**仅交付门禁调用** |
| `pnpm test:changed` | 只跑与 git 改动有依赖关系的测试（波及 20+ 文件时 ≈ 全量；无匹配则直接失败） |
| `pnpm test:watch` | 交互式监听；**人类专用，代理禁用** |
| `pnpm format` | Prettier 只覆盖 `src/`（根配置文件需手动格式化） |
| `pnpm icons` | 生成 `public/icons/*.png` |
| `pnpm package` | 打包带版本号的扩展压缩包 `release/panda-dock-v<version>.zip` |

装载扩展：`pnpm build` 后在 `chrome://extensions` 开启开发者模式 → 加载 `dist/`。

## 3 目录地图

**唯一来源**（改这些等于改全局行为）：

| 文件 | 是什么的唯一来源 | 改动时触发 |
| --- | --- | --- |
| `src/tools/registry.ts` | `ToolId`、`DEFAULT_TOOLS`、默认隐藏集 | `pnpm test:changed` + `type-check` |
| `src/tools/ToolsApp.tsx` | 工具箱页 + 工具组件映射 | `pnpm type-check` |
| `src/utils/messages.ts` | `MSG_*` 常量 + `ERROR_CODES` | `pnpm test:changed` + `type-check` |
| `src/utils/env.ts` | `chrome.*` 降级封装 | `pnpm type-check` |
| `src/utils/settings.ts` | `Settings` 类型、默认值、归一化、`saveSettings` | `pnpm test settings` + `type-check` |
| `src/theme.css` | `--pd-*` 设计令牌、主题切换、滚动条 | `pnpm test theme` |
| `src/i18n/locales/{zh,en}.json` | 应用内全部文案 | `pnpm test i18n` |
| `public/_locales/{zh_CN,en}/messages.json` | 清单级文案（商店页、右键菜单） | `pnpm test i18n` |
| `public/manifest.json` | 权限、入口、快捷键、content script 声明 | `pnpm test:changed` + `type-check` |

**目录职责：**

- `src/background/` — Service Worker：右键菜单、快捷键分发、Cookie 读写、侧边栏开合中转
- `src/content/` — Content Script：Shadow DOM 注入悬浮球 / 抽屉 / 划选面板（**样式只能内联**）
- `src/popup/` `src/options/` `src/sidepanel/` — 三个扩展页面，各自带 `index.css`（前缀 `pop-*` / `opt-*` / `sp-*`）
- `src/tools/` — 工具层：`{Tool}.tsx` 组件、`{tool}.ts` 纯逻辑、共享件（`AutoArea` / `JsonHighlight` / `CopyButton` / `ToolTabs` / `StatusText` / 编辑弹窗）、`tools.css`
- `src/ui/` — 通用组件与 `ui.css`（前缀 `pd-*`）：Icon / PdSelect / Tooltip / ConfirmDialog / Toaster / ToolErrorBoundary
- `src/utils/` — 无 UI 依赖的工具函数：草稿、备份、快捷键、域名匹配、主题、字体缩放等
- `src/i18n/` — i18next 实例、`useLocale`、语言包，以及文案守卫测试
- 测试与被测模块**同目录**：`*.test.ts(x)`；DOM 用例在文件头写 `// @vitest-environment happy-dom`
- 根配置：三个 vite 构建（`vite.content.config.ts` / `vite.background.config.ts` / `vite.config.ts`，缺一不可）、`vitest.config.ts`、`tsconfig*.json`、`eslint.config.js`
- `index.html` + `src/main.tsx` — 仅 `pnpm dev` 预览用，不进扩展产物

## 4 硬约定

违反这些会坏功能、坏构建或让 CI 变红。

**工程**

1. **构建顺序**：content → background → 页面，content 先清空 `dist/`；单独跑某个 vite 配置会产出残缺产物。
2. **content / background 必须是 IIFE**（`format:'iife'` + `inlineDynamicImports:true`）：manifest 不支持 ESM。
3. **content 的样式只能内联进 Shadow DOM**（`theme.css` / `ui.css` / `tools.css` / `content.css` 都以 `?inline` 导入）；直接 `import './x.css'` 会污染宿主页。
4. **`chrome.*` 的用法**：优先使用 `utils/env.ts` 封装（`isExtension` / `storageGet` / `storageSet` / `storageRemove` / `openOptionsPage` / `extVersion`）；其余 API 必须在 `if (!isExtension()) return` 守卫块内调用，不能裸调——`pnpm dev` 与测试环境里没有 `chrome`。
5. **新工具要登记两处**：`tools/registry.ts`（`ToolId` + `DEFAULT_TOOLS`）与 `ToolsApp.tsx` 的 `TOOL_COMPONENTS`。`TOOL_COMPONENTS` 类型是 `Record<ToolId, ...>`，漏登记时 TypeScript 编译报错（自动守卫）。
6. **跨端通信**：`action` 只引用 `utils/messages.ts` 的常量；失败响应只回 `{ ok:false, code }`（`ERROR_CODES`），文案由 UI 侧按当前语言生成，禁止在 background 里硬编码用户字符串；成功响应用 `{ ok:true, data?: T }`。
7. **设置读写**：读取一律过 `normalizeSettings` / `normalizeToolLayout`；写入用 `saveSettings()` 并检查返回值，失败要提示用户（`chrome.storage.sync` 是静默失败）。
8. **content 打开扩展页 / 侧边栏必须经 background 中转**：`sidePanel.open` 依赖用户手势，失败要回退到网页抽屉。
9. **类型零错误**：`strict` + `noUnusedLocals` + `noUnusedParameters` 全开，改完必须过 `pnpm type-check`。
10. **行为改动要带测试**：`tools/*.ts`、`utils/*.ts` 纯逻辑模块必须配 `*.test.ts`；`content/` 下纯逻辑同样适用；DOM 用例参考 `ToolErrorBoundary.dom.test.tsx` 的 happy-dom 写法；文案 key 完整性由 `src/i18n/i18n.test.ts` 守卫。

**UI 与文案**

11. **文案一律走 key 且中英同步**：按钮、选项卡标签、下拉选项、状态/错误提示、占位符、空状态引导、`aria-label` / `title` / Tooltip 都算文案。两套语言包都要补（应用内 `src/i18n/locales/{zh,en}.json`、清单级 `public/_locales/{zh_CN,en}/messages.json`）。**「中英同形」也要登记 key**（`localStorage`、`Base64` 等专有名词同理）；单复数按语义判断；纯技术示例值（`example.com`、`1780000000`）可直接写字面量。
12. **只用设计令牌**：颜色 / 字号 / 控件高 / 圆角 / 阴影走 `theme.css` 的 `--pd-*`，主题靠 `data-theme`；不要写死色值。
13. **类名前缀分域**：`pd-*` 通用组件、`tw-*` 工具箱、`tek-*` content 悬浮层、`pop-*` / `opt-*` / `sp-*` 各宿主页。
14. **复用现成组件**：
    - `PdSelect`（禁用原生 `<select>`）
    - `ConfirmDialog`（禁用 `window.confirm`——content script 里被 Chrome 禁用；扩展页虽可用，但统一走此组件保持风格）
    - `Tooltip`（禁用原生 `title`）
    - `Icon`（禁用 emoji；新图标在 `ui/Icon.tsx` 注册 SVG path，用 `size` prop 控制大小）
    - `CopyButton` / `DownloadButton` / `StatusText` / `Toaster` / `ToolErrorBoundary`
15. **统一交互流**：`输入源 ➔ 操作栏 ➔ 状态/错误反馈 ➔ 结果与视图配置`；状态与报错紧贴操作按钮下方，无状态时不保留空白占位；**空输入检测用 `useEmptyError` hook**（`src/tools/useEmptyError.ts`）：`triggerEmpty()` 触发红框+聚焦，`clearEmpty()` 清除，不手动维护 `emptyErr` state + `inputRef`。
16. **结果区只读**：解析 / 解码结果只做展示与复制（只有 JSON 工作台与 Cookie 编辑弹窗是编辑态）。

## 5 关键机制与陷阱

- **两套 i18n 并存**：应用内文案是 i18next（跟随用户在 Options 里选的语言）；清单级是 Chrome 原生 `_locales`（只能跟随浏览器界面语言）。改文案前先判断属于哪一层。

- **会话草稿**：`utils/draft.ts` 的 `memoryCache` 是**模块级常驻**的，`useToolDraft` 初始值优先取它。**从外部写草稿必须用 `setDraftValue()`**（同时更新缓存与存储）；只写 `chrome.storage.session` 会让同会话内已用该工具的用户读到旧值。草稿结构不统一，写之前看目标工具如何读（各工具的 draft key / 值类型以 `utils/draft.ts` 源码为准）。

- **跨端错误码**：background 只回 `{ ok:false, code }`；文案由 UI 侧 `resolveStorageError()` 映射。在 background 里写文案不会生效。

- **存储桥接**：扩展页（侧边栏 / Options）无法直接读网页 `localStorage`，由 content 的 `installStorageBridge()` 代读代写。侧边栏的网页存储依赖当前标签页已注入 content script——特权页或未注入的页面取不到数据是正常现象。

- **Cookie 分存储**：普通环境与无痕环境是两个隔离的 Cookie 存储（`storeId` `"0"` / `"1"`）。`chrome.cookies.*` 不传 `storeId` 时只用**后台自身所在的存储**（spanning 模式下恒为普通环境），所以无痕窗口会读到普通环境的 Cookie。所有 cookie 读写一律经 `resolveCookieTarget()` 按目标标签页反查 `storeId`（`getAllCookieStores()` 的 `tabIds`；扩展页没有 `sender.tab`，取 `lastFocusedWindow` 的活动标签页）。

- **抽屉与原生侧边栏互斥**：靠 `MSG_*` + 侧边栏 Port 长连接实现，开一个要关另一个。`chrome.sidePanel.open` 必须在用户手势首帧同步调用，任何前置 `await` 都会让手势令牌失效。

- **不要在 `setState` 更新器里写存储**：updater 是纯函数（StrictMode 下调用两次）。两种合法写法：
  - **高频输入**（滑块、连点开关）→「脏标记 + `useEffect`」合并写入（见 `QuickSettings.tsx`）
  - **显式表单操作** → 事件回调里直接 `saveSettings()`（见 `OptionsPage.tsx` 的 `persist`），检查返回值并提示失败

- **错误边界只兜渲染期**：`ToolErrorBoundary` 拦不住事件回调与异步 Promise 里的异常——各自 catch。

- **工具顺序与显隐是用户配置**：`DEFAULT_TOOLS` / `DEFAULT_HIDDEN_TOOLS` 只是默认值，运行时用 `visibleTools(layout)` 计算；默认激活项 = 第一个可见工具，不要写死 id。

- **`pnpm dev` 与扩展环境不等价**：dev 下没有 `chrome`，走 `env.ts` 降级。涉及 `chrome.*` 的改动要 `pnpm build` 后在浏览器里验证。

- **`settings` 存储配额**：`chrome.storage.sync` 单条 8KB 上限，新增字段前估算 JSON 体积；大体积 / 敏感数据（图片 base64 等）强制走 `chrome.storage.local`（参考 `BALL_IMAGE_KEY`，**存储**上限 128KB；悬浮球图片由 `cropAndCompressBallImage()` 逐级降采样压到上限内，**不要按原始文件体积拒绝用户**）。

## 6 三个常见流程

### 6.1 新增一个工具（id `foo`、组件 `FooTool`）

1. `tools/registry.ts`：`ToolId` 加 `'foo'`；`DEFAULT_TOOLS` 加 `{ id:'foo', label:'Foo' }`。
2. `tools/foo.ts`：纯逻辑，不依赖 React，文案用 `i18n.t()`。
3. `tools/foo.test.ts`：补纯逻辑测试。
4. `tools/FooTool.tsx`：`default export`，复用 `AutoArea` / `ToolTabs` / `CopyButton` / `StatusText` / `useEmptyError`，遵守 §4 UI 约定。
5. `tools/ToolsApp.tsx`：`TOOL_COMPONENTS` 加 `foo: () => <FooTool />`。
6. `src/i18n/locales/{zh,en}.json`：补 `tool.registry.foo` 与工具内全部文案（两套都要）。
7. 样式写进 `tools/tools.css`（`tw-*` + 设计令牌）。
8. 可选：`ui/Icon.tsx` 补图标；`tools/detect.ts` 接入智能解析；`tools/handoff.ts` 接入「在 XX 工具中打开」。
9. 验证：`pnpm test foo && pnpm test i18n && pnpm build`。

### 6.2 新增或修改文案

先判断属于哪一层（见 §5）：

- **跟随用户语言** → `zh.json` + `en.json` 同时加 key（`tool.<tool>.*` / `settings.*` / `common.*`），组件里 `t('key')`，纯逻辑里 `i18n.t('key')`。
- **跟随浏览器语言**（扩展名、右键菜单） → `public/_locales/{zh_CN,en}/messages.json` 两套都加，manifest 用 `__MSG_key__`，background 用 `chrome.i18n.getMessage('key')`。

改完后跑 `pnpm test i18n`（守卫 key 存在与两套对齐）。

### 6.3 改设置字段（`Settings`）

1. `utils/settings.ts`：加字段 → `defaultSettings()` → `normalizeSettings()` 加兜底。
2. UI：完整项放 `options/OptionsPage.tsx`（`persist()`）；快捷项放 `popup/QuickSettings.tsx`（脏标记模式）。
3. 消费端：监听 `chrome.storage.onChanged`（参考 `ToolsApp` / `PandaDockOverlay`）。
4. 大体积 / 敏感数据放 `chrome.storage.local`，不塞进 sync。
5. 测试：`utils/settings.test.ts` 补归一化用例。
6. ⚠️ **兼容旧数据**：不改已有字段含义或删字段；要演进就加新字段，在 `normalizeSettings` 里做迁移。

## 7 验证分级与完工定义

**核心原则**：开发期只跑最小验证；只有用户显式要求交付时才跑全量。全量单测≈11s，但会产出 500+ 行输出≈8k tokens——输出体量才是瓶颈。

### 7.1 开发期验证（默认）

**决策树**（按顺序判断，匹配第一条即止；代码/样式/文案任务完工均以 `+ pnpm build` 结尾刷新 `dist/`）：

```
改了什么？
├─ 纯文档（AGENTS.md / README / TASKS.md）→ 不跑任何命令
├─ 纯 CSS（tools.css / ui.css / content.css）→ 目测 / pnpm dev + pnpm build
├─ theme.css 令牌值  → pnpm test theme + pnpm build
├─ 文案 key          → pnpm test i18n + pnpm build
├─ 工具纯逻辑 x.ts   → pnpm test x.test + pnpm build
├─ 工具组件 XTool.tsx → pnpm test XTool + pnpm build
├─ 公共契约（§3 唯一来源文件 / 构建配置）→ pnpm test:changed + pnpm build
└─ 拿不准影响面      → pnpm test:changed + pnpm build
```

四条纪律：

1. **完工必跑 build**：开发任务执行完毕、向用户汇报完成前，必须执行 `pnpm build`（刷新 `dist/` 产物并消除 IIFE/动态引用等打包期隐患；`build` 内含 `tsc -b`，无需单跑 `type-check`）。
2. **粒度从最小开始**：定向单测绿了就停，不要在开发期顺手跑全量单测。
3. **输出 ≤ 30 行**：长输出一律 `| tail -n 20` 或 `| grep -E "Test Files|Tests |FAIL"`，不把整段输出贴进上下文。有代理变量时加 `NODE_OPTIONS=--no-warnings`（只内联，不写进脚本——Windows 不兼容）。
4. **红了再聚焦**：失败时单独重跑那个文件，不在全量输出里翻。

### 7.2 交付门禁（仅用户明确要求时触发）

```
pnpm gate   # = format && lint && test && build
```

**什么时候跑什么**：

| 交付内容 | 命令 |
| --- | --- |
| 纯视觉（改颜色/间距/尺寸，不新增令牌） | `pnpm test theme && pnpm build` |
| 逻辑 / 公共契约 / 令牌增删改名 | `pnpm gate` |

其他规则：
- `pnpm gate` 的 `build` 内含 `tsc -b`，链里不再单跑 `type-check`；`build` 不跑测试，两者不能互替。
- 一轮只跑一次：跑过 `test` 不再顺手跑 `test:changed`。
- CI 在 push / PR 上跑 `type-check + lint:check + test + build`（只读版），是最终兜底。
- 涉及 `chrome.*`、content script、快捷键、抽屉/侧边栏互斥的改动，**必须 `pnpm build` 后在浏览器里实测**。
- 报告纪律：说清做了哪一级验证、跑了哪几条命令、结果如何；只做过程验证就明说"未跑全量门禁"。

> 实测：定向单测 ~1s；`pnpm gate` ≈ 35s（全量单测 ≈11s、`build` ≈14s）。

### 7.3 上下文纪律

1. **先定位再取窗**：`grep -n` 找行号，再读 ≤ 80 行窗口；不整文件读（`tools.css` 已 2500+ 行）；改完用 `git diff -- <file>` 看差异。
2. **输出 ≤ 30 行**：同 §7.1 第 2 条。
3. **不重复劳动**：同一命令一轮只跑一次；绿了不「为了安心」再跑一遍。
4. **写完就停**：一条断言能守住的不变量不写三条；新守卫必须做变异验证（改坏能变红）。
5. **文档有预算**：`AGENTS.md` 每轮都进上下文——加约定前先看能否并入已有条目（新增 10 行 ≈ +150 tokens/轮）；`TASKS.md` **完成即删**，条目 ≤ 6 行。

## 8 红线

- **不引入网络请求**：代码里不允许出现 `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon`；不上报遥测，不引入远程代码（MV3 明令禁止）。
- **不碰仓库之外的任何路径**：不读写仓库外文件，不执行影响仓库外环境的命令。
- **不把凭据、令牌、本机绝对路径写进仓库**（含文档、注释与提交信息）。
- **权限只减不增**：当前是 `storage` / `sidePanel` / `contextMenus` / `cookies` + `<all_urls>`。要扩权限必须在改动说明里给出理由。
- **新增依赖要克制**：能用平台 API 就用（文本加解密用 Web Crypto；测试用 Vitest + happy-dom）。加依赖要说明用途与体积影响。
- **不静默毁数据**：`chrome.storage` / 网页存储 / Cookie 的破坏性写操作必须走 `ConfirmDialog` 二次确认。
- **不提交 `dist/`、`node_modules/`、`.pnpm-store/`**（`.gitignore` 已忽略，不要用 `-f` 强推）。
