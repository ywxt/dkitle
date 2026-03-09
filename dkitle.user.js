// ==UserScript==
// @name         dkitle - Subtitle Sync
// @name:zh-CN   dkitle - 字幕同步
// @name:zh-TW   dkitle - 字幕同步
// @name:ja      dkitle - 字幕同期
// @name:ko      dkitle - 자막 동기화
// @name:fr      dkitle - Synchronisation des sous-titres
// @name:de      dkitle - Untertitel-Synchronisation
// @name:es      dkitle - Sincronización de subtítulos
// @name:ru      dkitle - Синхронизация субтитров
// @namespace    https://github.com/ywxt/dkitle
// @version      1.3.0
// @description  Sync video subtitles from YouTube/Bilibili to the dkitle desktop overlay app
// @description:zh-CN 将 YouTube/Bilibili 视频字幕同步到 dkitle 桌面置顶窗口
// @description:zh-TW 將 YouTube/Bilibili 視頻字幕同步到 dkitle 桌面置頂視窗
// @description:ja    YouTube/Bilibili の動画字幕を dkitle デスクトップオーバーレイに同期
// @description:ko    YouTube/Bilibili 비디오 자막을 dkitle 데스크톱 오버레이에 동기화
// @description:fr    Synchroniser les sous-titres YouTube/Bilibili vers la fenêtre dkitle
// @description:de    YouTube/Bilibili-Untertitel mit dem dkitle-Desktop-Overlay synchronisieren
// @description:es    Sincronizar subtítulos de YouTube/Bilibili con la ventana dkitle
// @description:ru    Синхронизация субтитров YouTube/Bilibili с оверлеем dkitle
// @author       ywxt
// @match        *://*.youtube.com/*
// @match        *://*.bilibili.com/*
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// @grant        GM_addElement
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
  // ║  THEME                                                           ║
  // ╚═══════════════════════════════════════════════════════════════════╝

  const THEMES = {
    dark: {
      panelBg: "#1a1a2e",
      headerBg: "#16213e",
      textColor: "#e0e0e0",
      labelColor: "#e0e0e0",
      valueColor: "#e0e0e0",
      btnBg: "#2a2a4a",
      btnHoverBg: "#3a3a5a",
      btnBorder: "#444",
      btnText: "#e0e0e0",
      divider: "#2a2a4a",
      shadow: "0 4px 16px rgba(0,0,0,0.4)",
      collapseBtnColor: "#e0e0e0",
    },
    light: {
      panelBg: "#ffffff",
      headerBg: "#f0f0f5",
      textColor: "#333333",
      labelColor: "#333333",
      valueColor: "#555555",
      btnBg: "#e8e8f0",
      btnHoverBg: "#d0d0e0",
      btnBorder: "#ccc",
      btnText: "#333333",
      divider: "#ddd",
      shadow: "0 4px 16px rgba(0,0,0,0.15)",
      collapseBtnColor: "#333333",
    },
  };

  function detectTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

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
      this._onCommand = null; // callback for server → browser commands

      this._ws = null;
      this._connected = false;
      this._reconnectAttempts = 0;
      this._reconnectTimer = null;
      this._reconnectTargetTime = 0;
      this._retryStopped = false;

      this._cache = { register: null, cues: null, sync: null };
    }

    set onCommand(fn) { this._onCommand = fn; }

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

      // Use GM_xmlhttpRequest to bypass CORS/Private Network Access restrictions
      const healthOk = await new Promise((resolve) => {
        try {
          GM_xmlhttpRequest({
            method: "GET",
            url: this._config.healthUrl,
            timeout: 5000,
            onload: (resp) => resolve(resp.status >= 200 && resp.status < 300),
            onerror: () => resolve(false),
            ontimeout: () => resolve(false),
          });
        } catch {
          resolve(false);
        }
      });

      if (!healthOk) {
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

        this._ws.onmessage = (event) => {
          try {
            const cmd = JSON.parse(event.data);
            if (this._onCommand) this._onCommand(cmd);
          } catch (e) {
            console.warn("[dkitle] Failed to parse server command:", e);
          }
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
    get videoEl() { return this._videoEl; }

    hookFetch() {
      // Inject fetch/XHR hooks via GM_addElement to run in page's native context,
      // bypassing Tampermonkey sandbox and Trusted Types CSP restrictions
      this._injectNetworkHooks();
    }

    _injectNetworkHooks() {
      const self = this;

      // Listen for intercepted data from the injected page-context script
      window.addEventListener("dkitle-intercepted-response", (e) => {
        try {
          const { _, data } = e.detail;
          const cues = self._site.parseResponse(data);
          if (cues?.length > 0) self._onCues(cues);
        } catch { }
      });

      // Serialize the site's interceptUrlTest function for injection into page context
      const interceptTestStr = this._site.interceptUrlTest.toString();

      // Inject a <script> that runs in the page's own JS context
      const scriptContent = `(function() {
        var interceptTest = ${interceptTestStr};

        function dispatchCues(url, data) {
          try {
            window.dispatchEvent(new CustomEvent("dkitle-intercepted-response", {
              detail: { url: url, data: data }
            }));
          } catch(e) {}
        }

        // Hook fetch
        var origFetch = window.fetch;
        window.fetch = function() {
          var args = arguments;
          return origFetch.apply(this, args).then(function(response) {
            var url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url ? args[0].url : "");
            if (interceptTest(url)) {
              response.clone().json().then(function(data) {
                dispatchCues(url, data);
              }).catch(function() {});
            }
            return response;
          });
        };

        // Hook XHR
        var origOpen = XMLHttpRequest.prototype.open;
        var origSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method, url) {
          this._dkitleUrl = typeof url === "string" ? url : String(url);
          return origOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function() {
          var self = this;
          if (self._dkitleUrl && interceptTest(self._dkitleUrl)) {
            self.addEventListener("load", function() {
              try {
                dispatchCues(self._dkitleUrl, JSON.parse(self.responseText));
              } catch(e) {}
            });
          }
          return origSend.apply(this, arguments);
        };
      })();`;

      // Use GM_addElement to bypass Trusted Types CSP restrictions on YouTube
      GM_addElement("script", { textContent: scriptContent });
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
      this._themeName = detectTheme();

      // DOM refs updated by updateUI
      this._elBackend = null;
      this._elSubtitles = null;
      this._elVideo = null;
      this._elRetryBtn = null;
      this._elStopBtn = null;
      // DOM refs for themed elements
      this._elHeader = null;
      this._elCollapseBtn = null;
      this._elBody = null;
      this._elBtnRow = null;
      this._labels = [];
      this._buttons = [];
    }

    create() {
      this._loadPos();
      this._createBadge();
      this._createPanel();
      this._applyTheme();

      document.body.appendChild(this._badge);
      document.body.appendChild(this._panel);

      // Listen for system theme changes
      this._mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      this._themeChangeHandler = () => {
        this._themeName = detectTheme();
        this._applyTheme();
      };
      this._mediaQuery.addEventListener("change", this._themeChangeHandler);

      this._tickTimer = setInterval(() => this.updateUI(), 1000);
      this.updateUI();
    }

    destroy() {
      if (this._tickTimer) clearInterval(this._tickTimer);
      if (this._mediaQuery && this._themeChangeHandler) {
        this._mediaQuery.removeEventListener("change", this._themeChangeHandler);
      }
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
      } catch { }
    }

    _savePos() {
      try { localStorage.setItem(this._storageKey, JSON.stringify(this._pos)); } catch { }
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
        borderRadius: "8px", fontFamily: "system-ui, sans-serif",
        fontSize: "13px", lineHeight: "1.5",
        zIndex: "2147483647",
        display: "none", overflow: "hidden", userSelect: "none",
        transition: "background 0.2s, color 0.2s, box-shadow 0.2s",
      });
      this._applyPos(panel);

      // Header
      const header = document.createElement("div");
      Object.assign(header.style, {
        display: "flex", justifyContent: "space-between",
        alignItems: "center", padding: "8px 12px",
        fontWeight: "bold", fontSize: "13px", cursor: "grab",
        transition: "background 0.2s",
      });
      header.textContent = T.panelTitle;
      this._elHeader = header;

      const collapseBtn = document.createElement("span");
      collapseBtn.textContent = "▾";
      Object.assign(collapseBtn.style, { cursor: "pointer", fontSize: "16px", lineHeight: "1" });
      collapseBtn.addEventListener("click", (e) => { e.stopPropagation(); this._toggle(false); });
      this._elCollapseBtn = collapseBtn;
      header.appendChild(collapseBtn);
      panel.appendChild(header);

      this._makeDraggable(panel, {
        onClickOnly: null,
        getSize: () => ({ width: 240, height: panel.offsetHeight || 180 }),
      });

      // Body
      const body = document.createElement("div");
      Object.assign(body.style, { padding: "8px 12px" });
      this._elBody = body;

      this._elBackend = this._makeRow(body, T.backend);
      this._elSubtitles = this._makeRow(body, T.subtitles);
      this._elVideo = this._makeRow(body, T.video);

      // Buttons
      const btnRow = document.createElement("div");
      Object.assign(btnRow.style, {
        display: "flex", gap: "6px", marginTop: "8px",
        paddingTop: "8px",
      });
      this._elBtnRow = btnRow;

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
      this._labels.push(lbl);
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
        borderRadius: "4px",
        cursor: "pointer", fontSize: "12px", fontFamily: "inherit",
        transition: "background 0.2s, color 0.2s",
      });
      btn.addEventListener("mouseenter", () => {
        const t = THEMES[this._themeName];
        btn.style.background = t.btnHoverBg;
      });
      btn.addEventListener("mouseleave", () => {
        const t = THEMES[this._themeName];
        btn.style.background = t.btnBg;
      });
      btn.addEventListener("click", onClick);
      this._buttons.push(btn);
      return btn;
    }

    // ── private: theme ──

    _applyTheme() {
      const t = THEMES[this._themeName];
      if (!this._panel) return;

      // Panel
      this._panel.style.background = t.panelBg;
      this._panel.style.color = t.textColor;
      this._panel.style.boxShadow = t.shadow;

      // Header
      this._elHeader.style.background = t.headerBg;
      this._elHeader.style.color = t.textColor;
      this._elCollapseBtn.style.color = t.collapseBtnColor;

      // Labels
      for (const lbl of this._labels) {
        lbl.style.color = t.labelColor;
      }

      // Value spans
      if (this._elBackend) this._elBackend.style.color = t.valueColor;
      if (this._elSubtitles) this._elSubtitles.style.color = t.valueColor;
      if (this._elVideo) this._elVideo.style.color = t.valueColor;

      // Button row divider
      if (this._elBtnRow) {
        this._elBtnRow.style.borderTop = `1px solid ${t.divider}`;
      }

      // Buttons
      for (const btn of this._buttons) {
        btn.style.background = t.btnBg;
        btn.style.color = t.btnText;
        btn.style.border = `1px solid ${t.btnBorder}`;
      }
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

  // Handle commands from the dkitle-app (server → browser)
  conn.onCommand = (cmd) => {
    if (cmd.type === "play_pause" && cmd.source_id === SOURCE_ID) {
      const video = sync.videoEl;
      if (video) {
        if (video.paused) {
          video.play().catch(() => { });
        } else {
          video.pause();
        }
        console.log(`[dkitle] Remote play/pause toggled → ${video.paused ? "paused" : "playing"}`);
      }
    }
  };

  console.log(`[dkitle] Userscript loaded for ${SITE.name}`);
  sync.hookFetch();
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
