# ChatGPT DOM Trimmer (MV3)

This Chrome/Brave/Edge extension keeps ChatGPT chats fast and memory-light by trimming old turns and offering manual GC (garbage collection) helpers — all without visually changing the conversation.

The entire extension was coded by GPT-5.  
Memory analysis and optimization design by me.

---
> **Note on UI changes:**  
> This extension depends on ChatGPT’s internal HTML/CSS structure. If OpenAI changes the DOM (class names, data attributes, etc.), some features may stop working until selectors are updated.  
>  
> The extension will let you know if any selectors are missing via its audit system. If that happens, please [open an issue](https://github.com/anttikotajarvi/threadtrim/issues) with the error details so we can push a fix quickly.

## Features

- Limit the number of chat turns in the DOM (configurable)
- Hide older turns while keeping the visible page unchanged
- Manual **GC** button:
  - Sets `content-visibility` on off-screen blocks
  - Pauses videos/media
  - Disables expensive CSS layers/animations
  - Clones & replaces off-screen turns to break React references (optional)
- Selector audit — tells you if the site’s HTML/CSS structure has changed
- Compact modal UI (no separate settings tab)
- Live counters for:
  - Loaded
  - Full
  - Thin
  - Total trimmed

---