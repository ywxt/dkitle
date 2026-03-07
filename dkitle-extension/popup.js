// dkitle popup script — i18n + retry/stop controls

const dot = document.getElementById("dot");
const label = document.getElementById("label");
const hint = document.getElementById("hint");
const info = document.getElementById("info");
const retryBtn = document.getElementById("retryBtn");
const stopBtn = document.getElementById("stopBtn");
const sourcesDiv = document.getElementById("sources");
const sourcesTitle = document.getElementById("sourcesTitle");
const sourcesList = document.getElementById("sourcesList");

let countdownTimer = null;

// ── i18n ──────────────────────────────────────────────
const LANG = navigator.language.startsWith("zh") ? "zh" : "en";

const I18N = {
  zh: {
    title: "dkitle",
    connected: "已连接到 dkitle-app",
    connecting: "正在连接...",
    disconnected: "未连接",
    reconnecting: "正在重连...",
    countdownHint: (sec, n) => `${sec}s 后重连 (第 ${n} 次尝试)`,
    reconnectHint: (n) => `正在重连... (第 ${n} 次)`,
    retryNow: "立即重试",
    stopRetry: "停止重试",
    stopped: "已停止自动重连",
    stoppedHint: "点击「立即重试」手动连接",
    infoText: "请先打开 dkitle-app 桌面应用",
    sourcesTitle: "字幕捕获",
    captured: (n) => `✅ 已捕获 ${n} 条字幕`,
    noSubtitles: "⚠️ 未捕获字幕",
  },
  en: {
    title: "dkitle",
    connected: "Connected to dkitle-app",
    connecting: "Connecting...",
    disconnected: "Disconnected",
    reconnecting: "Reconnecting...",
    countdownHint: (sec, n) => `Reconnecting in ${sec}s (attempt ${n})`,
    reconnectHint: (n) => `Reconnecting... (attempt ${n})`,
    retryNow: "Retry Now",
    stopRetry: "Stop Retry",
    stopped: "Auto-reconnect stopped",
    stoppedHint: 'Click "Retry Now" to connect manually',
    infoText: "Please open the dkitle-app desktop application first",
    sourcesTitle: "Subtitle Capture",
    captured: (n) => `✅ Captured ${n} cues`,
    noSubtitles: "⚠️ No subtitles",
  },
};

const t = I18N[LANG];

// Apply static i18n texts
document.documentElement.lang = LANG;
document.getElementById("titleText").textContent = t.title;
document.getElementById("infoText").textContent = t.infoText;
label.textContent = t.connecting;
retryBtn.textContent = t.retryNow;
stopBtn.textContent = t.stopRetry;

// ── Sources rendering ─────────────────────────────────
function updateSources(sources) {
  if (!sources || sources.length === 0) {
    sourcesDiv.classList.remove("visible");
    return;
  }

  sourcesDiv.classList.add("visible");
  sourcesTitle.textContent = t.sourcesTitle;
  sourcesList.innerHTML = "";

  for (const src of sources) {
    const item = document.createElement("div");
    item.className = "source-item";

    const icon = document.createElement("span");
    icon.className = "source-icon";
    icon.textContent = "📺";

    const infoDiv = document.createElement("div");
    infoDiv.className = "source-info";

    const labelSpan = document.createElement("span");
    labelSpan.className = "source-label";
    const providerName = src.provider.charAt(0).toUpperCase() + src.provider.slice(1);
    labelSpan.textContent = src.tabTitle
      ? `${providerName} — ${src.tabTitle}`
      : providerName;
    labelSpan.title = labelSpan.textContent;

    const statusSpan = document.createElement("span");
    if (src.cueCount > 0) {
      statusSpan.className = "source-status captured";
      statusSpan.textContent = t.captured(src.cueCount);
    } else {
      statusSpan.className = "source-status no-subs";
      statusSpan.textContent = t.noSubtitles;
    }

    infoDiv.appendChild(labelSpan);
    infoDiv.appendChild(statusSpan);
    item.appendChild(icon);
    item.appendChild(infoDiv);
    sourcesList.appendChild(item);
  }
}

// ── Status rendering ──────────────────────────────────
function updateStatus(status) {
  clearCountdown();

  // Update subtitle sources display
  updateSources(status.sources);

  if (status.connected) {
    dot.className = "dot connected";
    label.textContent = t.connected;
    hint.textContent = "";
    info.classList.remove("visible");
    retryBtn.style.display = "none";
    stopBtn.style.display = "none";
  } else if (status.stopped) {
    dot.className = "dot disconnected";
    label.textContent = t.stopped;
    hint.textContent = t.stoppedHint;
    info.classList.add("visible");
    retryBtn.style.display = "inline-block";
    stopBtn.style.display = "none";
  } else if (status.reconnectAttempts > 0) {
    dot.className = "dot reconnecting";
    label.textContent = t.disconnected;
    info.classList.add("visible");
    retryBtn.style.display = "inline-block";
    stopBtn.style.display = "inline-block";

    if (status.nextReconnectMs > 0) {
      startCountdown(status.nextReconnectMs, status.reconnectAttempts);
    } else {
      hint.textContent = t.reconnectHint(status.reconnectAttempts);
    }
  } else {
    dot.className = "dot disconnected";
    label.textContent = t.connecting;
    hint.textContent = "";
    info.classList.remove("visible");
    retryBtn.style.display = "none";
    stopBtn.style.display = "none";
  }
}

function startCountdown(targetMs, attempts) {
  function tick() {
    const remaining = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
    if (remaining > 0) {
      hint.textContent = t.countdownHint(remaining, attempts);
    } else {
      hint.textContent = t.reconnectHint(attempts);
      clearCountdown();
    }
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

// ── Retry / Stop buttons ─────────────────────────────
retryBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "retryNow" });
});

stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "stopRetry" });
});

// ── Communication with background ────────────────────
chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
  if (response) {
    updateStatus(response);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "status") {
    updateStatus(message);
  }
});
