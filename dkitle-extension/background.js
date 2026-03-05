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

function sendSubtitle(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
  // Silently skip if not connected
}

function notifyStatusChange() {
  const status = getStatusInfo();
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

// Listen for messages from content scripts (providers) and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "subtitle") {
    sendSubtitle({
      provider: message.provider,
      source_id: message.sourceId,
      tab_title: sender.tab?.title || "",
      text: message.text,
      timestamp: Date.now(),
    });
    sendResponse({ ok: true });
  } else if (message.type === "getStatus") {
    sendResponse(getStatusInfo());
  } else if (message.type === "retryNow") {
    retryNow();
    sendResponse({ ok: true });
  } else if (message.type === "stopRetry") {
    stopRetry();
    sendResponse({ ok: true });
  }
  return false;
});

// Start connection on load
connect();
