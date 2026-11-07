/* Isolated account navigation.
   Kept separate from app.js so account tabs still work if another
   part of the main application script encounters an error. */
(() => {
  "use strict";
  const byId = (id) => document.getElementById(id);

  function showAccountMode(mode) {
    const registerForm = byId("registerForm");
    const loginForm = byId("loginForm");
    const tabs = document.querySelectorAll(".tabs .tab[data-tab]");
    const account = byId("account");

    if (registerForm) {
      registerForm.hidden = mode !== "register";
      registerForm.classList.toggle("hidden", mode !== "register");
    }
    if (loginForm) {
      loginForm.hidden = mode !== "login";
      loginForm.classList.toggle("hidden", mode !== "login");
    }
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === mode;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (account) {
      account.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (mode === "login") {
      const email = loginForm && loginForm.querySelector('input[name="email"]');
      if (email) email.focus({ preventScroll: true });
    }
  }

  document.addEventListener("click", (event) => {
    const tab = event.target.closest && event.target.closest(".tabs .tab[data-tab]");
    if (!tab) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showAccountMode(tab.dataset.tab === "login" ? "login" : "register");
  }, true);

  document.addEventListener("click", (event) => {
    const button = event.target.closest && event.target.closest("#loginOpen");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showAccountMode("login");
  }, true);
})();