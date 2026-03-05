// dkitle bilibili subtitle provider (ISOLATED world)
// Built on shared provider base

(function () {
  "use strict";

  const CANDIDATE_SELECTORS = [
    ".bpx-player-subtitle-panel-text",
    ".bpx-player-subtitle-wrap .bpx-player-subtitle-panel-text",
    ".bilibili-player-video-subtitle .bilibili-player-video-subtitle-item-text",
    ".bilibili-player-video-subtitle span",
  ];

  function extractBilibiliCaption() {
    for (const selector of CANDIDATE_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      if (!nodes || nodes.length === 0) continue;
      const text = Array.from(nodes)
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }
    return "";
  }

  function register() {
    if (typeof window.__dkitleCreateProvider === "function") {
      window.__dkitleCreateProvider({
        provider: "bilibili",
        captionSelector: ".bpx-player-subtitle-panel-text",
        extractCaption: extractBilibiliCaption,
      });
    } else {
      console.warn("[dkitle] provider-base not loaded, retrying...");
      setTimeout(register, 50);
    }
  }

  register();
})();
