// ==UserScript==
// @name         dkitle - Subtitle Sync
// @namespace    https://github.com/ywxt/dkitle
// @version      1.1.0
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
  // ║  I18N — Multi-language support                                   ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  const LANG_STRINGS = {
    en: {
      panelTitle: "dkitle",
      backend: "Backend",
      subtitles: "Subtitles",
      video: "Video",
      connected: "Connected",
      disconnected: "Disconnected",
      retryIn: "Retry in {s}s",
      stopped: "Stopped",
      connecting: "Connecting…",
      loaded: "Loaded ({n} cues)",
      waiting: "Waiting",
      bound: "Bound",
      unbound: "Unbound",
      retryNow: "Retry Now",
      stopRetry: "Stop Retry",
    },
    zh: {
      panelTitle: "dkitle",
      backend: "後端",
      subtitles: "字幕",
      video: "視頻",
      connected: "已連接",
      disconnected: "未連接",
      retryIn: "{s}秒後重試",
      stopped: "已停止",
      connecting: "連接中…",
      loaded: "已載入（{n}條）",
      waiting: "等待中",
      bound: "已綁定",
      unbound: "未綁定",
      retryNow: "立即重試",
      stopRetry: "停止重試",
    },
  };

  function detectLang() {
    const lang = (navigator.language || "en").toLowerCase();
    if (lang.startsWith("zh")) return "zh";
    return "en";
  }

  const currentLang = detectLang();
  const t = LANG_STRINGS[currentLang] || LANG_STRINGS.en;

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
      name: "youtube",
      urlMatch: /youtube\.com\/watch/,
      interceptUrlTest: (url) =>
        /timedtext|srv3|json3/i.test(url) && url.includes("youtube"),
      parseResponse(data) {
        const cues = [];
        if (!data?.events) return cues;
        for (const event of data.events) {
          if (!event.segs) continue;
          const text = event.segs.map((s) => s.utf8 || "").join("").trim();
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
      name: "bilibili",
      urlMatch: /bilibili\.com\/(video|bangumi\/play)/,
      interceptUrlTest: (url) =>
        /bcc\.bilibili\.com|aisubtitle\.hdslb\.com/i.test(url),
      parseResponse(data) {
        const cues = [];
        if (Array.isArray(data?.body)) {
          for (const item of data.body) {
            const text = (item.content || "").trim();
            if (!text) continue;
            const startMs = Math.max(0, Number(item.from || 0) * 1000);
            const endMs = Math.max(0, Number(item.to || 0) * 1000);
            if (endMs > startMs)
              cues.push({ start_ms: startMs, end_ms: endMs, text });
          }
        }
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
            if (endMs > startMs)
              cues.push({ start_ms: startMs, end_ms: endMs, text });
          }
        }
        return cues;
      },
    },
  ];

  function detectSite() {
    const host = location.hostname;
    if (host.includes("youtube.com")) return SITES.find((s) => s.name === "youtube");
    if (host.includes("bilibili.com")) return SITES.find((s) => s.name === "bilibili");
    return null;
  }

  const currentSite = detectSite();
  if (!currentSite) return;

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  STATE                                                           ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  const SOURCE_ID = crypto.randomUUID();
  let ws = null;
  let connected = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let reconnectTargetTime = 0; // timestamp when next retry fires
  let retryStopped = false;
  let registered = false;
  let cueCount = 0;
  let videoBound = false;

  let cachedRegister = null;
  let cachedCues = null;
  let cachedSync = null;

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  STATUS PANEL UI                                                 ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  let panelEl = null;
  let badgeEl = null;
  let panelExpanded = false;
  let uiTickTimer = null;

  // Elements updated by updateUI()
  let elBackendStatus = null;
  let elSubtitleStatus = null;
  let elVideoStatus = null;
  let elRetryBtn = null;
  let elStopBtn = null;

  // ── Drag state ──
  const DRAG_THRESHOLD = 5;
  const STORAGE_KEY = "dkitle_panel_pos";
  let savedPos = null; // { right, bottom }

  function loadPos() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) savedPos = JSON.parse(raw);
    } catch {}
    if (!savedPos) savedPos = { right: 16, bottom: 16 };
  }

  function savePos() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedPos));
    } catch {}
  }

  function applyPos(el) {
    el.style.right = savedPos.right + "px";
    el.style.bottom = savedPos.bottom + "px";
    el.style.left = "auto";
    el.style.top = "auto";
  }

  function clampPos(right, bottom, elWidth, elHeight) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    right = Math.max(0, Math.min(right, vw - elWidth));
    bottom = Math.max(0, Math.min(bottom, vh - elHeight));
    return { right, bottom };
  }

  function makeDraggable(el, opts) {
    // opts: { onClickOnly, getSize }
    let dragging = false;
    let startX, startY, startRight, startBottom;
    let moved = false;

    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      startRight = savedPos.right;
      startBottom = savedPos.bottom;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD)
        return;
      moved = true;
      const size = opts.getSize();
      const clamped = clampPos(
        startRight - dx,
        startBottom + dy,
        size.width,
        size.height
      );
      savedPos.right = clamped.right;
      savedPos.bottom = clamped.bottom;
      applyPos(el);
      // Keep the other element in sync
      if (el === badgeEl && panelEl) applyPos(panelEl);
      if (el === panelEl && badgeEl) applyPos(badgeEl);
    });

    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        savePos();
      } else if (opts.onClickOnly) {
        opts.onClickOnly();
      }
    });
  }

  function createPanel() {
    loadPos();

    // Badge (collapsed indicator)
    badgeEl = document.createElement("div");
    Object.assign(badgeEl.style, {
      position: "fixed",
      width: "32px",
      height: "32px",
      borderRadius: "50%",
      background: "#c00",
      cursor: "grab",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "system-ui, sans-serif",
      fontSize: "14px",
      fontWeight: "bold",
      color: "#fff",
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      transition: "background 0.3s",
      userSelect: "none",
    });
    applyPos(badgeEl);
    badgeEl.textContent = "D";
    badgeEl.title = "dkitle";

    makeDraggable(badgeEl, {
      onClickOnly: () => togglePanel(true),
      getSize: () => ({ width: 32, height: 32 }),
    });

    // Panel (expanded)
    panelEl = document.createElement("div");
    Object.assign(panelEl.style, {
      position: "fixed",
      width: "240px",
      background: "#1a1a2e",
      color: "#e0e0e0",
      borderRadius: "8px",
      fontFamily: "system-ui, sans-serif",
      fontSize: "13px",
      lineHeight: "1.5",
      zIndex: "2147483647",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      display: "none",
      overflow: "hidden",
      userSelect: "none",
    });
    applyPos(panelEl);

    // Header (draggable)
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "8px 12px",
      background: "#16213e",
      fontWeight: "bold",
      fontSize: "13px",
      cursor: "grab",
    });
    header.textContent = t.panelTitle;

    const collapseBtn = document.createElement("span");
    collapseBtn.textContent = "▾";
    Object.assign(collapseBtn.style, { cursor: "pointer", fontSize: "16px", lineHeight: "1" });
    collapseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanel(false);
    });
    header.appendChild(collapseBtn);
    panelEl.appendChild(header);

    makeDraggable(panelEl, {
      onClickOnly: null,
      getSize: () => ({ width: 240, height: panelEl.offsetHeight || 180 }),
    });

    // Body
    const body = document.createElement("div");
    Object.assign(body.style, { padding: "8px 12px" });

    function makeRow(label) {
      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "3px 0",
      });
      const lbl = document.createElement("span");
      lbl.textContent = label;
      Object.assign(lbl.style, { fontWeight: "500" });
      const val = document.createElement("span");
      Object.assign(val.style, { fontSize: "12px" });
      row.appendChild(lbl);
      row.appendChild(val);
      body.appendChild(row);
      return val;
    }

    elBackendStatus = makeRow(t.backend);
    elSubtitleStatus = makeRow(t.subtitles);
    elVideoStatus = makeRow(t.video);

    // Buttons
    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, {
      display: "flex",
      gap: "6px",
      marginTop: "8px",
      paddingTop: "8px",
      borderTop: "1px solid #2a2a4a",
    });

    function makeBtn(text, onClick) {
      const btn = document.createElement("button");
      btn.textContent = text;
      Object.assign(btn.style, {
        flex: "1",
        padding: "4px 0",
        border: "1px solid #444",
        borderRadius: "4px",
        background: "#2a2a4a",
        color: "#e0e0e0",
        cursor: "pointer",
        fontSize: "12px",
        fontFamily: "inherit",
      });
      btn.addEventListener("mouseenter", () => (btn.style.background = "#3a3a5a"));
      btn.addEventListener("mouseleave", () => (btn.style.background = "#2a2a4a"));
      btn.addEventListener("click", onClick);
      return btn;
    }

    elRetryBtn = makeBtn(t.retryNow, onRetryNow);
    elStopBtn = makeBtn(t.stopRetry, onStopRetry);
    btnRow.appendChild(elRetryBtn);
    btnRow.appendChild(elStopBtn);
    body.appendChild(btnRow);

    panelEl.appendChild(body);

    document.body.appendChild(badgeEl);
    document.body.appendChild(panelEl);

    // Start UI tick for countdown
    uiTickTimer = setInterval(updateUI, 1000);
    updateUI();
  }

  function togglePanel(expand) {
    panelExpanded = expand;
    if (panelExpanded) {
      badgeEl.style.display = "none";
      panelEl.style.display = "block";
    } else {
      panelEl.style.display = "none";
      badgeEl.style.display = "flex";
    }
    updateUI();
  }

  function updateUI() {
    if (!badgeEl) return;

    // Badge color
    badgeEl.style.background = connected ? "#0a0" : "#c00";

    if (!panelExpanded) return;

    // Backend status
    if (connected) {
      elBackendStatus.textContent = "🟢 " + t.connected;
    } else if (retryStopped) {
      elBackendStatus.textContent = "🔴 " + t.stopped;
    } else if (reconnectTimer) {
      const remaining = Math.max(
        0,
        Math.ceil((reconnectTargetTime - Date.now()) / 1000)
      );
      elBackendStatus.textContent =
        "🔴 " + t.retryIn.replace("{s}", remaining);
    } else {
      elBackendStatus.textContent = "🟡 " + t.connecting;
    }

    // Subtitle status
    if (cueCount > 0) {
      elSubtitleStatus.textContent =
        "🟢 " + t.loaded.replace("{n}", cueCount);
    } else {
      elSubtitleStatus.textContent = "⚪ " + t.waiting;
    }

    // Video status
    elVideoStatus.textContent = videoBound
      ? "🟢 " + t.bound
      : "⚪ " + t.unbound;

    // Button states
    elRetryBtn.disabled = connected;
    elRetryBtn.style.opacity = connected ? "0.4" : "1";
    elStopBtn.disabled = connected || retryStopped;
    elStopBtn.style.opacity = connected || retryStopped ? "0.4" : "1";
  }

  function onRetryNow() {
    if (connected) return;
    retryStopped = false;
    clearReconnectTimer();
    reconnectAttempts = 0;
    connect();
  }

  function onStopRetry() {
    if (connected) return;
    retryStopped = true;
    clearReconnectTimer();
    updateUI();
  }

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  WEBSOCKET CONNECTION                                            ║
  // ╚═══════════════════════════════════════════════════════════════════╝

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
    if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING)
      return;

    updateUI();

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
        retryStopped = false;
        clearReconnectTimer();
        resendCachedData();
        updateUI();
      };

      ws.onclose = () => {
        if (connected) console.warn("[dkitle] Disconnected from dkitle-app");
        connected = false;
        ws = null;
        scheduleReconnect();
        updateUI();
      };

      ws.onerror = () => ws?.close();
    } catch {
      connected = false;
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (retryStopped) return;
    clearReconnectTimer();
    const delay = Math.min(
      CONFIG.reconnectBaseMs * Math.pow(2, reconnectAttempts),
      CONFIG.reconnectMaxMs
    );
    reconnectAttempts++;
    reconnectTargetTime = Date.now() + delay;
    reconnectTimer = setTimeout(connect, delay);
    updateUI();
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectTargetTime = 0;
  }

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  NETWORK INTERCEPTION                                            ║
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
    cueCount = cues.length;
    const payload = {
      type: "cues",
      provider: currentSite.name,
      source_id: SOURCE_ID,
      tab_title: document.title || "",
      cues,
    };
    cachedCues = payload;
    wsSend(payload);
    updateUI();
    console.log(`[dkitle] [${currentSite.name}] Forwarded ${cues.length} cues`);
  }

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  VIDEO TIME SYNC                                                 ║
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
      if (currentSite.urlMatch && !currentSite.urlMatch.test(location.href)) return;

      const video = document.querySelector("video");
      if (!video || video === videoEl) return;
      videoEl = video;
      videoBound = true;

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

      for (const event of ["timeupdate", "play", "pause", "seeked", "ratechange"]) {
        video.addEventListener(event, () => sendSync(video));
      }
      updateUI();
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
    if (uiTickTimer) clearInterval(uiTickTimer);
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

  // Create panel after DOM is ready
  function initPanel() {
    if (document.body) {
      createPanel();
    } else {
      document.addEventListener("DOMContentLoaded", createPanel);
    }
  }
  initPanel();
})();
