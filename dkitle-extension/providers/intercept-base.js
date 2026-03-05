// dkitle network interceptor base (MAIN world)
// Hooks fetch & XMLHttpRequest once, dispatches to registered interceptors
// Usage: window.__dkitleRegisterInterceptor({ name, urlTest, parseResponse, messageType? })

(function () {
  "use strict";

  const interceptors = [];

  window.__dkitleRegisterInterceptor = function (config) {
    interceptors.push(config);
    console.log(`[dkitle] Registered interceptor: ${config.name || "unnamed"}`);
  };

  // --- Hook fetch ---

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";

    for (const interceptor of interceptors) {
      if (interceptor.urlTest(url)) {
        try {
          response
            .clone()
            .json()
            .then((data) => {
              const cues = interceptor.parseResponse(data);
              if (cues && cues.length > 0) {
                window.postMessage(
                  {
                    type: interceptor.messageType || "dkitle-subtitle-data",
                    provider: interceptor.name,
                    cues,
                  },
                  "*"
                );
              }
            })
            .catch(() => {});
        } catch (_) {}
        break; // first matching interceptor wins
      }
    }

    return response;
  };

  // --- Hook XMLHttpRequest ---

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._dkitleUrl = typeof url === "string" ? url : String(url);
    return originalXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const url = this._dkitleUrl;
    if (url) {
      for (const interceptor of interceptors) {
        if (interceptor.urlTest(url)) {
          this.addEventListener("load", function () {
            try {
              const data = JSON.parse(this.responseText);
              const cues = interceptor.parseResponse(data);
              if (cues && cues.length > 0) {
                window.postMessage(
                  {
                    type: interceptor.messageType || "dkitle-subtitle-data",
                    provider: interceptor.name,
                    cues,
                  },
                  "*"
                );
              }
            } catch (_) {}
          });
          break;
        }
      }
    }
    return originalXHRSend.apply(this, args);
  };

  console.log("[dkitle] Network interceptor base loaded");
})();
