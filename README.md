# Toolkit Extension

基于 **React 19 + Vite 7 + TypeScript** 的 **Chrome 扩展（Manifest V3）** 开发骨架。

由通用 React/Vite 模板改造而来，内置多种界面形态，开箱即用：

| 形态 | 入口 | 说明 |
| --- | --- | --- |
| 🪟 Popup 弹窗 | `popup.html` · `src/popup/` | 点击工具栏图标弹出；含「在浏览器侧边栏打开」入口 |
| 🧭 Side Panel 侧边栏 | `sidepanel.html` · `src/sidepanel/` | 浏览器原生侧边栏承载「工具箱」页面 |
| 📄 Content Script 注入 | `src/content/` → `content.js` | 网页内悬浮球（可拖拽贴边）+ 网页内右侧抽屉 |
| ⚙️ Options 设置页 | `options.html` · `src/options/` | 悬浮球开关 / 点击行为等配置（`chrome.storage.sync`） |
| 🧰 工具箱页面 | `src/tools/` | **共享 UI**：原生侧边栏、网页内抽屉、预览页复用；已内置 Base64 编解码 |

## 快速开始

```bash
pnpm install     # 安装依赖（仅首次）
pnpm dev         # 浏览器开发预览：http://localhost:5173 可预览全部 UI，支持热更新
pnpm build       # 构建产物到 dist/
pnpm icons       # （可选）重新生成 public/icons 占位图标
```

> `pnpm dev` 是在普通浏览器里直接预览 UI：`chrome.*` API 不存在时组件会自动降级为
> 「浏览器预览」模式，不会报错。

## 在 Chrome 中加载

1. 执行 `pnpm build`；
2. 打开 `chrome://extensions/`，右上角开启 **开发者模式**；
3. 点击 **加载已解压的扩展程序**，选择本项目的 `dist/` 目录；
4. 体验各个入口：
   - **悬浮球**：打开任意 http(s) 网页，屏幕右缘中部出现悬浮球 → 悬停滑出、拖拽贴边、点击打开网页内抽屉（或按设置在浏览器侧边栏打开）
   - **侧边栏**：点击工具栏图标 → Popup 里点「在浏览器侧边栏打开工具箱」；或右键扩展图标 →「选项」→ 把悬浮球点击动作改为「浏览器原生侧边栏」
   - **设置**：右键图标 →「选项」

> 修改代码后重新 `pnpm build`，然后在扩展管理页点击扩展卡片上的「重新加载」；
> 修改 content script 后还需**刷新一次目标网页**才会重新注入。

### 悬浮球点击行为的两种模式（可在 Options 中切换）

| 模式 | 行为 | 说明 |
| --- | --- | --- |
| 网页内抽屉（默认） | 网页右侧滑出工具箱抽屉 | 稳定可靠，预览/扩展一致 |
| 浏览器原生侧边栏 | 唤起 Chrome 原生侧边栏（`sidePanel`） | `sidePanel.open` 需要用户手势且带 windowId，悬浮球（content script）经由 Background 尽力中转，**部分 Chrome 版本会被手势限制拒绝，失败自动回退为抽屉**；在 Popup/侧边栏页内点击唤起则完全可靠 |

> 配置保存在 `chrome.storage.sync` 的 `settings` 键下；在 Options 里修改后，**对已打开的网页即时生效**（`chrome.storage.onChanged`），无需刷新页面。

## 目录结构

```
.
├── index.html                 # 仅开发预览用（不进入扩展产物）
├── popup.html                 # Popup 页面入口（构建入口）
├── options.html               # Options 页面入口（构建入口）
├── sidepanel.html             # 原生侧边栏页面入口（构建入口）
├── public/
│   ├── manifest.json          # Manifest V3 配置（构建时原样复制到 dist）
│   └── icons/                 # 扩展图标（脚本生成，可替换为正式图）
├── src/
│   ├── main.tsx               # 开发预览页（各入口 UI 汇总展示）
│   ├── popup/                 # Popup 弹窗
│   ├── options/               # Options 设置页
│   ├── sidepanel/             # 原生侧边栏页（Side Panel）
│   ├── content/               # Content Script：悬浮球 + 网页内抽屉
│   │   ├── main.tsx           # 挂载逻辑（Shadow DOM + CSS 内联注入）
│   │   ├── FloatingBall.tsx   # 可拖拽贴边、半隐滑出的悬浮球
│   │   ├── Drawer.tsx         # 网页内右侧抽屉（承载 ToolsApp）
│   │   ├── ToolkitOverlay.tsx # 状态/配置/消息
│   │   └── content.css        # 经 ?inline 内联，随 content.js 注入
│   ├── background/            # Background Service Worker（唤起侧边栏中转）
│   ├── tools/                 # 共享工具箱页（ToolsApp）+ Base64 工具
│   ├── pages/home/            # 共享的示例「首页」组件（Popup 用）
│   └── utils/                 # env / storage / sidePanel / 消息协议
├── vite.config.ts             # 页面构建（popup/options/sidepanel 多入口）
├── vite.content.config.ts     # Content Script 构建（IIFE）
├── vite.background.config.ts  # Background SW 构建（IIFE）
└── scripts/generate-icons.mjs # 生成占位 PNG 图标（纯 Node，无依赖）
```

## 工作原理

### 三段式构建（为什么要多个 vite 配置）

Chrome 的 `content_scripts` 与 MV3 service worker 都要求脚本**不能是 ES Module**，
而 Vite 的 HTML 页面产物是模块脚本，因此拆成几步：

1. `vite.content.config.ts`：`src/content/main.tsx` → `dist/content.js`（IIFE，先清空 dist）
2. `vite.background.config.ts`：`src/background/main.ts` → `dist/background.js`（IIFE）
3. `vite.config.ts`：构建 `popup/options/sidepanel.html` 页面及其资源（追加，不清空）

```jsonc
// package.json
"build": "tsc -b && vite build --config vite.content.config.ts && vite build --config vite.background.config.ts && vite build"
```

### Content Script 的样式隔离

`src/content/main.tsx` 用 **Shadow DOM** 挂载 React，并把 CSS（content + tools）以
`?inline` 的方式内联成字符串写进 Shadow Root 的 `<style>` 中：

```tsx
import toolsCss from '@/tools/tools.css?inline'
import contentCss from './content.css?inline'
// style.textContent = `${toolsCss}\n${contentCss}`
// shadow.appendChild(style); createRoot(shadow.querySelector('div')).render(<ToolkitOverlay />)
```

这样注入的 UI 既不受网页样式影响，也不会污染网页。

### manifest 与产物对应关系

```
dist/
├── manifest.json
├── popup.html            ← action.default_popup
├── options.html          ← options_ui.page
├── sidepanel.html        ← side_panel.default_path
├── content.js            ← content_scripts[].js
├── background.js         ← background.service_worker
├── icons/                ← icons / action.default_icon
└── assets/               ← 各页面的 JS/CSS（页面内已用相对路径引用）
```

### 消息链路（侧边栏 / 抽屉 / 悬浮球）

```
┌─ 原生侧边栏页 ──「在网页中打开」─→ tabs.sendMessage ─→ content: 切换抽屉开合
┌─ 悬浮球(content) ─「配置=native」─→ runtime.sendMessage ─→ background: sidePanel.open
```
消息协议常量集中在 `src/utils/messages.ts`；`sidePanel.open` 的手势限制说明见上文。

## 常见自定义

- **只注入特定网站**：修改 `manifest.json` 中 `content_scripts[].matches`（例如
  `"*://*.example.com/*"`）。
- **新增工具**：在 `src/tools/` 增加工具组件，挂到 `ToolsApp` 主体即可（原生侧边栏、
  网页内抽屉、预览页三处自动同步）。
- **网页需要访问扩展资源**（如图片/脚本）：把文件加入 manifest 的
  `web_accessible_resources`。
- **替换图标**：直接覆盖 `public/icons/` 下同名 PNG，或替换
  `scripts/generate-icons.mjs` 里的绘制逻辑后运行 `pnpm icons`。
- **新增页面形态**（如新标签页）：新建 `xxx.html` + `src/xxx/main.tsx`，把入口加进
  `vite.config.ts` 的 `rollupOptions.input`，并在 manifest 中引用。
