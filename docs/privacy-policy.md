# Privacy Policy / 隐私政策

**Panda Dock**
Last updated: 2026-09-14

---

## English

### Overview

Panda Dock ("the Extension") is a developer toolbox Chrome extension. This Privacy Policy explains what data the Extension accesses, how it is used, and how it is stored.

### Data We Collect and Use

The Extension may access the following data **solely to provide its stated features**:

| Data | Purpose | Storage |
|---|---|---|
| Browser cookies of the current tab | Cookie viewer / editor tool | Never stored; read/written on demand, shown only in UI |
| Current page URL and content | Smart-detect tool (JSON, URL, Base64, JWT detection) | Never stored; processed locally and transiently |
| Extension settings (theme, layout, enabled tools, floating ball configuration) | Remember user preferences | Stored locally via `chrome.storage.sync` (synced across user's own devices) |
| Custom floating ball image (user-uploaded) | Display as floating ball icon | Stored locally via `chrome.storage.local`; never transmitted |
| Session input drafts (tool input fields) | Restore last session input | Stored locally via `chrome.storage.session`; cleared when browser closes |

### Data We Do NOT Collect

- We do **not** collect, transmit, sell, or share any personal data.
- We do **not** send any data to external servers. There are **no network requests** of any kind in the Extension.
- We do **not** track usage, behavior, or analytics.
- We do **not** use any third-party analytics, advertising, or telemetry services.

### Permissions Explanation

| Permission | Reason |
|---|---|
| `storage` | Save user settings and drafts locally |
| `sidePanel` | Show the toolbox in Chrome's native side panel |
| `contextMenus` | Add right-click menu entries for quick tool access |
| `cookies` | Read and write cookies for the Cookie tool |
| `http://*/*`, `https://*/*` (host permissions) | Inject the floating ball UI into web pages; read page content for smart-detect |

### Data Retention

All data is stored locally on your device. You can clear it at any time via the Options page ("Reset Settings" / "Remove" buttons) or by removing the Extension.

### Changes to This Policy

We may update this policy if the Extension's features change. The "Last updated" date at the top will reflect any revisions.

### Contact

If you have questions about this privacy policy, please open an issue in the project repository.

---

## 中文

### 概述

Panda Dock（以下简称"本扩展"）是一款面向开发者的 Chrome 工具箱扩展。本隐私政策说明本扩展访问哪些数据、如何使用以及如何存储这些数据。

### 我们访问和使用的数据

本扩展**仅为提供其声明功能**而访问以下数据：

| 数据 | 用途 | 存储方式 |
|---|---|---|
| 当前标签页的浏览器 Cookie | Cookie 查看/编辑工具 | 不做持久化存储；按需读写，仅展示于界面中 |
| 当前页面 URL 及内容 | 智能解析工具（JSON / URL / Base64 / JWT 检测） | 不做存储；在本地临时处理后丢弃 |
| 扩展设置（主题、布局、启用工具列表、悬浮球配置等） | 记住用户偏好 | 通过 `chrome.storage.sync` 存储于本地（可在用户自己的设备间同步） |
| 用户上传的悬浮球自定义图片 | 作为悬浮球图标展示 | 通过 `chrome.storage.local` 存储于本地，不会传输至任何服务器 |
| 会话期工具输入草稿 | 恢复上次会话的输入内容 | 通过 `chrome.storage.session` 存储；浏览器关闭后自动清除 |

### 我们不收集的数据

- 本扩展**不**收集、传输、出售或共享任何个人数据。
- 本扩展**不**向任何外部服务器发送数据，扩展内**不存在任何网络请求**。
- 本扩展**不**追踪用户行为或使用统计。
- 本扩展**不**接入任何第三方分析、广告或遥测服务。

### 权限说明

| 权限 | 申请原因 |
|---|---|
| `storage` | 在本地保存用户设置与草稿 |
| `sidePanel` | 在 Chrome 原生侧边栏中展示工具箱 |
| `contextMenus` | 添加右键菜单快捷入口 |
| `cookies` | 为 Cookie 工具提供读写能力 |
| `http://*/*`、`https://*/*`（宿主权限） | 向网页注入悬浮球 UI；读取页面内容用于智能解析 |

### 数据保留

所有数据均存储在您的本地设备上。您可随时通过选项页中的「重置设置」/「移除」按钮，或卸载本扩展来清除数据。

### 政策变更

若本扩展功能发生变更，我们可能会更新本政策。页面顶部的「最后更新」日期将反映任何修订。

### 联系方式

如有关于本隐私政策的疑问，请在项目仓库中提交 Issue。
