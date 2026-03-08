// ==UserScript==
// @name         dkitle - Subtitle Sync
// @namespace    https://github.com/ywxt/dkitle
// @version      1.0.0
// @description  Sync video subtitles from YouTube/Bilibili to the dkitle desktop overlay app
// @description:zh 将 YouTube/Bilibili 视频字幕同步到 dkitle 桌面置顶窗口
// @author       ywxt
// @match        *://*.youtube.com/*
// @match        *://*.bilibili.com/*
// @connect      127.0.0.1
// @grant        none
// @run-at       document-start
// @homepageURL  https://github.com/ywxt/dkitle
// @supportURL   https://github.com/ywxt/dkitle/issues
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  CONFIGURATION                                                   ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  const CONFIG = {
    healthUrl: "http://127.0.0.1:9877/health",
    wsUrl: "ws://127.0.0.1:9877/ws",
    reconnectBaseMs: 3000,
    reconnectMaxMs: 30000,
    videoPollIntervalMs: 2000,
  };

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  SITE DEFINITIONS                                                ║
  // ║                                                                   ║
  // ║  To add a new site:                                               ║
  // ║  1. Add a @match rule in the userscript header above              ║
  // ║  2. Add a new entry to this array                                 ║
  // ║  3. Add hostname detection in detectSite() below                  ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  const SITES = [
    {
      // ── YouTube ──────────────────────────────────────
      name: "youtube",

      // Only register video sync on watch pages (SPA-safe: script runs on all
      // youtube.com pages to catch navigations, but only binds to videos here)
      urlMatch: /youtube\.com\/watch/,

      // Match subtitle API requests (timedtext endpoint)
      interceptUrlTest: (url) =>
        /timedtext|srv3|json3/i.test(url) && url.includes("youtube"),

      // Parse YouTube's timedtext JSON into normalized cues
      parseResponse(data) {
        const cues = [];
        if (!data?.events) return cues;
        for (const event of data.events) {
          if (!event.segs) continue;
          const text = event.segs
            .map((s) => s.utf8 || "")
            .join("")
            .trim();
          if (!text) continue;
          cues.push({
            start_ms: event.tStartMs || 0,
            end_ms: (event.tStartMs || 0) + (event.dDurMs || 3000),
            text,
          });
        }
        return cues;
      },
    },

    {
      // ── Bilibili ─────────────────────────────────────
      name: "bilibili",

      // Only register on video/bangumi pages
      urlMatch: /bilibili\.com\/(video|bangumi\/play)/,

      // Match Bilibili subtitle CDN requests
      interceptUrlTest: (url) =>
        /bcc\.bilibili\.com|aisubtitle\.hdslb\.com/i.test(url),

      // Parse Bilibili subtitle JSON into normalized cues
      parseResponse(data) {
        const cues = [];

        // Standard format: { body: [{ from, to, content }] }
        if (Array.isArray(data?.body)) {
          for (const item of data.body) {
            const text = (item.content || "").trim();
            if (!text) continue;
            const startMs = Math.max(0, Number(item.from || 0) * 1000);
            const endMs = Math.max(0, Number(item.to || 0) * 1000);
            if (endMs > startMs) cues.push({ start_ms: startMs, end_ms: endMs, text });
          }
        }

        // Fallback: event-like format (rare)
        if (cues.length === 0 && Array.isArray(data?.events)) {
          for (const event of data.events) {
            const text = (
              Array.isArray(event.segs)
                ? event.segs.map((s) => s.utf8 || "").join("")
                : event.text || ""
            ).trim();
            if (!text) continue;
            const startMs = Math.max(0, event.tStartMs || 0);
            const endMs = Math.max(0, startMs + (event.dDurMs || 0));
            if (endMs > startMs) cues.push({ start_ms: startMs, end_ms: endMs, text });
          }
        }

        return cues;
      },
    },

    // ── Add new sites here ────────────────────────────
    // {
    //   name: "example",
    //   urlMatch: /example\.com\/video/,
    //   interceptUrlTest: (url) => url.includes("example.com/api/subtitles"),
    //   parseResponse(data) {
    //     return data.subtitles.map(s => ({
    //       start_ms: s.start * 1000,
    //       end_ms: s.end * 1000,
    //       text: s.text,
    //     }));
    //   },
    // },
  ];

  // ── Site detection ──────────────────────────────────

  function detectSite() {
    const host = location.hostname;
    for (const site of SITES) {
      if (host.includes(site.name === "youtube" ? "youtube.com" : "bilibili.com")) {
        return site;
      }
    }
    // For new sites, add detection logic here:
    // if (host.includes("example.com")) return SITES.find(s => s.name === "example");
    return null;
  }

  const currentSite = detectSite();
  if (!currentSite) return;

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  WEBSOCKET CONNECTION                                            ║
  // ║  Health check + exponential backoff reconnection                  ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  const SOURCE_ID = crypto.randomUUID();
  let ws = null;
  let connected = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let registered = false;

  // Cache for resending after reconnection
  let cachedRegister = null;
  let cachedCues = null;
  let cachedSync = null;

  function wsSend(data) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function resendCachedData() {
    if (cachedRegister) wsSend(cachedRegister);
    if (cachedCues) wsSend(cachedCues);
    if (cachedSync) wsSend({ ...cachedSync, timestamp: Date.now() });
  }

  async function connect() {
    if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

    // Health check first to avoid noisy console errors
    try {
      const resp = await fetch(CONFIG.healthUrl, { method: "GET" });
      if (!resp.ok) throw new Error();
    } catch {
      scheduleReconnect();
      return;
    }

    try {
      ws = new WebSocket(CONFIG.wsUrl);

      ws.onopen = () => {
        console.log("[dkitle] Connected to dkitle-app");
        connected = true;
        reconnectAttempts = 0;
        clearReconnectTimer();
        resendCachedData();
      };

      ws.onclose = () => {
        if (connected) console.warn("[dkitle] Disconnected from dkitle-app");
        connected = false;
        ws = null;
        scheduleReconnect();
      };

      ws.onerror = () => ws?.close();
    } catch {
      connected = false;
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    clearReconnectTimer();
    const delay = Math.min(
      CONFIG.reconnectBaseMs * Math.pow(2, reconnectAttempts),
      CONFIG.reconnectMaxMs
    );
    reconnectAttempts++;
    reconnectTimer = setTimeout(connect, delay);
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  NETWORK INTERCEPTION                                            ║
  // ║  Hook fetch() and XMLHttpRequest to capture subtitle responses    ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  function hookFetch() {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";

      if (currentSite.interceptUrlTest(url)) {
        response
          .clone()
          .json()
          .then((data) => {
            const cues = currentSite.parseResponse(data);
            if (cues?.length > 0) onCuesReceived(cues);
          })
          .catch(() => {});
      }

      return response;
    };
  }

  function hookXHR() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._dkitleUrl = typeof url === "string" ? url : String(url);
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      if (this._dkitleUrl && currentSite.interceptUrlTest(this._dkitleUrl)) {
        this.addEventListener("load", function () {
          try {
            const cues = currentSite.parseResponse(JSON.parse(this.responseText));
            if (cues?.length > 0) onCuesReceived(cues);
          } catch {}
        });
      }
      return originalSend.apply(this, args);
    };
  }

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  SUBTITLE FORWARDING                                             ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  function onCuesReceived(cues) {
    const payload = {
      type: "cues",
      provider: currentSite.name,
      source_id: SOURCE_ID,
      tab_title: document.title || "",
      cues,
    };
    cachedCues = payload;
    wsSend(payload);
    console.log(`[dkitle] [${currentSite.name}] Forwarded ${cues.length} cues`);
  }

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  VIDEO TIME SYNC                                                 ║
  // ║  Polls for <video> element, binds playback events                 ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  function setupVideoSync() {
    let videoEl = null;

    function sendSync(video) {
      const payload = {
        type: "sync",
        source_id: SOURCE_ID,
        video_time_ms: video.currentTime * 1000,
        playing: !video.paused,
        playback_rate: video.playbackRate,
        timestamp: Date.now(),
      };
      cachedSync = payload;
      wsSend(payload);
    }

    function bindToVideo() {
      // Only bind on matching video pages
      if (currentSite.urlMatch && !currentSite.urlMatch.test(location.href)) return;

      const video = document.querySelector("video");
      if (!video || video === videoEl) return;
      videoEl = video;

      // Register source with the desktop app
      if (!registered) {
        cachedRegister = {
          type: "register",
          provider: currentSite.name,
          source_id: SOURCE_ID,
          tab_title: document.title || "",
        };
        wsSend(cachedRegister);
        registered = true;
        console.log(`[dkitle] [${currentSite.name}] Registered source ${SOURCE_ID}`);
      }

      // Bind playback sync events
      for (const event of ["timeupdate", "play", "pause", "seeked", "ratechange"]) {
        video.addEventListener(event, () => sendSync(video));
      }
      console.log(`[dkitle] [${currentSite.name}] Bound to video sync events`);
    }

    function startPolling() {
      bindToVideo();
      setInterval(bindToVideo, CONFIG.videoPollIntervalMs);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startPolling);
    } else {
      startPolling();
    }
  }

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  CLEANUP                                                         ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  window.addEventListener("beforeunload", () => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "deactivate", source_id: SOURCE_ID }));
      ws.close();
    }
  });

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  INIT                                                            ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  console.log(`[dkitle] Userscript loaded for ${currentSite.name}`);
  hookFetch();
  hookXHR();
  connect();
  setupVideoSync();
})();
