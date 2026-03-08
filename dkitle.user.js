// ==UserScript==
// @name         dkitle - Subtitle Sync
// @namespace    https://github.com/ywxt/dkitle
// @version      1.2.0
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
  // ║  I18N                                                            ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  const LANG_STRINGS = {
    en: {
      panelTitle: "dkitle",
      backend: "Backend",
      subtitles: "Subtitles",
      video: "Video",
      connected: "Connected",
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
    return lang.startsWith("zh") ? "zh" : "en";
  }

  const T = LANG_STRINGS[detectLang()] || LANG_STRINGS.en;

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  SITE DEFINITIONS                                                ║
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
        for (const ev of data.events) {
          if (!ev.segs) continue;
          const text = ev.segs.map((s) => s.utf8 || "").join("").trim();
          if (!text) continue;
          cues.push({
            start_ms: ev.tStartMs || 0,
            end_ms: (ev.tStartMs || 0) + (ev.dDurMs || 3000),
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
            const s = Math.max(0, Number(item.from || 0) * 1000);
            const e = Math.max(0, Number(item.to || 0) * 1000);
            if (e > s) cues.push({ start_ms: s, end_ms: e, text });
          }
        }
        if (cues.length === 0 && Array.isArray(data?.events)) {
          for (const ev of data.events) {
            const text = (
              Array.isArray(ev.segs)
                ? ev.segs.map((s) => s.utf8 || "").join("")
                : ev.text || ""
            ).trim();
            if (!text) continue;
            const s = Math.max(0, ev.tStartMs || 0);
            const e = Math.max(0, s + (ev.dDurMs || 0));
            if (e > s) cues.push({ start_ms: s, end_ms: e, text });
          }
        }
        return cues;
      },
    },
  ];

  function detectSite() {
    const h = location.hostname;
    if (h.includes("youtube.com")) return SITES.find((s) => s.name === "youtube");
    if (h.includes("bilibili.com")) return SITES.find((s) => s.name === "bilibili");
    return null;
  }

  const SITE = detectSite();
  if (!SITE) return;

  const SOURCE_ID = crypto.randomUUID();

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  ConnectionManager                                               ║
  // ║  WebSocket lifecycle, reconnection, message caching               ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  class ConnectionManager {
    constructor(config, onStateChange) {
      this._config = config;
      this._onStateChange = onStateChange;

      this._ws = null;
      this._connected = false;
      this._reconnectAttempts = 0;
      this._reconnectTimer = null;
      this._reconnectTargetTime = 0;
      this._retryStopped = false;

      this._cache = { register: null, cues: null, sync: null };
    }

    get connected() { return this._connected; }
    get retryStopped() { return this._retryStopped; }
    get reconnectTargetTime() { return this._reconnectTargetTime; }
    get hasReconnectTimer() { return this._reconnectTimer !== null; }

    send(data) {
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify(data));
      }
    }

    cacheAndSend(key, payload) {
      this._cache[key] = payload;
      this.send(payload);
    }

    async connect() {
      if (this._ws?.readyState === WebSocket.OPEN ||
          this._ws?.readyState === WebSocket.CONNECTING) return;

      this._notify();

      try {
        const resp = await fetch(this._config.healthUrl, { method: "GET" });
        if (!resp.ok) throw new Error();
      } catch {
        this._scheduleReconnect();
        return;
      }

      try {
        this._ws = new WebSocket(this._config.wsUrl);

        this._ws.onopen = () => {
          console.log("[dkitle] Connected to dkitle-app");
          this._connected = true;
          this._reconnectAttempts = 0;
          this._retryStopped = false;
          this._clearReconnectTimer();
          this._resendCache();
          this._notify();
        };

        this._ws.onclose = () => {
          if (this._connected) console.warn("[dkitle] Disconnected");
          this._connected = false;
          this._ws = null;
          this._scheduleReconnect();
          this._notify();
        };

        this._ws.onerror = () => this._ws?.close();
      } catch {
        this._connected = false;
        this._scheduleReconnect();
      }
    }

    retryNow() {
      if (this._connected) return;
      this._retryStopped = false;
      this._clearReconnectTimer();
      this._reconnectAttempts = 0;
      this.connect();
    }

    stopRetry() {
      if (this._connected) return;
      this._retryStopped = true;
      this._clearReconnectTimer();
      this._notify();
    }

    close() {
      if (this._ws?.readyState === WebSocket.OPEN) {
        this.send({ type: "deactivate", source_id: SOURCE_ID });
        this._ws.close();
      }
      this._clearReconnectTimer();
    }

    // ── private ──

    _resendCache() {
      if (this._cache.register) this.send(this._cache.register);
      if (this._cache.cues) this.send(this._cache.cues);
      if (this._cache.sync) this.send({ ...this._cache.sync, timestamp: Date.now() });
    }

    _scheduleReconnect() {
      if (this._retryStopped) return;
      this._clearReconnectTimer();
      const delay = Math.min(
        this._config.reconnectBaseMs * Math.pow(2, this._reconnectAttempts),
        this._config.reconnectMaxMs
      );
      this._reconnectAttempts++;
      this._reconnectTargetTime = Date.now() + delay;
      this._reconnectTimer = setTimeout(() => this.connect(), delay);
      this._notify();
    }

    _clearReconnectTimer() {
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
      this._reconnectTargetTime = 0;
    }

    _notify() {
      this._onStateChange?.();
    }
  }

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  SubtitleSync                                                    ║
  // ║  Network interception + video time sync                           ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  class SubtitleSync {
    constructor(site, sourceId, conn, onStateChange) {
      this._site = site;
      this._sourceId = sourceId;
      this._conn = conn;
      this._onStateChange = onStateChange;

      this._videoEl = null;
      this._registered = false;
      this._cueCount = 0;
      this._videoBound = false;
    }

    get cueCount() { return this._cueCount; }
    get videoBound() { return this._videoBound; }

    hookFetch() {
      const self = this;
      const originalFetch = window.fetch;
      window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
        if (self._site.interceptUrlTest(url)) {
          response.clone().json()
            .then((data) => {
              const cues = self._site.parseResponse(data);
              if (cues?.length > 0) self._onCues(cues);
            })
            .catch(() => {});
        }
        return response;
      };
    }

    hookXHR() {
      const self = this;
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._dkitleUrl = typeof url === "string" ? url : String(url);
        return origOpen.call(this, method, url, ...rest);
      };

      XMLHttpRequest.prototype.send = function (...args) {
        if (this._dkitleUrl && self._site.interceptUrlTest(this._dkitleUrl)) {
          this.addEventListener("load", function () {
            try {
              const cues = self._site.parseResponse(JSON.parse(this.responseText));
              if (cues?.length > 0) self._onCues(cues);
            } catch {}
          });
        }
        return origSend.apply(this, args);
      };
    }

    startVideoSync() {
      const poll = () => {
        this._tryBindVideo();
        setInterval(() => this._tryBindVideo(), CONFIG.videoPollIntervalMs);
      };

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", poll);
      } else {
        poll();
      }
    }

    // ── private ──

    _onCues(cues) {
      this._cueCount = cues.length;
      this._conn.cacheAndSend("cues", {
        type: "cues",
        provider: this._site.name,
        source_id: this._sourceId,
        tab_title: document.title || "",
        cues,
      });
      this._onStateChange?.();
      console.log(`[dkitle] [${this._site.name}] Forwarded ${cues.length} cues`);
    }

    _sendSync(video) {
      this._conn.cacheAndSend("sync", {
        type: "sync",
        source_id: this._sourceId,
        video_time_ms: video.currentTime * 1000,
        playing: !video.paused,
        playback_rate: video.playbackRate,
        timestamp: Date.now(),
      });
    }

    _tryBindVideo() {
      if (this._site.urlMatch && !this._site.urlMatch.test(location.href)) return;

      const video = document.querySelector("video");
      if (!video || video === this._videoEl) return;
      this._videoEl = video;
      this._videoBound = true;

      if (!this._registered) {
        this._conn.cacheAndSend("register", {
          type: "register",
          provider: this._site.name,
          source_id: this._sourceId,
          tab_title: document.title || "",
        });
        this._registered = true;
        console.log(`[dkitle] [${this._site.name}] Registered source ${this._sourceId}`);
      }

      for (const ev of ["timeupdate", "play", "pause", "seeked", "ratechange"]) {
        video.addEventListener(ev, () => this._sendSync(video));
      }
      this._onStateChange?.();
      console.log(`[dkitle] [${this._site.name}] Bound to video sync events`);
    }
  }

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  StatusPanel                                                     ║
  // ║  Floating UI badge + expandable panel with drag support           ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  class StatusPanel {
    static DRAG_THRESHOLD = 5;

    constructor(siteName, conn, sync) {
      this._conn = conn;
      this._sync = sync;
      this._storageKey = `dkitle_panel_pos_${siteName}`;

      this._badge = null;
      this._panel = null;
      this._expanded = false;
      this._tickTimer = null;
      this._pos = { right: 16, bottom: 16 };

      // DOM refs updated by updateUI
      this._elBackend = null;
      this._elSubtitles = null;
      this._elVideo = null;
      this._elRetryBtn = null;
      this._elStopBtn = null;
    }

    create() {
      this._loadPos();
      this._createBadge();
      this._createPanel();

      document.body.appendChild(this._badge);
      document.body.appendChild(this._panel);

      this._tickTimer = setInterval(() => this.updateUI(), 1000);
      this.updateUI();
    }

    destroy() {
      if (this._tickTimer) clearInterval(this._tickTimer);
    }

    updateUI() {
      if (!this._badge) return;

      this._badge.style.background = this._conn.connected ? "#0a0" : "#c00";

      if (!this._expanded) return;

      // Backend
      if (this._conn.connected) {
        this._elBackend.textContent = "🟢 " + T.connected;
      } else if (this._conn.retryStopped) {
        this._elBackend.textContent = "🔴 " + T.stopped;
      } else if (this._conn.hasReconnectTimer) {
        const s = Math.max(0, Math.ceil((this._conn.reconnectTargetTime - Date.now()) / 1000));
        this._elBackend.textContent = "🔴 " + T.retryIn.replace("{s}", s);
      } else {
        this._elBackend.textContent = "🟡 " + T.connecting;
      }

      // Subtitles
      const n = this._sync.cueCount;
      this._elSubtitles.textContent = n > 0
        ? "🟢 " + T.loaded.replace("{n}", n)
        : "⚪ " + T.waiting;

      // Video
      this._elVideo.textContent = this._sync.videoBound
        ? "🟢 " + T.bound
        : "⚪ " + T.unbound;

      // Buttons
      const c = this._conn.connected;
      this._elRetryBtn.disabled = c;
      this._elRetryBtn.style.opacity = c ? "0.4" : "1";
      this._elStopBtn.disabled = c || this._conn.retryStopped;
      this._elStopBtn.style.opacity = (c || this._conn.retryStopped) ? "0.4" : "1";
    }

    // ── private: position persistence ──

    _loadPos() {
      try {
        const raw = localStorage.getItem(this._storageKey);
        if (raw) this._pos = JSON.parse(raw);
      } catch {}
    }

    _savePos() {
      try { localStorage.setItem(this._storageKey, JSON.stringify(this._pos)); } catch {}
    }

    _applyPos(el) {
      el.style.right = this._pos.right + "px";
      el.style.bottom = this._pos.bottom + "px";
      el.style.left = "auto";
      el.style.top = "auto";
    }

    _clamp(right, bottom, w, h) {
      const vw = window.innerWidth, vh = window.innerHeight;
      return {
        right: Math.max(0, Math.min(right, vw - w)),
        bottom: Math.max(0, Math.min(bottom, vh - h)),
      };
    }

    // ── private: drag ──

    _makeDraggable(el, { onClickOnly, getSize }) {
      let dragging = false, moved = false;
      let startX, startY, startRight, startBottom;

      el.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        dragging = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        startRight = this._pos.right;
        startBottom = this._pos.bottom;
        e.preventDefault();
      });

      document.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!moved && Math.abs(dx) < StatusPanel.DRAG_THRESHOLD &&
            Math.abs(dy) < StatusPanel.DRAG_THRESHOLD) return;
        moved = true;
        const size = getSize();
        const c = this._clamp(startRight - dx, startBottom - dy, size.width, size.height);
        this._pos.right = c.right;
        this._pos.bottom = c.bottom;
        this._applyPos(el);
        // Sync other element
        if (el === this._badge) this._applyPos(this._panel);
        else this._applyPos(this._badge);
      });

      document.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        if (moved) this._savePos();
        else if (onClickOnly) onClickOnly();
      });
    }

    // ── private: toggle ──

    _toggle(expand) {
      this._expanded = expand;
      this._badge.style.display = expand ? "none" : "flex";
      this._panel.style.display = expand ? "block" : "none";
      this.updateUI();
    }

    // ── private: DOM creation ──

    _createBadge() {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "fixed", width: "32px", height: "32px",
        borderRadius: "50%", background: "#c00", cursor: "grab",
        zIndex: "2147483647", display: "flex",
        alignItems: "center", justifyContent: "center",
        fontFamily: "system-ui, sans-serif", fontSize: "14px",
        fontWeight: "bold", color: "#fff",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        transition: "background 0.3s", userSelect: "none",
      });
      el.textContent = "D";
      el.title = "dkitle";
      this._applyPos(el);

      this._makeDraggable(el, {
        onClickOnly: () => this._toggle(true),
        getSize: () => ({ width: 32, height: 32 }),
      });

      this._badge = el;
    }

    _createPanel() {
      const panel = document.createElement("div");
      Object.assign(panel.style, {
        position: "fixed", width: "240px",
        background: "#1a1a2e", color: "#e0e0e0",
        borderRadius: "8px", fontFamily: "system-ui, sans-serif",
        fontSize: "13px", lineHeight: "1.5",
        zIndex: "2147483647", boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        display: "none", overflow: "hidden", userSelect: "none",
      });
      this._applyPos(panel);

      // Header
      const header = document.createElement("div");
      Object.assign(header.style, {
        display: "flex", justifyContent: "space-between",
        alignItems: "center", padding: "8px 12px",
        background: "#16213e", fontWeight: "bold",
        fontSize: "13px", cursor: "grab",
      });
      header.textContent = T.panelTitle;

      const collapseBtn = document.createElement("span");
      collapseBtn.textContent = "▾";
      Object.assign(collapseBtn.style, { cursor: "pointer", fontSize: "16px", lineHeight: "1" });
      collapseBtn.addEventListener("click", (e) => { e.stopPropagation(); this._toggle(false); });
      header.appendChild(collapseBtn);
      panel.appendChild(header);

      this._makeDraggable(panel, {
        onClickOnly: null,
        getSize: () => ({ width: 240, height: panel.offsetHeight || 180 }),
      });

      // Body
      const body = document.createElement("div");
      Object.assign(body.style, { padding: "8px 12px" });

      this._elBackend = this._makeRow(body, T.backend);
      this._elSubtitles = this._makeRow(body, T.subtitles);
      this._elVideo = this._makeRow(body, T.video);

      // Buttons
      const btnRow = document.createElement("div");
      Object.assign(btnRow.style, {
        display: "flex", gap: "6px", marginTop: "8px",
        paddingTop: "8px", borderTop: "1px solid #2a2a4a",
      });

      this._elRetryBtn = this._makeBtn(T.retryNow, () => this._conn.retryNow());
      this._elStopBtn = this._makeBtn(T.stopRetry, () => this._conn.stopRetry());
      btnRow.appendChild(this._elRetryBtn);
      btnRow.appendChild(this._elStopBtn);
      body.appendChild(btnRow);

      panel.appendChild(body);
      this._panel = panel;
    }

    _makeRow(parent, label) {
      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex", justifyContent: "space-between",
        alignItems: "center", padding: "3px 0",
      });
      const lbl = document.createElement("span");
      lbl.textContent = label;
      Object.assign(lbl.style, { fontWeight: "500" });
      const val = document.createElement("span");
      Object.assign(val.style, { fontSize: "12px" });
      row.appendChild(lbl);
      row.appendChild(val);
      parent.appendChild(row);
      return val;
    }

    _makeBtn(text, onClick) {
      const btn = document.createElement("button");
      btn.textContent = text;
      Object.assign(btn.style, {
        flex: "1", padding: "4px 0",
        border: "1px solid #444", borderRadius: "4px",
        background: "#2a2a4a", color: "#e0e0e0",
        cursor: "pointer", fontSize: "12px", fontFamily: "inherit",
      });
      btn.addEventListener("mouseenter", () => (btn.style.background = "#3a3a5a"));
      btn.addEventListener("mouseleave", () => (btn.style.background = "#2a2a4a"));
      btn.addEventListener("click", onClick);
      return btn;
    }
  }

  // ╔═══════════════════════════════════════════════════════════════════╗
  // ║  INIT                                                            ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  // Wire up: panel.updateUI is the shared state-change callback
  let panel = null;
  const notifyUI = () => panel?.updateUI();

  const conn = new ConnectionManager(CONFIG, notifyUI);
  const sync = new SubtitleSync(SITE, SOURCE_ID, conn, notifyUI);
  panel = new StatusPanel(SITE.name, conn, sync);

  console.log(`[dkitle] Userscript loaded for ${SITE.name}`);
  sync.hookFetch();
  sync.hookXHR();
  conn.connect();
  sync.startVideoSync();

  // Panel after DOM ready
  if (document.body) {
    panel.create();
  } else {
    document.addEventListener("DOMContentLoaded", () => panel.create());
  }

  // Cleanup
  window.addEventListener("beforeunload", () => {
    panel.destroy();
    conn.close();
  });
})();
