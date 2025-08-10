// bg.js (robust across Chrome/Brave/Edge)
const toolbarAction = chrome.action || chrome.browserAction;

toolbarAction.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  const onChat = /^https:\/\/(chat\.openai\.com|chatgpt\.com)\//.test(tab.url || "");
  if (!onChat) {
    chrome.tabs.create({ url: "https://chat.openai.com/" });
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "cgt:toggle" });
  } catch {
    try {
      await chrome.tabs.reload(tab.id);
      setTimeout(() => chrome.tabs.sendMessage(tab.id, { type: "cgt:toggle" }), 800);
    } catch (e) {
      console.warn("ThreadTrim toggle failed:", e);
    }
  }
});
// Listen for messages from content scripts