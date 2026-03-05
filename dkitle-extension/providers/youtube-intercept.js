// dkitle YouTube subtitle interceptor (MAIN world)
// Registers YouTube timedtext parser with the shared interceptor base

(function () {
  "use strict";

  const TIMEDTEXT_PATTERN = /timedtext|srv3|json3/i;

  function parseTimedText(data) {
    const cues = [];
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

  // Wait for intercept-base to be ready (it loads first via manifest order)
  function register() {
    if (typeof window.__dkitleRegisterInterceptor === "function") {
      window.__dkitleRegisterInterceptor({
        name: "youtube",
        urlTest: (url) => TIMEDTEXT_PATTERN.test(url) && url.includes("youtube"),
        parseResponse: parseTimedText,
      });
      console.log("[dkitle] YouTube timedtext interceptor registered");
    } else {
      console.warn("[dkitle] intercept-base not loaded, retrying...");
      setTimeout(register, 50);
    }
  }

  register();
})();
