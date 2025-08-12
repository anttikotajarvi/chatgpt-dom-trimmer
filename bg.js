// bg.js
const action = chrome.action || chrome.browserAction;

action.onClicked.addListener(async (tab) => {
  // Only try to toggle on ChatGPT pages
  if (!/^https:\/\/(chat\.openai\.com|chatgpt\.com)\//.test(tab?.url || "")) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "cgt:toggle" });
  } catch (e) {
    // Content script not ready yet; advise user to refresh instead of reloading programmatically
    console.warn("ChatGPT DOM Trimmer: content script not ready on this page yet.", e);
  }
});
