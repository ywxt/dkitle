// dkitle YouTube subtitle provider (ISOLATED world)
// Built on shared provider base

(function () {
  "use strict";

  function register() {
    if (typeof window.__dkitleCreateProvider === "function") {
      window.__dkitleCreateProvider({
        provider: "youtube",
        urlMatch: /youtube\.com\/watch/,
      });
    } else {
      console.warn("[dkitle] provider-base not loaded, retrying...");
      setTimeout(register, 50);
    }
  }

  register();
})();
