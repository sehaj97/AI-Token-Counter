/**
 * content.js — AI Token Tracker
 *
 * Architecture:
 *   SiteConfig   → defines selectors per domain (EDIT HERE to update)
 *   TokenStore   → accumulates token counts, survives DOM reflows
 *   SessionStore → persists offset + custom models to localStorage
 *   Observer     → MutationObserver that watches for new message nodes
 *   Overlay      → floating draggable UI injected into the page
 */

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: SITE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const SITE_CONFIGS = {
  chatgpt: {
    matches: (host) => host.includes("chatgpt.com") || host.includes("chat.openai.com"),
    label: "ChatGPT",
    accentColor: "#10a37f",
    messageSelectors: [
      '[data-message-author-role="user"] .whitespace-pre-wrap',
      '[data-message-author-role="assistant"] .markdown',
    ],
    scrollContainerSelector: "main",
    contextWindows: {
      "GPT-4o (128k)": 128000,
      "GPT-4 Turbo (128k)": 128000,
      "GPT-3.5 (16k)": 16385,
      "GPT-4o mini (128k)": 128000,
    },
    defaultContext: "GPT-4o (128k)",
  },

  claude: {
    matches: (host) => host.includes("claude.ai"),
    label: "Claude",
    accentColor: "#d97757",
    messageSelectors: [
      '[data-testid="human-turn-text"]',
      '[data-testid="assistant-turn"] .prose',
    ],
    scrollContainerSelector: '[data-testid="conversation-content"]',
    contextWindows: {
      "Claude 3.5 Sonnet (200k)": 200000,
      "Claude 3 Opus (200k)": 200000,
      "Claude 3 Haiku (200k)": 200000,
      "Claude Instant (100k)": 100000,
    },
    defaultContext: "Claude 3.5 Sonnet (200k)",
  },

  gemini: {
    matches: (host) => host.includes("gemini.google.com") || host.includes("aistudio.google.com"),
    label: "Gemini",
    accentColor: "#4285f4",
    messageSelectors: [
      ".user-query-text",
      ".model-response-text",
      "message-content .markdown",
    ],
    scrollContainerSelector: ".conversation-container, chat-history",
    contextWindows: {
      "Gemini 1.5 Pro (1M)": 1000000,
      "Gemini 1.5 Flash (1M)": 1000000,
      "Gemini 1.0 Pro (32k)": 32000,
    },
    defaultContext: "Gemini 1.5 Pro (1M)",
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: SITE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

function detectSite() {
  const host = window.location.hostname;
  for (const key of Object.keys(SITE_CONFIGS)) {
    if (SITE_CONFIGS[key].matches(host)) return SITE_CONFIGS[key];
  }
  return null;
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: SESSION STORE
// Persists position, context, manual offset, and custom models via localStorage.
// All keys are "att-" namespaced to avoid collisions with the host page.
// ─────────────────────────────────────────────────────────────────────────────

const SessionStore = (() => {
  const KEYS = {
    x: "att-x",
    y: "att-y",
    context: "att-context",
    offset: "att-offset",
    customModels: "att-custom-models",
  };

  const get = (key) => localStorage.getItem(KEYS[key]);
  const set = (key, val) => localStorage.setItem(KEYS[key], val);

  function clearAll() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  }

  function getCustomModels() {
    try { return JSON.parse(get("customModels") || "{}"); }
    catch { return {}; }
  }

  function saveCustomModels(obj) {
    set("customModels", JSON.stringify(obj));
  }

  function addCustomModel(name, limit) {
    const m = getCustomModels();
    m[name] = limit;
    saveCustomModels(m);
  }

  function getOffset() { return parseInt(get("offset") || "0", 10) || 0; }
  function setOffset(n) { set("offset", String(n)); }

  return { get, set, clearAll, getCustomModels, addCustomModel, getOffset, setOffset };
})();


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: TOKEN STORE
// ─────────────────────────────────────────────────────────────────────────────

const TokenStore = (() => {
  const nodeMap = new Map();
  let observedTotal = 0;
  let nodeCounter = 0;
  const NODE_ID_ATTR = "data-att-id";

  function getOrAssignId(el) {
    if (!el.getAttribute(NODE_ID_ATTR)) {
      el.setAttribute(NODE_ID_ATTR, "att-" + (++nodeCounter));
    }
    return el.getAttribute(NODE_ID_ATTR);
  }

  function update(el) {
    const text = el.innerText || el.textContent || "";
    const newCount = window.AITokenizer.estimateTokens(text);
    const id = getOrAssignId(el);
    const oldCount = nodeMap.get(id) || 0;
    const delta = newCount - oldCount;
    observedTotal = Math.max(0, observedTotal + delta);
    nodeMap.set(id, newCount);
    return delta !== 0;
  }

  function resetObserved() {
    nodeMap.clear();
    observedTotal = 0;
  }

  // Total = saved offset + what the observer counted in this session
  function getTotal() {
    return SessionStore.getOffset() + observedTotal;
  }

  return { update, resetObserved, getTotal };
})();


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: OBSERVER
// ─────────────────────────────────────────────────────────────────────────────

function buildObserver(config, onUpdate) {
  function scanAll() {
    let changed = false;
    for (const selector of config.messageSelectors) {
      document.querySelectorAll(selector).forEach(node => {
        if (TokenStore.update(node)) changed = true;
      });
    }
    if (changed) onUpdate();
  }

  scanAll();

  const observer = new MutationObserver(scanAll);
  const root = (config.scrollContainerSelector &&
    document.querySelector(config.scrollContainerSelector)) || document.body;

  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return observer;
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: DOWNLOAD / RESTORE SESSION
// ─────────────────────────────────────────────────────────────────────────────

function downloadSession(siteLabel, tokens, contextName, contextMax) {
  const ts = new Date().toISOString();
  const lines = [
    "# AI Token Tracker — Session Snapshot",
    "# Generated: " + ts,
    "# To restore: open the overlay → Settings → Restore from file",
    "",
    "site=" + siteLabel,
    "timestamp=" + ts,
    "tokens=" + tokens,
    "context_name=" + contextName,
    "context_max=" + contextMax,
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "token-session-" + siteLabel.toLowerCase() + "-" + Date.now() + ".txt";
  a.click();
  URL.revokeObjectURL(url);
}

function parseSessionFile(text) {
  const match = text.match(/^tokens=(\d+)/m);
  return match ? parseInt(match[1], 10) : null;
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: OVERLAY UI
// ─────────────────────────────────────────────────────────────────────────────

function createOverlay(config) {
  function buildContextWindows() {
    return Object.assign({}, config.contextWindows, SessionStore.getCustomModels());
  }

  let contextWindows = buildContextWindows();
  const savedCtx = SessionStore.get("context") || config.defaultContext;
  let activeContext = contextWindows[savedCtx] ? savedCtx : config.defaultContext;
  let contextMax = contextWindows[activeContext];

  // ── Build DOM ──────────────────────────────────────────────────────────────
  const el = document.createElement("div");
  el.id = "att-overlay";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-label", "Token usage tracker");

  el.innerHTML =
    '<div id="att-header">' +
    '<span id="att-site-label">' + config.label + '</span>' +
    '<button id="att-settings-btn" title="Settings" aria-label="Open settings">&#9881;</button>' +
    '</div>' +

    '<div id="att-counts">' +
    '<span id="att-token-count">0</span>' +
    '<span id="att-divider">/</span>' +
    '<span id="att-context-max">' + contextMax.toLocaleString() + '</span>' +
    '</div>' +

    '<div id="att-bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
    '<div id="att-bar-fill"></div>' +
    '<div id="att-bar-glow"></div>' +
    '</div>' +

    '<div id="att-meta">' +
    '<span id="att-percent">0%</span>' +
    '<span id="att-remaining">—</span>' +
    '</div>' +

    '<div id="att-encoding-badge"></div>' +

    '<div id="att-settings-panel" hidden>' +

    // Context window
    '<div class="att-field-group">' +
    '<label for="att-context-select">Context window</label>' +
    '<select id="att-context-select">' +
    Object.keys(contextWindows).map(function (k) {
      return '<option value="' + k + '"' + (k === activeContext ? ' selected' : '') + '>' + k + '</option>';
    }).join('') +
    '</select>' +
    '</div>' +

    '<div class="att-divider-line"></div>' +

    // Add custom model
    '<div class="att-field-group">' +
    '<label>Add custom model</label>' +
    '<input id="att-model-name"  type="text"   placeholder="Model name (e.g. o3 mini)" />' +
    '<input id="att-model-limit" type="number" placeholder="Context limit (tokens)" min="1" />' +
    '<button id="att-add-model-btn" class="att-btn att-btn-accent">Add model</button>' +
    '</div>' +

    '<div class="att-divider-line"></div>' +

    // Set start count
    '<div class="att-field-group">' +
    '<label>Set start count</label>' +
    '<input id="att-offset-input" type="number" placeholder="e.g. 12500" min="0" />' +
    '<button id="att-set-offset-btn" class="att-btn att-btn-accent">Apply offset</button>' +
    '</div>' +

    '<div class="att-divider-line"></div>' +

    // Session
    '<div class="att-field-group">' +
    '<label>Session</label>' +
    '<button id="att-download-btn" class="att-btn">&#8595; Download snapshot</button>' +

    '</div>' +

    '<div class="att-divider-line"></div>' +

    // Reset / clear
    '<div class="att-field-group">' +
    '<label>Reset</label>' +
    '<button id="att-reset-count-btn"   class="att-btn att-btn-warn">Reset token count</button>' +
    '<button id="att-clear-storage-btn" class="att-btn att-btn-danger">Clear all saved data</button>' +
    '</div>' +

    '<div id="att-toast" hidden></div>' +
    '</div>';

  document.body.appendChild(el);
  el.style.setProperty("--att-accent", config.accentColor);

  // Restore position
  var savedX = parseFloat(SessionStore.get("x") || "-1");
  var savedY = parseFloat(SessionStore.get("y") || "-1");
  if (savedX >= 0 && savedY >= 0) {
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.left = savedX + "px";
    el.style.top = savedY + "px";
  }

  // ── Dragging ───────────────────────────────────────────────────────────────
  var dragging = false, dragOffsetX = 0, dragOffsetY = 0;
  var header = el.querySelector("#att-header");

  header.addEventListener("mousedown", function (e) {
    dragging = true;
    var rect = el.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    el.style.right = el.style.bottom = "auto";
    el.style.transition = "none";
    e.preventDefault();
  });
  document.addEventListener("mousemove", function (e) {
    if (!dragging) return;
    el.style.left = (e.clientX - dragOffsetX) + "px";
    el.style.top = (e.clientY - dragOffsetY) + "px";
  });
  document.addEventListener("mouseup", function () {
    if (!dragging) return;
    dragging = false;
    el.style.transition = "";
    var rect = el.getBoundingClientRect();
    SessionStore.set("x", rect.left);
    SessionStore.set("y", rect.top);
  });

  // ── Toast ──────────────────────────────────────────────────────────────────
  var toast = el.querySelector("#att-toast");
  var toastTimer = null;
  function showToast(msg, type) {
    toast.textContent = msg;
    toast.dataset.type = type || "ok";
    toast.removeAttribute("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.setAttribute("hidden", ""); }, 2800);
  }

  // ── Settings panel toggle ──────────────────────────────────────────────────
  var settingsBtn = el.querySelector("#att-settings-btn");
  var settingsPanel = el.querySelector("#att-settings-panel");

  settingsBtn.addEventListener("click", function () {
    var isHidden = settingsPanel.hasAttribute("hidden");
    settingsPanel.toggleAttribute("hidden", !isHidden);
    settingsBtn.textContent = isHidden ? "✕" : "⚙";
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  var fill = el.querySelector("#att-bar-fill");
  var glow = el.querySelector("#att-bar-glow");
  var countEl = el.querySelector("#att-token-count");
  var percentEl = el.querySelector("#att-percent");
  var remainingEl = el.querySelector("#att-remaining");
  var contextMaxEl = el.querySelector("#att-context-max");
  var track = el.querySelector("#att-bar-track");
  var encodingBadge = el.querySelector("#att-encoding-badge");

  // Update encoding badge once (it won't change mid-session)
  function updateEncodingBadge() {
    var modelName = window.AITokenizer.getActiveModel();
    var encName = "";
    try { encName = window.AITokenizer.encodingNameForModel(modelName); } catch (_) { }
    // Show encoding family if we have it, else show model name
    var label = encName ? encName : modelName;
    encodingBadge.textContent = label;
    encodingBadge.title = "Tiktoken encoding: " + label + " (model: " + modelName + ")";
  }

  function render(tokens) {
    var pct = Math.min(100, (tokens / contextMax) * 100);
    var remaining = Math.max(0, contextMax - tokens);

    countEl.textContent = tokens.toLocaleString();
    percentEl.textContent = pct.toFixed(1) + "%";
    remainingEl.textContent = remaining.toLocaleString() + " left";
    fill.style.width = pct + "%";
    glow.style.width = pct + "%";

    el.classList.toggle("att-warn", pct >= 75 && pct < 90);
    el.classList.toggle("att-danger", pct >= 90);
    track.setAttribute("aria-valuenow", Math.round(pct));
  }

  // Run badge update after a short delay so model detection can read the DOM
  setTimeout(updateEncodingBadge, 1200);

  // Rebuild <select> after model added / storage cleared
  var contextSelect = el.querySelector("#att-context-select");
  function rebuildSelect() {
    contextWindows = buildContextWindows();
    contextSelect.innerHTML = Object.keys(contextWindows).map(function (k) {
      return '<option value="' + k + '"' + (k === activeContext ? ' selected' : '') + '>' + k + '</option>';
    }).join('');
  }

  // ── Context selector ───────────────────────────────────────────────────────
  contextSelect.addEventListener("change", function () {
    activeContext = contextSelect.value;
    contextMax = contextWindows[activeContext];
    contextMaxEl.textContent = contextMax.toLocaleString();
    SessionStore.set("context", activeContext);
    render(TokenStore.getTotal());
  });

  // ── Add custom model ───────────────────────────────────────────────────────
  var modelNameInput = el.querySelector("#att-model-name");
  var modelLimitInput = el.querySelector("#att-model-limit");

  el.querySelector("#att-add-model-btn").addEventListener("click", function () {
    var name = modelNameInput.value.trim();
    var limit = parseInt(modelLimitInput.value, 10);
    if (!name) return showToast("Enter a model name.", "error");
    if (!limit || limit < 1) return showToast("Enter a valid token limit.", "error");

    SessionStore.addCustomModel(name, limit);
    rebuildSelect();
    modelNameInput.value = "";
    modelLimitInput.value = "";
    showToast('"' + name + '" added.');
  });

  // ── Set start count / offset ───────────────────────────────────────────────
  var offsetInput = el.querySelector("#att-offset-input");

  el.querySelector("#att-set-offset-btn").addEventListener("click", function () {
    var val = parseInt(offsetInput.value, 10);
    if (isNaN(val) || val < 0) return showToast("Enter a non-negative number.", "error");
    SessionStore.setOffset(val);
    offsetInput.value = "";
    render(TokenStore.getTotal());
    showToast("Start count set to " + val.toLocaleString() + ".");
  });

  // ── Download snapshot ──────────────────────────────────────────────────────
  el.querySelector("#att-download-btn").addEventListener("click", function () {
    downloadSession(config.label, TokenStore.getTotal(), activeContext, contextMax);
    showToast("Snapshot downloaded.");
  });

  // ── Restore from file ──────────────────────────────────────────────────────
  el.querySelector("#att-restore-input").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      var count = parseSessionFile(ev.target.result);
      if (count === null) return showToast("Couldn't read count from file.", "error");
      SessionStore.setOffset(count);
      TokenStore.resetObserved();
      render(TokenStore.getTotal());
      showToast("Session restored: " + count.toLocaleString() + " tokens.");
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // ── Reset token count ──────────────────────────────────────────────────────
  el.querySelector("#att-reset-count-btn").addEventListener("click", function () {
    SessionStore.setOffset(0);
    TokenStore.resetObserved();
    render(0);
    showToast("Token count reset.");
  });

  // ── Clear ALL saved data ───────────────────────────────────────────────────
  el.querySelector("#att-clear-storage-btn").addEventListener("click", function () {
    if (!confirm("Clear all saved data? This removes position, custom models, offset, and context preference.")) return;
    SessionStore.clearAll();
    TokenStore.resetObserved();
    contextWindows = buildContextWindows();
    activeContext = config.defaultContext;
    contextMax = config.contextWindows[activeContext];
    contextMaxEl.textContent = contextMax.toLocaleString();
    rebuildSelect();
    render(0);
    showToast("All saved data cleared.");
  });

  render(TokenStore.getTotal());
  return { render };
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: INIT
// ─────────────────────────────────────────────────────────────────────────────

(function init() {
  var config = detectSite();
  if (!config) return;

  function start() {
    var overlay = createOverlay(config);
    buildObserver(config, function () { overlay.render(TokenStore.getTotal()); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    setTimeout(start, 800);
  }
})();
