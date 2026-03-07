// dkitle subtitle provider base (ISOLATED world / content script)
// Receives intercepted cues and forwards to background.
// Syncs video playback time via timeupdate/pause/play/seeked events.

(function () {
  "use strict";

  window.__dkitleCreateProvider = function (config) {
    const {
      provider,
      messageType = "dkitle-subtitle-data",
    } = config;

    const SOURCE_ID = crypto.randomUUID();

    // --- Receive intercepted cues and forward to background ---

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      if (
        event.data?.type === messageType &&
        event.data?.provider === provider
      ) {
        const cues = event.data.cues || [];
        if (cues.length > 0) {
          chrome.runtime
            .sendMessage({
              type: "cues",
              provider: provider,
              sourceId: SOURCE_ID,
              cues: cues,
            })
            .catch(() => {});
          console.log(
            `[dkitle] [${provider}] Forwarded ${cues.length} cues to background`
          );
        }
      }
    });

    // --- Video time sync ---

    function sendSync(video) {
      chrome.runtime
        .sendMessage({
          type: "sync",
          sourceId: SOURCE_ID,
          videoTimeMs: video.currentTime * 1000,
          playing: !video.paused,
          playbackRate: video.playbackRate,
          timestamp: Date.now(),
        })
        .catch(() => {});
    }

    function setupVideoSync() {
      let videoEl = null;

      function bindToVideo() {
        const video = document.querySelector("video");
        if (!video || video === videoEl) return;

        videoEl = video;

        // Register this source immediately (even if no subtitles are captured yet)
        // This ensures the app knows about this video source
        chrome.runtime
          .sendMessage({
            type: "register",
            provider: provider,
            sourceId: SOURCE_ID,
          })
          .catch(() => {});
        console.log(
          `[dkitle] [${provider}] Registered source ${SOURCE_ID} (video detected)`
        );

        video.addEventListener("timeupdate", () => sendSync(video));
        video.addEventListener("play", () => sendSync(video));
        video.addEventListener("pause", () => sendSync(video));
        video.addEventListener("seeked", () => sendSync(video));
        video.addEventListener("ratechange", () => sendSync(video));

        console.log(`[dkitle] [${provider}] Bound to video sync events`);
      }

      bindToVideo();
      setInterval(bindToVideo, 2000);
    }

    // --- Init ---

    function init() {
      setupVideoSync();
      console.log(`[dkitle] [${provider}] Subtitle provider initialized`);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  };
})();
