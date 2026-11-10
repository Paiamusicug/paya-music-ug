/* Paya Music UG revenue enquiry and owner tracking */
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value = "") => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const token = () => localStorage.getItem("paya_token") || "";
  const user = () => { try { return JSON.parse(localStorage.getItem("paya_user") || "null"); } catch { return null; } };
  const api = async (url, options = {}) => {
    const headers = { ...(options.headers || {}), ...(token() ? { Authorization: "Bearer " + token() } : {}) };
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  };
  const labels = {
    advertising: "Website advertising",
    featured_artist: "Featured artist promotion",
    music_promotion: "Paid music promotion",
    sponsored_news: "Sponsored news article"
  };
  const form = $("#revenueRequestForm");
  if (form) form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const msg = $("#revenueRequestMsg");
    const original = button?.textContent || "Send promotion request";
    if (button) { button.disabled = true; button.textContent = "Sending…"; }
    if (msg) msg.textContent = "";
    try {
      const body = Object.fromEntries(new FormData(form).entries());
      const result = await api("/api/revenue-requests", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      form.reset();
      if (msg) msg.textContent = result.message || "Request sent. Paya will contact you.";
    } catch (error) {
      if (msg) msg.textContent = error.message;
    } finally {
      if (button) { button.disabled = false; button.textContent = original; }
    }
  });

  const list = $("#ownerRevenueRequestList");
  async function loadOwnerRequests() {
    if (!list || user()?.role !== "owner" || !token()) return;
    list.innerHTML = '<p class="muted">Loading revenue enquiries…</p>';
    try {
      const result = await api("/api/owner/revenue-requests");
      const requests = result.requests || [];
      if (!requests.length) { list.innerHTML = '<p class="muted">No revenue enquiries yet. New requests will appear here.</p>'; return; }
      list.innerHTML = requests.map(item => `
        <article class="revenue-admin-item" data-revenue-id="${esc(item.id)}">
          <strong>${esc(labels[item.service_type] || item.service_type)}</strong>
          <p><b>${esc(item.customer_name)}</b> · ${esc(item.contact_email)} ${item.contact_whatsapp ? "· " + esc(item.contact_whatsapp) : ""}</p>
          <p>${esc(item.details || "No extra details supplied.")}</p>
          <small>${esc(item.created_at ? new Date(item.created_at).toLocaleString() : "")}</small>
          <label>Status
            <select data-field="status">
              ${["new","contacted","paid","completed","rejected"].map(status => `<option value="${status}" ${item.status === status ? "selected" : ""}>${status.replace("_"," ")}</option>`).join("")}
            </select>
          </label>
          <label>Agreed amount (UGX)
            <input data-field="amount_agreed" type="number" min="0" step="1" value="${item.amount_agreed ?? ""}" placeholder="Enter agreed amount">
          </label>
          <label>Payment reference / note
            <input data-field="payment_reference" maxlength="120" value="${esc(item.payment_reference || "")}" placeholder="Transaction reference after verifying payment">
          </label>
          <label>Owner notes
            <textarea data-field="owner_note" rows="2" maxlength="1000" placeholder="Follow-up, package or delivery notes">${esc(item.owner_note || "")}</textarea>
          </label>
          <button type="button" data-save-revenue>Save update</button>
        </article>`).join("");
      list.querySelectorAll("[data-save-revenue]").forEach(button => button.addEventListener("click", async () => {
        const card = button.closest("[data-revenue-id]");
        const get = name => card.querySelector(`[data-field="${name}"]`)?.value ?? "";
        const amount = get("amount_agreed");
        const payload = {
          status: get("status"),
          owner_note: get("owner_note"),
          payment_reference: get("payment_reference")
        };
        if (amount !== "") payload.amount_agreed = Number(amount);
        button.disabled = true;
        const old = button.textContent;
        button.textContent = "Saving…";
        try {
          await api("/api/owner/revenue-requests/" + encodeURIComponent(card.dataset.revenueId), {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
          });
          const msg = $("#ownerRevenueMsg");
          if (msg) msg.textContent = "Revenue request updated.";
        } catch (error) {
          const msg = $("#ownerRevenueMsg");
          if (msg) msg.textContent = error.message;
        } finally {
          button.disabled = false;
          button.textContent = old;
        }
      }));
    } catch (error) {
      list.innerHTML = '<p class="error">' + esc(error.message) + '</p>';
    }
  }
  window.addEventListener("focus", loadOwnerRequests);
  window.addEventListener("storage", loadOwnerRequests);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadOwnerRequests(); });
  document.addEventListener("DOMContentLoaded", () => {
    loadOwnerRequests();
    let attempts = 0;
    const waitForOwnerSession = () => {
      if (user()?.role === "owner" && token()) { loadOwnerRequests(); return; }
      if (++attempts < 20) setTimeout(waitForOwnerSession, 500);
    };
    waitForOwnerSession();
  });
})();
