// dkitle YouTube subtitle interceptor (runs in MAIN world / page context)
// Intercepts YouTube's timedtext API responses to capture subtitle data

(function () {
  "use strict";

  const TIMEDTEXT_PATTERN = /timedtext|srv3|json3/i;

  // Hook fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";

    if (TIMEDTEXT_PATTERN.test(url) && url.includes("youtube")) {
      try {
        const cloned = response.clone();
        cloned.json().then((data) => {
          const cues = parseTimedText(data);
          if (cues.length > 0) {
            window.postMessage(
              { type: "dkitle-subtitle-data", cues },
              "*"
            );
          }
        }).catch(() => {});
      } catch (_) {}
    }

    return response;
  };

  // Hook XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._dkitleUrl = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this._dkitleUrl && TIMEDTEXT_PATTERN.test(this._dkitleUrl)) {
      this.addEventListener("load", function () {
        try {
          const data = JSON.parse(this.responseText);
          const cues = parseTimedText(data);
          if (cues.length > 0) {
            window.postMessage(
              { type: "dkitle-subtitle-data", cues },
              "*"
            );
          }
        } catch (_) {}
      });
    }
    return originalXHRSend.apply(this, args);
  };

  // Parse YouTube's timedtext JSON format into simple cue objects
  function parseTimedText(data) {
    const cues = [];

    // Format: { events: [{ tStartMs, dDurMs, segs: [{ utf8 }] }] }
    if (data && data.events) {
      for (const event of data.events) {
        if (!event.segs) continue;
        const text = event.segs
          .map((s) => s.utf8 || "")
          .join("")
          .trim();
        if (!text) continue;

        cues.push({
          startMs: event.tStartMs || 0,
          endMs: (event.tStartMs || 0) + (event.dDurMs || 3000),
          text,
        });
      }
    }

    return cues;
  }

  console.log("[dkitle] YouTube timedtext interceptor loaded");
})();
