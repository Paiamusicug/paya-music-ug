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


  // Public payment options and owner payment settings.
  const publicPaymentList = $("#publicPaymentMethodList");
  async function loadPublicPaymentMethods() {
    if (!publicPaymentList) return;
    try {
      const result = await api("/api/payment-methods");
      const methods = result.methods || [];
      if (!methods.length) {
        publicPaymentList.innerHTML = '<p class="muted">Paya Music UG has not published payment details yet.</p>';
        return;
      }
      publicPaymentList.innerHTML = methods.map(method => `
        <article class="public-payment-card">
          <strong>${esc(method.display_name)}</strong>
          ${method.country ? '<small>' + esc(method.country) + '</small>' : ''}
          ${method.account_name ? '<p>Account name: <b>' + esc(method.account_name) + '</b></p>' : ''}
          ${method.account_number ? '<p>Number / account: <b>' + esc(method.account_number) + '</b></p>' : ''}
          ${method.instructions ? '<p>${esc(method.instructions)}</p>' : ''}
        </article>`).join("");
    } catch (error) {
      publicPaymentList.innerHTML = '<p class="muted">Payment options are temporarily unavailable.</p>';
    }
  }

  const paymentForm = $("#ownerPaymentMethodForm");
  const paymentList = $("#ownerPaymentMethodList");
  const paymentMsg = $("#ownerPaymentMsg");
  function resetPaymentForm() { paymentForm?.reset(); if (paymentForm) paymentForm.elements.sort_order.value = "0"; }
  function renderOwnerPaymentMethods(methods) {
    if (!paymentList) return;
    if (!methods.length) { paymentList.innerHTML = '<p class="muted">No payment methods added yet.</p>'; return; }
    paymentList.innerHTML = methods.map(method => `
      <article class="revenue-admin-item payment-admin-item" data-payment-id="${esc(method.id)}">
        <strong>${esc(method.display_name)}</strong>
        <p>${esc(method.country || "")} · ${esc(method.account_number || "No number entered")}</p>
        <p>Enabled: <b>${method.is_enabled ? "Yes" : "No"}</b> · Public: <b>${method.is_published ? "Yes" : "No"}</b></p>
        <button type="button" data-edit-payment>Edit details</button>
        <button type="button" data-toggle-payment>${method.is_published ? "Unpublish" : "Publish"}</button>
      </article>`).join("");
    paymentList.querySelectorAll("[data-edit-payment]").forEach(button => button.addEventListener("click", () => {
      const method = methods.find(item => String(item.id) === button.closest("[data-payment-id]").dataset.paymentId);
      if (!method || !paymentForm) return;
      for (const field of ["method_code","display_name","country","account_name","account_number","instructions","sort_order"]) {
        if (paymentForm.elements[field]) paymentForm.elements[field].value = method[field] ?? "";
      }
      paymentForm.elements.is_enabled.checked = !!method.is_enabled;
      paymentForm.elements.is_published.checked = !!method.is_published;
      paymentForm.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    paymentList.querySelectorAll("[data-toggle-payment]").forEach(button => button.addEventListener("click", async () => {
      const method = methods.find(item => String(item.id) === button.closest("[data-payment-id]").dataset.paymentId);
      if (!method) return;
      button.disabled = true;
      try {
        await api("/api/owner/payment-methods/" + encodeURIComponent(method.id), {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_enabled: true, is_published: !method.is_published })
        });
        await loadOwnerPaymentMethods();
        await loadPublicPaymentMethods();
        if (paymentMsg) paymentMsg.textContent = method.is_published ? "Payment method unpublished." : "Payment method published.";
      } catch (error) { if (paymentMsg) paymentMsg.textContent = error.message; }
      finally { button.disabled = false; }
    }));
  }
  async function loadOwnerPaymentMethods() {
    if (!paymentList || user()?.role !== "owner" || !token()) return;
    paymentList.innerHTML = '<p class="muted">Loading payment methods…</p>';
    try {
      const result = await api("/api/owner/payment-methods");
      renderOwnerPaymentMethods(result.methods || []);
    } catch (error) { paymentList.innerHTML = '<p class="error">' + esc(error.message) + '</p>'; }
  }
  if (paymentForm) paymentForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = paymentForm.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.textContent = "Saving…"; }
    if (paymentMsg) paymentMsg.textContent = "";
    try {
      const formData = new FormData(paymentForm);
      const payload = Object.fromEntries(formData.entries());
      payload.is_enabled = paymentForm.elements.is_enabled.checked;
      payload.is_published = paymentForm.elements.is_published.checked;
      payload.sort_order = Number(payload.sort_order || 0);
      const result = await api("/api/owner/payment-methods", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      if (paymentMsg) paymentMsg.textContent = result.message || "Payment method saved.";
      resetPaymentForm();
      await loadOwnerPaymentMethods();
      await loadPublicPaymentMethods();
    } catch (error) { if (paymentMsg) paymentMsg.textContent = error.message; }
    finally { if (button) { button.disabled = false; button.textContent = "Save payment method"; } }
  });
  $("#ownerPaymentReset")?.addEventListener("click", resetPaymentForm);

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
  window.addEventListener("focus", () => { loadOwnerRequests(); loadOwnerPaymentMethods(); loadPublicPaymentMethods(); });
  window.addEventListener("storage", () => { loadOwnerRequests(); loadOwnerPaymentMethods(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadOwnerRequests(); });
  document.addEventListener("DOMContentLoaded", () => {
    loadOwnerRequests();
    loadOwnerPaymentMethods();
    loadPublicPaymentMethods();
    let attempts = 0;
    const waitForOwnerSession = () => {
      if (user()?.role === "owner" && token()) { loadOwnerRequests(); loadOwnerPaymentMethods(); return; }
      if (++attempts < 20) setTimeout(waitForOwnerSession, 500);
    };
    waitForOwnerSession();
  });
})();
