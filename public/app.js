
const $ = (s) => document.querySelector(s);

let token = localStorage.getItem("paya_token") || "";
let currentUser = JSON.parse(localStorage.getItem("paya_user") || "null");

const audio = $("#audio");
$("#year").textContent = new Date().getFullYear();

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3200);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function saveUser(data) {
  token = data.token;
  currentUser = data.user;

  localStorage.setItem("paya_token", token);
  localStorage.setItem("paya_user", JSON.stringify(currentUser));

  showUser();
  toast(`Welcome, ${currentUser.name}!`);
}

async function loadAds() {
  try {
    const ads = await api("/api/ads?placement=homepage");
    const area = $("#homepageAdList");

    area.innerHTML = ads.length
      ? ads.map(ad => `
        <a class="ad-card"
           href="${escapeAttr(ad.target_url)}"
           target="_blank"
           rel="noopener sponsored">
          <img src="${escapeAttr(ad.image_url)}" alt="">
          <span>
            <small>SPONSORED · ${escapeHtml(ad.business_name)}</small>
            <b>${escapeHtml(ad.title)}</b>
            <small>${escapeHtml(ad.description || "Visit sponsor")}</small>
          </span>
        </a>
      `).join("")
      : '<p class="muted">Your business could be featured here. <a class="text-link" href="#advertise">Advertise with us →</a></p>';
  } catch (err) {
    console.error("Could not load adverts:", err);
  }
}

async function loadSongs() {
  const q = $("#search").value.trim();
  const songs = await api(`/api/songs?q=${encodeURIComponent(q)}`);
  const area = $("#songs");

  if (!songs.length) {
    area.innerHTML = '<div class="empty">No approved songs yet. Be the first to share your sound.</div>';
    return;
  }

  area.innerHTML = songs.map(s => `
    <article class="song-card">
      <div class="cover">♫</div>
      <h3>${escapeHtml(s.title)}</h3>
      <p>${escapeHtml(s.artist)}${s.genre ? " · " + escapeHtml(s.genre) : ""}</p>
      <div class="song-actions">
        <button class="gold-btn"
          data-play="${s.id}"
          data-title="${escapeAttr(s.title)}"
          data-artist="${escapeAttr(s.artist)}">▶ Play</button>
        <a class="outline" href="/api/songs/${s.id}/download">Download</a>
      </div>
    </article>
  `).join("");
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function escapeAttr(v) {
  return escapeHtml(v);
}

$("#songs").addEventListener("click", e => {
  const b = e.target.closest("[data-play]");
  if (!b) return;

  audio.src = `/api/songs/${b.dataset.play}/stream`;
  audio.play();

  $("#playingTitle").textContent = b.dataset.title;
  $("#playingArtist").textContent = b.dataset.artist;
});

$("#searchBtn").onclick = loadSongs;

$("#search").addEventListener("keydown", e => {
  if (e.key === "Enter") loadSongs();
});

function showUser() {
  const panel = $("#userPanel");

  if (!currentUser || !token) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  $("#welcome").textContent = `Signed in as ${currentUser.name}`;
  $("#loginOpen").textContent = "My account";

  const isAdmin = ["admin", "owner"].includes(currentUser.role);

  $("#adminPanel").classList.toggle("hidden", !isAdmin);

  loadMine();

  if (isAdmin) {
    loadPending();
    loadPendingAds();
  }
}

async function loadMine() {
  try {
    const songs = await api("/api/my-songs");

    $("#mySongs").innerHTML =
      `<h3>Your submissions</h3>` +
      (songs.length
        ? songs.map(s => `
          <p>${escapeHtml(s.title)} —
          <span class="muted">${escapeHtml(s.status)}</span></p>
        `).join("")
        : '<p class="muted">No submissions yet.</p>');
  } catch (err) {
    console.error("Could not load submissions:", err);
  }
}

async function loadPending() {
  try {
    const songs = await api("/api/admin/songs");

    $("#pendingSongs").innerHTML = songs.length
      ? songs.map(s => `
        <div class="pending">
          <p>
            <b>${escapeHtml(s.title)}</b> — ${escapeHtml(s.artist)}
            <br>
            <small class="muted">Uploaded by ${escapeHtml(s.uploader)}</small>
          </p>
          <button class="outline" data-approve="${s.id}">Approve</button>
          <button class="outline" data-reject="${s.id}">Reject</button>
        </div>
      `).join("")
      : '<p class="muted">No pending uploads.</p>';
  } catch (e) {
    $("#pendingSongs").textContent = e.message;
  }
}

async function loadPendingAds() {
  try {
    const ads = await api("/api/admin/ads");

    $("#pendingAds").innerHTML = ads.length
      ? ads.map(ad => `
        <div class="pending">
          <p>
            <b>${escapeHtml(ad.title)}</b> — ${escapeHtml(ad.business_name)}
            <br>
            <small class="muted">${escapeHtml(ad.placement)} · Submitted by ${escapeHtml(ad.submitter)}</small>
            <br>
            <a class="text-link"
              href="${escapeAttr(ad.target_url)}"
              target="_blank"
              rel="noopener">Destination</a>
          </p>
          <button class="outline" data-ad-approve="${ad.id}">Approve</button>
          <button class="outline" data-ad-reject="${ad.id}">Reject</button>
        </div>
      `).join("")
      : '<p class="muted">No pending advertising campaigns.</p>';
  } catch (e) {
    $("#pendingAds").textContent = e.message;
  }
}

$("#pendingAds").addEventListener("click", async e => {
  const b = e.target.closest("[data-ad-approve],[data-ad-reject]");
  if (!b) return;

  const id = b.dataset.adApprove || b.dataset.adReject;
  const action = b.dataset.adApprove ? "approve" : "reject";

  try {
    await api(`/api/admin/ads/${id}/${action}`, {
      method: "PATCH"
    });

    toast(`Advert ${action}d.`);
    loadPendingAds();
    loadAds();
  } catch (err) {
    toast(err.message);
  }
});

// ADVERTISING FORM
$("#adForm").addEventListener("submit", async e => {
  e.preventDefault();

  const form = e.currentTarget;

  if (!token) {
    $("#adMsg").textContent =
      "Please create an account or sign in before submitting an advert.";
    $("#account").scrollIntoView();
    return;
  }

  const body = Object.fromEntries(new FormData(form));

  try {
    const result = await api("/api/ads", {
      method: "POST",
      body: JSON.stringify(body)
    });

    $("#adMsg").textContent = result.message;
    form.reset();
  } catch (err) {
    $("#adMsg").textContent = err.message;
  }
});

$("#pendingSongs").addEventListener("click", async e => {
  const b = e.target.closest("[data-approve],[data-reject]");
  if (!b) return;

  const id = b.dataset.approve || b.dataset.reject;
  const action = b.dataset.approve ? "approve" : "reject";

  try {
    await api(`/api/admin/songs/${id}/${action}`, {
      method: "PATCH"
    });

    toast(`Song ${action}d.`);
    loadPending();
    loadSongs();
  } catch (err) {
    toast(err.message);
  }
});

// MUSIC UPLOAD FORM
$("#uploadForm").addEventListener("submit", async e => {
  e.preventDefault();

  const form = e.currentTarget;

  if (!token) {
    $("#uploadMsg").textContent =
      "Please create an account or sign in before uploading.";
    $("#account").scrollIntoView();
    return;
  }

  const formData = new FormData(form);

  try {
    const result = await api("/api/songs", {
      method: "POST",
      body: formData
    });

    $("#uploadMsg").textContent = result.message;
    form.reset();
    loadMine();
  } catch (err) {
    $("#uploadMsg").textContent = err.message;
  }
});

function setTab(tab) {
  document.querySelectorAll(".tab").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });

  $("#registerForm").classList.toggle("hidden", tab !== "register");
  $("#loginForm").classList.toggle("hidden", tab !== "login");
}

document.querySelectorAll(".tab").forEach(b => {
  b.onclick = () => setTab(b.dataset.tab);
});

$("#loginOpen").onclick = () => {
  $("#account").scrollIntoView({ behavior: "smooth" });
  setTab("login");
};

// REGISTRATION FORM
$("#registerForm").onsubmit = async e => {
  e.preventDefault();

  const form = e.currentTarget;
  const body = Object.fromEntries(new FormData(form));

  try {
    saveUser(await api("/api/register", {
      method: "POST",
      body: JSON.stringify(body)
    }));

    form.reset();
    $("#accountMsg").textContent = "Account created.";
  } catch (err) {
    $("#accountMsg").textContent = err.message;
  }
};

// LOGIN FORM
$("#loginForm").onsubmit = async e => {
  e.preventDefault();

  const form = e.currentTarget;
  const body = Object.fromEntries(new FormData(form));

  try {
    saveUser(await api("/api/login", {
      method: "POST",
      body: JSON.stringify(body)
    }));

    form.reset();
    $("#accountMsg").textContent = "You are signed in.";
  } catch (err) {
    $("#accountMsg").textContent = err.message;
  }
};

$("#logout").onclick = () => {
  token = "";
  currentUser = null;

  localStorage.removeItem("paya_token");
  localStorage.removeItem("paya_user");

  $("#userPanel").classList.add("hidden");
  $("#adminPanel").classList.add("hidden");
  $("#loginOpen").textContent = "Sign in";

  toast("Signed out.");
};

showUser();

loadSongs().catch(() => {
  $("#songs").innerHTML =
    '<div class="empty">Start the server to load the music catalogue.</div>';
});

loadAds();
  
