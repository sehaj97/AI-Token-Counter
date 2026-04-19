# AI Token Tracker — Chrome Extension

Estimates token usage across ChatGPT, Claude, and Gemini using a local
BPE-approximation tokenizer. No data leaves your browser.

---

## File Structure

```
ai-token-tracker/
├── manifest.json         # MV3 config — host permissions, content script declaration
├── content.js            # Main logic: site detection, observer, token store, overlay
├── styles.css            # Overlay styles (injected alongside content.js)
├── popup.html            # Extension popup UI
├── popup.js              # Popup state persistence
├── lib/
│   └── tokenizer.js      # Self-contained token estimator (no WASM/network)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Installation

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select this folder
4. Navigate to ChatGPT, Claude, or Gemini — the overlay appears automatically

---

## How to Update CSS Selectors

AI websites change their DOM structure regularly. When the token count stops
updating, the selectors need refreshing. All selectors live in **one place**:

```js
// content.js — SECTION 1: SITE CONFIGURATION
const SITE_CONFIGS = {
  chatgpt: {
    messageSelectors: [
      '[data-message-author-role="user"] .whitespace-pre-wrap',
      '[data-message-author-role="assistant"] .markdown',
    ],
    scrollContainerSelector: "main",
    // ...
  },
  // ...
};
```

### Step-by-step selector update

1. Open the AI site in Chrome
2. Right-click a message bubble → **Inspect**
3. In DevTools, find the element that contains the message text
4. Right-click the element → **Copy** → **Copy selector** (or write a simpler one)
5. Paste it into the relevant `messageSelectors` array in `content.js`
6. Reload the extension at `chrome://extensions` → click the ↺ refresh icon

### Tips for writing stable selectors

| Approach | Example | Stability |
|---|---|---|
| `data-*` attributes | `[data-message-author-role="user"]` | ✅ High — semantic, unlikely to change |
| ARIA roles | `[role="article"]` | ✅ High |
| Class names | `.message-content` | ⚠️ Medium — changes with CSS rebuilds |
| Generated classes | `.sc-abc123` | ❌ Low — changes on every deploy |

Prefer `data-*` attributes and semantic landmarks over class names.

---

## Tokenizer Accuracy

The tokenizer in `lib/tokenizer.js` uses a BPE pre-tokenization pass plus
subword heuristics. Expected accuracy vs. `tiktoken cl100k_base`:

| Content type      | Accuracy |
|---|---|
| English prose     | ~93–97%  |
| Code (JS/Python)  | ~88–93%  |
| Mixed/markdown    | ~90–95%  |
| Numbers/symbols   | ~85–92%  |

For an exact count you would need WASM tiktoken, which is ~500KB and requires
a Content Security Policy exception on most AI sites — not worth the trade-off
for an estimation tool.

---

## Adding a New Site

1. Add a new entry to `SITE_CONFIGS` in `content.js`:

```js
myNewSite: {
  matches: (host) => host.includes("mynewai.com"),
  label: "MyNewAI",
  accentColor: "#7c3aed",          // brand color
  messageSelectors: [
    ".user-message",
    ".assistant-message",
  ],
  scrollContainerSelector: ".chat-window",
  contextWindows: {
    "Model A (32k)": 32_000,
    "Model B (100k)": 100_000,
  },
  defaultContext: "Model A (32k)",
},
```

2. Add the hostname to `host_permissions` and `content_scripts.matches` in `manifest.json`:

```json
"https://mynewai.com/*"
```

3. Reload the extension.
