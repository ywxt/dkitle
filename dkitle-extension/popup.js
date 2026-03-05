// dkitle popup script

const dot = document.getElementById("dot");
const label = document.getElementById("label");
const hint = document.getElementById("hint");
const info = document.getElementById("info");

let countdownTimer = null;

function updateStatus(status) {
  clearCountdown();

  if (status.connected) {
    dot.className = "dot connected";
    label.textContent = "已连接到 dkitle-app";
    hint.textContent = "";
    info.classList.remove("visible");
  } else if (status.reconnectAttempts > 0) {
    dot.className = "dot reconnecting";
    label.textContent = "未连接";
    info.classList.add("visible");

    // Show countdown to next reconnect
    if (status.nextReconnectMs > 0) {
      startCountdown(status.nextReconnectMs, status.reconnectAttempts);
    } else {
      hint.textContent = `正在重连... (第 ${status.reconnectAttempts} 次)`;
    }
  } else {
    dot.className = "dot disconnected";
    label.textContent = "正在连接...";
    hint.textContent = "";
    info.classList.remove("visible");
  }
}

function startCountdown(targetMs, attempts) {
  function tick() {
    const remaining = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
    if (remaining > 0) {
      hint.textContent = `${remaining}s 后重连 (第 ${attempts} 次尝试)`;
    } else {
      hint.textContent = `正在重连... (第 ${attempts} 次)`;
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

// Get current status from background
chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
  if (response) {
    updateStatus(response);
  }
});

// Listen for status updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "status") {
    updateStatus(message);
  }
});
