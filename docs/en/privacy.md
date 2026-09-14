# Privacy Policy

Panda Dock is a Chrome extension providing a set of offline developer tools. Last updated: 2026-09-14.

## 1. Summary

Everything you type, paste, select, or edit stays entirely within your browser. The extension makes no network requests and has no accounts, servers, or analytics. We cannot see your data and we do not sell or share it.

## 2. What the Extension Accesses

Only while you actively use a tool — never in the background:

- **Page storage** — Cookies and `localStorage` / `sessionStorage` of the current page, accessed when you open the Storage tool. Data is displayed and edited in place; the extension retains no copy.
- **Text and files** — Text you paste or select, and files you choose to open. All parsing happens locally in your browser.
- **Your settings** — Saved to `chrome.storage.sync`; the optional floating-ball image is saved to `chrome.storage.local` on your device.
- **Session input** — Tool input during a session, saved to `chrome.storage.session` and cleared when the browser closes.
- **Clipboard** — Written when you click Copy; read when you paste into a tool.

All of the above can be cleared at any time from the Options page. Uninstalling the extension removes it as well.

## 3. Permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Save settings, session drafts, and the optional floating-ball image locally. |
| `sidePanel` | Show the toolbox in Chrome's side panel. |
| `contextMenus` | Provide right-click shortcut entries. |
| `cookies` | Read and write cookies in the Storage tool. |
| `http://*/*`, `https://*/*` | Inject the floating ball into pages, read selected text, and access the current page's storage when you open the Storage tool. |

No other permissions are requested.

## 4. Chrome Web Store Limited Use Policy

Information accessed through Chrome APIs is used solely to provide the extension's single purpose: a local developer toolbox. It is not sold or transferred to third parties, not used for advertising, profiling, or creditworthiness assessments, and is never read by anyone.

## 5. Contact

<https://github.com/forestRhapsody/panda-dock/issues>
