// dkitle subtitle provider base (ISOLATED world / content script)
// Shared runtime for all video site providers
// Usage: window.__dkitleCreateProvider({ provider, captionSelector, extractCaption?, messageType? })

(function () {
  "use strict";

  window.__dkitleCreateProvider = function (config) {
    const {
      provider,
      captionSelector,
      extractCaption,
      messageType = "dkitle-subtitle-data",
    } = config;

    const SOURCE_ID = crypto.randomUUID();
    let lastText = "";
    let subtitleCues = []; // [{startMs, endMs, text}]
    let usingInterceptedData = false;

    // --- Send subtitle to background ---

    function sendSubtitle(text) {
      if (!text || text === lastText) return;
      lastText = text;
      chrome.runtime.sendMessage({
        type: "subtitle",
        provider: provider,
        sourceId: SOURCE_ID,
        text: text,
      }).catch(() => {});
    }

    // --- Method 1: Intercepted data + video timeupdate ---

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      if (event.data?.type === messageType && event.data?.provider === provider) {
        subtitleCues = event.data.cues || [];
        usingInterceptedData = true;
        console.log(
          `[dkitle] [${provider}] Received ${subtitleCues.length} subtitle cues from interceptor`
        );
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

      function bindToVideo() {
        const video = document.querySelector("video");
        if (!video || video === videoEl) return;

        videoEl = video;

        video.addEventListener("timeupdate", () => {
          if (!usingInterceptedData || subtitleCues.length === 0) return;

          const timeMs = video.currentTime * 1000;
          const cue = findCurrentCue(timeMs);
          if (cue) {
            sendSubtitle(cue.text);
          } else {
            if (lastText !== "") {
              lastText = "";
            }
          }
        });

        console.log(`[dkitle] [${provider}] Bound to video timeupdate`);
      }

      bindToVideo();
      setInterval(bindToVideo, 2000);
    }

    // --- Method 2: DOM observation fallback ---

    function extractCaptionText() {
      if (typeof extractCaption === "function") {
        return extractCaption();
      }
      if (!captionSelector) return "";
      const segments = document.querySelectorAll(captionSelector);
      if (segments.length === 0) return "";
      return Array.from(segments)
        .map((el) => el.textContent.trim())
        .filter(Boolean)
        .join(" ");
    }

    function startDomObserver() {
      if (!captionSelector) return;

      const observer = new MutationObserver(() => {
        if (usingInterceptedData && subtitleCues.length > 0) return;
        const text = extractCaptionText();
        sendSubtitle(text);
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    function startFallbackPoll() {
      if (!captionSelector && typeof extractCaption !== "function") return;

      setInterval(() => {
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
      console.log(`[dkitle] [${provider}] Subtitle provider initialized`);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  };
})();
