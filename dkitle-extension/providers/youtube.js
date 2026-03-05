// dkitle YouTube subtitle provider (ISOLATED world)
// Built on shared provider base

(function () {
  "use strict";

  function extractYouTubeCaption() {
    const segments = document.querySelectorAll(".ytp-caption-segment");
    if (segments.length === 0) return "";
    return Array.from(segments)
      .map((el) => el.textContent.trim())
      .filter(Boolean)
      .join(" ");
  }

  function register() {
    if (typeof window.__dkitleCreateProvider === "function") {
      window.__dkitleCreateProvider({
        provider: "youtube",
        captionSelector: ".ytp-caption-segment",
        extractCaption: extractYouTubeCaption,
      });
    } else {
      console.warn("[dkitle] provider-base not loaded, retrying...");
      setTimeout(register, 50);
    }
  }

  register();
})();
