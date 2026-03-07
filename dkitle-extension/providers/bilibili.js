// dkitle bilibili subtitle provider (ISOLATED world)
// Built on shared provider base

(function () {
  "use strict";

  function register() {
    if (typeof window.__dkitleCreateProvider === "function") {
      window.__dkitleCreateProvider({
        provider: "bilibili",
        urlMatch: /bilibili\.com\/(video|bangumi\/play)/,
      });
    } else {
      console.warn("[dkitle] provider-base not loaded, retrying...");
      setTimeout(register, 50);
    }
  }

  register();
})();
