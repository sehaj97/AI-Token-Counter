// popup.js — Persists toggle preferences via chrome.storage.sync

const SITES = ["chatgpt", "claude", "gemini"];

// Load saved toggles
chrome.storage.sync.get(SITES.reduce((acc, s) => ({ ...acc, [`enabled_${s}`]: true }), {}), (prefs) => {
  for (const site of SITES) {
    const el = document.getElementById(`toggle-${site}`);
    if (el) el.checked = prefs[`enabled_${site}`] !== false;
  }
});

// Save on change
for (const site of SITES) {
  const el = document.getElementById(`toggle-${site}`);
  if (!el) continue;
  el.addEventListener("change", () => {
    chrome.storage.sync.set({ [`enabled_${site}`]: el.checked });
  });
}
