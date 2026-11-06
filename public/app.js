const $ = (s) => document.querySelector(s);

let token = localStorage.getItem("paya_token") || "";
let currentUser = JSON.parse(localStorage.getItem("paya_user") || "null");

const audio = $("#audio");

$("#year").textContent = new Date().getFullYear();

// ========================================
// TOAST MESSAGE
// ========================================

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");

  setTimeout(() => el.classList.remove("show"), 3200);
}

// ========================================
// API REQUESTS
// ========================================

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

// ========================================
// SAVE USER
// ========================================

function saveUser(data) {
  token = data.token;
  currentUser = data.user;

  localStorage.setItem("paya_token", token);
  localStorage.setItem("paya_user", JSON.stringify(currentUser));

  showUser();

  toast(`Welcome, ${currentUser.name}!`);
}

// ========================================
// HTML ESCAPING
// ========================================

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

// ========================================
// LOAD HOMEPAGE ADVERTS
// ========================================

async function loadAds() {
  try {
    const result = await api("/api/ads?placement=homepage");
    const ads = result.ads || [];

    const area = $("#homepageAdList");

    area.innerHTML = ads.length
      ? ads.map(ad => `
        <a class="ad-card"
           href="${escapeAttr(ad.target_url)}"
           target="_blank"
           rel="noopener sponsored">

          <img src="${escapeAttr(ad.image_url)}" alt="">

          <span>
            <small>
              SPONSORED · ${escapeHtml(ad.business_name)}
            </small>

            <b>${escapeHtml(ad.title)}</b>

            <small>
              ${escapeHtml(ad.description || "Visit sponsor")}
            </small>
          </span>
        </a>
      `).join("")
      : '<p class="muted">Your business could be featured here. <a class="text-link" href="#advertise">Advertise with us →</a></p>';

  } catch (err) {
    console.error("Could not load adverts:", err);
  }
}

// ========================================
// LOAD PUBLIC APPROVED SONGS
// ========================================

async function loadSongs() {
  const q = $("#search").value.trim();

  const result = await api(
    `/api/songs?q=${encodeURIComponent(q)}`
  );

  const songs = result.songs || [];
  const area = $("#songs");

  if (!songs.length) {
    area.innerHTML =
      '<div class="empty">No approved songs yet. Be the first to share your sound.</div>';

    return;
  }

  area.innerHTML = songs.map(s => `
    <article class="song-card">

      <div class="cover">♫</div>

      <h3>${escapeHtml(s.title)}</h3>

      <p>
        ${escapeHtml(s.artist)}
        ${s.genre ? " · " + escapeHtml(s.genre) : ""}
      </p>

      <div class="song-actions">

        <button class="gold-btn"
          data-play="${s.id}"
          data-title="${escapeAttr(s.title)}"
          data-artist="${escapeAttr(s.artist)}">
          ▶ Play
        </button>

        <a class="outline"
          href="/api/songs/${s.id}/download">
          Download
        </a>

      </div>
    </article>
  `).join("");
}

// ========================================
// MUSIC NEWS — PUBLIC DISPLAY
// ========================================

async function loadNews() {
  const area = $("#newsList");

  // Do not crash if the news section is not in index.html yet.
  if (!area) return;

  try {
    const result = await api("/api/news");
    const news = result.news || [];

    if (!news.length) {
      area.innerHTML =
        '<div class="empty">No music news published yet. Check back soon.</div>';

      return;
    }

    area.innerHTML = news.map(item => `
      <article class="news-card">

        ${item.image_url ? `
          <img
            class="news-image"
            src="${escapeAttr(item.image_url)}"
            alt="${escapeAttr(item.title)}"
            loading="lazy">
        ` : ""}

        <div class="news-content">

          <span class="news-category">
            ${escapeHtml(item.category || "Music News")}
          </span>

          <h3>${escapeHtml(item.title)}</h3>

          <p>${escapeHtml(item.content)}</p>

          ${item.published_at ? `
            <small class="muted">
              ${escapeHtml(
                new Date(item.published_at).toLocaleDateString()
              )}
            </small>
          ` : ""}

        </div>
      </article>
    `).join("");

  } catch (err) {
    console.error("Could not load music news:", err);

    area.innerHTML =
      '<div class="empty">Could not load music news.</div>';
  }
}

// ========================================
// MUSIC PLAYER
// ========================================

$("#songs").addEventListener("click", e => {
  const b = e.target.closest("[data-play]");

  if (!b) return;

  audio.src = `/api/songs/${b.dataset.play}/stream`;

  audio.play().catch(err => {
    console.error("Audio playback failed:", err);
    toast("Could not play this song.");
  });

  $("#playingTitle").textContent = b.dataset.title;
  $("#playingArtist").textContent = b.dataset.artist;
});

// ========================================
// SEARCH
// ========================================

$("#searchBtn").onclick = () => {
  loadSongs().catch(err => {
    console.error(err);
    toast("Could not load songs.");
  });
};

$("#search").addEventListener("keydown", e => {
  if (e.key === "Enter") {
    loadSongs().catch(err => {
      console.error(err);
      toast("Could not load songs.");
    });
  }
});

// ========================================
// ACCOUNT DISPLAY
// ========================================

function showUser() {
  const panel = $("#userPanel");

  if (!currentUser || !token) {
    panel.classList.add("hidden");
    $("#adminPanel").classList.add("hidden");
    $("#loginOpen").textContent = "Sign in";

    return;
  }

  panel.classList.remove("hidden");

  $("#welcome").textContent =
    `Signed in as ${currentUser.name}`;

  $("#loginOpen").textContent = "My account";

  const isAdmin = ["admin", "owner"].includes(currentUser.role);

  $("#adminPanel").classList.toggle("hidden", !isAdmin);

  loadMine();

  if (isAdmin) {
    loadPending();
    loadPendingAds();
  }
}

// ========================================
// LOAD MY SUBMISSIONS
// ========================================

async function loadMine() {
  try {
    const result = await api("/api/my-songs");

    const songs = result.songs || [];

    $("#mySongs").innerHTML =
      `<h3>Your submissions</h3>` +

      (songs.length
        ? songs.map(s => `
          <p>
            ${escapeHtml(s.title)} —
            <span class="muted">
              ${escapeHtml(s.status)}
            </span>
          </p>
        `).join("")

        : '<p class="muted">No submissions yet.</p>');

  } catch (err) {
    console.error("Could not load submissions:", err);
  }
}

// ========================================
// ADMIN: LOAD PENDING SONGS
// ========================================

async function loadPending() {
  try {
    const result = await api("/api/admin/songs");
    const songs = result.songs || [];

    $("#pendingSongs").innerHTML = songs.length

      ? songs.map(s => `
        <div class="pending">

          <p>
            <b>${escapeHtml(s.title)}</b>
            — ${escapeHtml(s.artist)}

            <br>

            <small class="muted">
              Uploaded by ${escapeHtml(s.uploader_id)}
            </small>
          </p>

          <button class="outline"
            data-approve="${s.id}">
            Approve
          </button>

          <button class="outline"
            data-reject="${s.id}">
            Reject
          </button>

        </div>
      `).join("")

      : '<p class="muted">No pending uploads.</p>';

  } catch (err) {
    $("#pendingSongs").textContent = err.message;
  }
}

// ========================================
// ADMIN: LOAD PENDING ADVERTS
// ========================================

async function loadPendingAds() {
  try {
    const result = await api("/api/admin/ads");
    const ads = result.ads || [];

    $("#pendingAds").innerHTML = ads.length

      ? ads.map(ad => `
        <div class="pending">

          <p>
            <b>${escapeHtml(ad.title)}</b>
            — ${escapeHtml(ad.business_name)}

            <br>

            <small class="muted">
              ${escapeHtml(ad.placement)}
            </small>

            <br>

            <a class="text-link"
              href="${escapeAttr(ad.target_url)}"
              target="_blank"
              rel="noopener">
              Destination
            </a>
          </p>

          <button class="outline"
            data-ad-approve="${ad.id}">
            Approve
          </button>

          <button class="outline"
            data-ad-reject="${ad.id}">
            Reject
          </button>

        </div>
      `).join("")

      : '<p class="muted">No pending advertising campaigns.</p>';

  } catch (err) {
    $("#pendingAds").textContent = err.message;
  }
}

// ========================================
// ADMIN: APPROVE OR REJECT SONGS
// ========================================

$("#pendingSongs").addEventListener("click", async e => {
  const b = e.target.closest("[data-approve],[data-reject]");

  if (!b) return;

  const id = b.dataset.approve || b.dataset.reject;

  const status = b.dataset.approve
    ? "approved"
    : "rejected";

  try {
    await api(`/api/admin/songs/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });

    toast(`Song ${status}.`);

    await loadPending();
    await loadSongs();
    await loadMine();

  } catch (err) {
    toast(err.message);
  }
});

// ========================================
// ADMIN: APPROVE OR REJECT ADVERTS
// ========================================

$("#pendingAds").addEventListener("click", async e => {
  const b = e.target.closest(
    "[data-ad-approve],[data-ad-reject]"
  );

  if (!b) return;

  const id =
    b.dataset.adApprove || b.dataset.adReject;

  const status = b.dataset.adApprove
    ? "approved"
    : "rejected";

  try {
    await api(`/api/admin/ads/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });

    toast(`Advert ${status}.`);

    await loadPendingAds();
    await loadAds();

  } catch (err) {
    toast(err.message);
  }
});

// ========================================
// ADMIN: PUBLISH MUSIC NEWS
// ========================================

const newsForm = $("#newsForm");

if (newsForm) {
  newsForm.addEventListener("submit", async e => {
    e.preventDefault();

    const form = e.currentTarget;
    const message = $("#newsMsg");

    if (!token) {
      message.textContent = "Please sign in as an admin.";
      return;
    }

    const body = Object.fromEntries(new FormData(form));

    try {
      const result = await api("/api/admin/news", {
        method: "POST",
        body: JSON.stringify(body)
      });

      message.textContent =
        result.message || "News published successfully.";

      form.reset();

      await loadNews();

      toast("Music news published.");

    } catch (err) {
      message.textContent = err.message;
    }
  });
}

// ========================================
// ADVERTISING FORM
// ========================================

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

    loadPendingAds();

  } catch (err) {
    $("#adMsg").textContent = err.message;
  }
});

// ========================================
// MUSIC UPLOAD FORM
// ========================================

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

    await loadMine();

    if (currentUser &&
        ["admin", "owner"].includes(currentUser.role)) {
      await loadPending();
    }

  } catch (err) {
    $("#uploadMsg").textContent = err.message;
  }
});

// ========================================
// ACCOUNT TABS
// ========================================

function setTab(tab) {
  document.querySelectorAll(".tab").forEach(b => {
    b.classList.toggle(
      "active",
      b.dataset.tab === tab
    );
  });

  $("#registerForm").classList.toggle(
    "hidden",
    tab !== "register"
  );

  $("#loginForm").classList.toggle(
    "hidden",
    tab !== "login"
  );
}

document.querySelectorAll(".tab").forEach(b => {
  b.onclick = () => setTab(b.dataset.tab);
});

$("#loginOpen").onclick = () => {
  $("#account").scrollIntoView({ behavior: "smooth" });

  setTab("login");
};

// ========================================
// REGISTRATION
// ========================================

$("#registerForm").onsubmit = async e => {
  e.preventDefault();

  const form = e.currentTarget;

  const body = Object.fromEntries(
    new FormData(form)
  );

  try {
    saveUser(await api("/api/register", {
      method: "POST",
      body: JSON.stringify(body)
    }));

    form.reset();

    $("#accountMsg").textContent =
      "Account created.";

  } catch (err) {
    $("#accountMsg").textContent = err.message;
  }
};

// ========================================
// LOGIN
// ========================================

$("#loginForm").onsubmit = async e => {
  e.preventDefault();

  const form = e.currentTarget;

  const body = Object.fromEntries(
    new FormData(form)
  );

  try {
    saveUser(await api("/api/login", {
      method: "POST",
      body: JSON.stringify(body)
    }));

    form.reset();

    $("#accountMsg").textContent =
      "You are signed in.";

  } catch (err) {
    $("#accountMsg").textContent = err.message;
  }
};

// ========================================
// LOGOUT
// ========================================

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

// ========================================
// INITIALIZE WEBSITE
// ========================================

showUser();

loadSongs().catch(err => {
  console.error("Could not load songs:", err);

  $("#songs").innerHTML =
    '<div class="empty">Could not load the music catalogue.</div>';
});

loadAds();

loadNews();
