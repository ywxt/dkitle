// dkitle background service worker
// Manages WebSocket connection to dkitle-app with health probe + exponential backoff

const HEALTH_URL = "http://127.0.0.1:9877/health";
const WS_URL = "ws://127.0.0.1:9877/ws";
let ws = null;
let reconnectTimer = null;
let connected = false;
let reconnectAttempts = 0;
let nextReconnectMs = 0;
let stopped = false; // user manually stopped auto-reconnect

// Cache for resending data after reconnection
const cachedRegister = new Map();  // sourceId → register payload object
const cachedCues = new Map();  // sourceId → cues payload object
const cachedSync = new Map();  // sourceId → sync payload object

// Track which tab owns which sourceId (for cleanup on refresh/close)
const tabSourceMap = new Map();  // tabId → sourceId

// When a tab sends a new sourceId, clean up old data for that tab
function updateTabSource(tabId, newSourceId) {
  const oldSourceId = tabSourceMap.get(tabId);
  if (oldSourceId && oldSourceId !== newSourceId) {
    cachedRegister.delete(oldSourceId);
    cachedCues.delete(oldSourceId);
    cachedSync.delete(oldSourceId);
    wsSend({ type: "deactivate", source_id: oldSourceId });
    console.log(`[dkitle] Tab ${tabId} refreshed: deactivated old source ${oldSourceId}`);
  }
  tabSourceMap.set(tabId, newSourceId);
}

// Clean up source data when a tab is closed
function cleanupTab(tabId) {
  const sourceId = tabSourceMap.get(tabId);
  if (sourceId) {
    cachedRegister.delete(sourceId);
    cachedCues.delete(sourceId);
    cachedSync.delete(sourceId);
    wsSend({ type: "deactivate", source_id: sourceId });
    tabSourceMap.delete(tabId);
    console.log(`[dkitle] Tab ${tabId} closed: deactivated source ${sourceId}`);
  }
}

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 30000;

function getReconnectDelay() {
  return Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
}

async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  // First, probe the health endpoint via fetch (silent failure, no console error)
  try {
    const resp = await fetch(HEALTH_URL, { method: "GET" });
    if (!resp.ok) {
      throw new Error("Health check failed");
    }
  } catch (_) {
    // Server not available — schedule reconnect silently
    if (!stopped) {
      scheduleReconnect();
    }
    return;
  }

  // Server is up — now safe to open WebSocket (won't get ERR_CONNECTION_REFUSED)
  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("[dkitle] Connected to dkitle-app");
      connected = true;
      reconnectAttempts = 0;
      nextReconnectMs = 0;
      stopped = false;
      clearReconnectTimer();
      notifyStatusChange();
      resendCachedData();
    };

    ws.onclose = () => {
      if (connected) {
        console.warn("[dkitle] Disconnected from dkitle-app");
      }
      connected = false;
      ws = null;
      notifyStatusChange();
      if (!stopped) {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // Silently handle - onclose will fire after this
      ws?.close();
    };

    ws.onmessage = (event) => {
      console.log("[dkitle] Server message:", event.data);
    };
  } catch (e) {
    console.warn("[dkitle] Cannot connect to dkitle-app");
    connected = false;
    if (!stopped) {
      scheduleReconnect();
    }
  }
}

function scheduleReconnect() {
  clearReconnectTimer();
  const delay = getReconnectDelay();
  nextReconnectMs = Date.now() + delay;
  reconnectAttempts++;
  notifyStatusChange();

  reconnectTimer = setTimeout(() => {
    nextReconnectMs = 0;
    connect();
  }, delay);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// Manual retry: reset state and connect immediately
function retryNow() {
  stopped = false;
  reconnectAttempts = 0;
  nextReconnectMs = 0;
  clearReconnectTimer();
  notifyStatusChange();
  connect();
}

// Stop auto-reconnect
function stopRetry() {
  stopped = true;
  clearReconnectTimer();
  nextReconnectMs = 0;
  notifyStatusChange();
}

function wsSend(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
  // Silently skip if not connected
}

// Resend all cached data after reconnection
function resendCachedData() {
  let count = 0;
  for (const data of cachedRegister.values()) {
    wsSend(data);
    count++;
  }
  for (const data of cachedCues.values()) {
    wsSend(data);
    count++;
  }
  for (const data of cachedSync.values()) {
    // Update timestamp to now so the server gets a fresh reference point
    wsSend({ ...data, timestamp: Date.now() });
  }
  if (count > 0) {
    console.log(`[dkitle] Resent cached data for ${count} source(s) after reconnection`);
  }
}

function notifyStatusChange() {
  const status = { ...getStatusInfo(), ...getSubtitleStatus() };
  chrome.runtime.sendMessage({ type: "status", ...status }).catch(() => {
    // popup not open, ignore
  });
}

function getStatusInfo() {
  return {
    connected,
    reconnectAttempts,
    nextReconnectMs,
    stopped,
  };
}

// Build subtitle capture status for the popup
function getSubtitleStatus() {
  const sources = [];
  // Start from registered sources
  for (const [sourceId, payload] of cachedRegister.entries()) {
    const cuesPayload = cachedCues.get(sourceId);
    sources.push({
      sourceId,
      provider: payload.provider || "unknown",
      tabTitle: payload.tab_title || "",
      cueCount: cuesPayload ? (cuesPayload.cues || []).length : 0,
    });
  }
  return { sources };
}

// Listen for messages from content scripts (providers) and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "register") {
    // Track tab → sourceId mapping; clean up stale sources on refresh
    if (sender.tab?.id != null) {
      updateTabSource(sender.tab.id, message.sourceId);
    }
    // Register this source in the app (no cues yet)
    const registerPayload = {
      type: "register",
      provider: message.provider,
      source_id: message.sourceId,
      tab_title: sender.tab?.title || "",
    };
    cachedRegister.set(message.sourceId, registerPayload);
    wsSend(registerPayload);
    // Notify popup about new source
    notifyStatusChange();
    sendResponse({ ok: true });
  } else if (message.type === "cues") {
    // Track tab → sourceId mapping; clean up stale sources on refresh
    if (sender.tab?.id != null) {
      updateTabSource(sender.tab.id, message.sourceId);
    }
    // Filter out empty cues
    if (!message.cues || message.cues.length === 0) {
      sendResponse({ ok: true });
      return false;
    }
    // Forward subtitle cues to the app and cache for reconnection
    const cuesPayload = {
      type: "cues",
      provider: message.provider,
      source_id: message.sourceId,
      tab_title: sender.tab?.title || "",
      cues: message.cues,
    };
    cachedCues.set(message.sourceId, cuesPayload);
    wsSend(cuesPayload);
    // Notify popup about subtitle capture change
    notifyStatusChange();
    sendResponse({ ok: true });
  } else if (message.type === "sync") {
    // Track tab → sourceId mapping; clean up stale sources on refresh
    if (sender.tab?.id != null) {
      updateTabSource(sender.tab.id, message.sourceId);
    }
    // Forward time sync to the app and cache for reconnection
    const syncPayload = {
      type: "sync",
      source_id: message.sourceId,
      video_time_ms: message.videoTimeMs,
      playing: message.playing,
      playback_rate: message.playbackRate,
      timestamp: message.timestamp,
    };
    cachedSync.set(message.sourceId, syncPayload);
    wsSend(syncPayload);
    sendResponse({ ok: true });
  } else if (message.type === "getStatus") {
    sendResponse({ ...getStatusInfo(), ...getSubtitleStatus() });
  } else if (message.type === "retryNow") {
    retryNow();
    sendResponse({ ok: true });
  } else if (message.type === "stopRetry") {
    stopRetry();
    sendResponse({ ok: true });
  }
  return false;
});

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  cleanupTab(tabId);
});

// Start connection on load
connect();
