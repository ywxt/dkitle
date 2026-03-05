// dkitle YouTube subtitle provider (ISOLATED world / content script)
// Uses intercepted timedtext data + video timeupdate for background tab support
// Falls back to DOM observation when timedtext data is not available

(function () {
  "use strict";

  const PROVIDER = "youtube";
  const SOURCE_ID = crypto.randomUUID();
  const CAPTION_SELECTOR = ".ytp-caption-segment";

  let lastText = "";
  let subtitleCues = []; // [{startMs, endMs, text}]
  let usingInterceptedData = false;

  // --- Send subtitle to background ---

  function sendSubtitle(text) {
    if (!text || text === lastText) return;
    lastText = text;
    chrome.runtime.sendMessage({
      type: "subtitle",
      provider: PROVIDER,
      sourceId: SOURCE_ID,
      text: text,
    }).catch(() => {});
  }

  // --- Method 1: Intercepted timedtext + video timeupdate ---

  // Listen for subtitle data from the MAIN world interceptor
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "dkitle-subtitle-data") {
      subtitleCues = event.data.cues || [];
      usingInterceptedData = true;
      console.log(`[dkitle] Received ${subtitleCues.length} subtitle cues from interceptor`);
    }
  });

  function findCurrentCue(timeMs) {
    for (const cue of subtitleCues) {
      if (timeMs >= cue.startMs && timeMs < cue.endMs) {
        return cue;
      }
    }
    return null;
  }

  function setupVideoTimeUpdate() {
    let videoEl = null;
    let bound = false;

    function bindToVideo() {
      const video = document.querySelector("video");
      if (!video || video === videoEl) return;

      videoEl = video;
      bound = true;

      video.addEventListener("timeupdate", () => {
        if (!usingInterceptedData || subtitleCues.length === 0) return;

        const timeMs = video.currentTime * 1000;
        const cue = findCurrentCue(timeMs);
        if (cue) {
          sendSubtitle(cue.text);
        } else {
          // Between cues — send empty to clear
          if (lastText !== "") {
            lastText = "";
            // Don't send empty, just let last subtitle stay briefly
          }
        }
      });

      console.log("[dkitle] Bound to video timeupdate");
    }

    // Try to bind immediately, and also watch for new video elements
    bindToVideo();
    setInterval(bindToVideo, 2000);
  }

  // --- Method 2: DOM observation fallback ---

  function extractCaptionText() {
    const segments = document.querySelectorAll(CAPTION_SELECTOR);
    if (segments.length === 0) return "";
    return Array.from(segments)
      .map((el) => el.textContent.trim())
      .filter(Boolean)
      .join(" ");
  }

  function startDomObserver() {
    const observer = new MutationObserver((mutations) => {
      // If we have intercepted data, skip DOM observation
      if (usingInterceptedData && subtitleCues.length > 0) return;

      let captionChanged = false;
      for (const mutation of mutations) {
        const el = mutation.target;
        if (
          el.classList?.contains("ytp-caption-segment") ||
          el.classList?.contains("caption-window") ||
          el.classList?.contains("captions-text") ||
          el.closest?.(".caption-window") ||
          el.closest?.(CAPTION_SELECTOR)
        ) {
          captionChanged = true;
          break;
        }
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (
              node.classList?.contains("ytp-caption-segment") ||
              node.classList?.contains("caption-window") ||
              node.querySelector?.(CAPTION_SELECTOR)
            ) {
              captionChanged = true;
              break;
            }
          }
        }
        if (captionChanged) break;
      }

      if (captionChanged) {
        const text = extractCaptionText();
        sendSubtitle(text);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // --- DOM fallback poll ---

  function startFallbackPoll() {
    setInterval(() => {
      // Only use DOM fallback when intercepted data is not available
      if (usingInterceptedData && subtitleCues.length > 0) return;
      const text = extractCaptionText();
      sendSubtitle(text);
    }, 500);
  }

  // --- Init ---

  function init() {
    setupVideoTimeUpdate();
    startDomObserver();
    startFallbackPoll();
    console.log("[dkitle] YouTube subtitle provider initialized");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
