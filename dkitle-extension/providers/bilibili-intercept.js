// dkitle bilibili subtitle interceptor (MAIN world)
// Registers bilibili subtitle parser with the shared interceptor base

(function () {
  "use strict";

  const SUBTITLE_PATTERN = /subtitle|bcc\.bilibili\.com|\.json(\?|$)/i;

  function normalizeCue(startSec, endSec, text) {
    const clean = (text || "").trim();
    if (!clean) return null;
    return {
      startMs: Math.max(0, Number(startSec || 0) * 1000),
      endMs: Math.max(0, Number(endSec || 0) * 1000),
      text: clean,
    };
  }

  function parseBilibiliSubtitle(data) {
    const cues = [];

    // Common subtitle body format:
    // { body: [{ from: 0.1, to: 2.3, content: "..." }] }
    if (Array.isArray(data?.body)) {
      for (const item of data.body) {
        const cue = normalizeCue(item.from, item.to, item.content);
        if (cue) cues.push(cue);
      }
    }

    // Compatibility fallback: event-like structure
    if (cues.length === 0 && Array.isArray(data?.events)) {
      for (const event of data.events) {
        const text = Array.isArray(event.segs)
          ? event.segs.map((s) => s.utf8 || "").join("")
          : event.text || "";
        const cue = normalizeCue(
          (event.tStartMs || 0) / 1000,
          ((event.tStartMs || 0) + (event.dDurMs || 0)) / 1000,
          text
        );
        if (cue) cues.push(cue);
      }
    }

    return cues.filter((cue) => cue.endMs > cue.startMs);
  }

  function register() {
    if (typeof window.__dkitleRegisterInterceptor === "function") {
      window.__dkitleRegisterInterceptor({
        name: "bilibili",
        urlTest: (url) => SUBTITLE_PATTERN.test(url) && url.includes("bilibili"),
        parseResponse: parseBilibiliSubtitle,
      });
      console.log("[dkitle] bilibili subtitle interceptor registered");
    } else {
      console.warn("[dkitle] intercept-base not loaded, retrying...");
      setTimeout(register, 50);
    }
  }

  register();
})();
