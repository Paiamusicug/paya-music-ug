/* Paya Music UG - public/app.js
   Complete frontend script. It safely checks optional page elements so the same
   file can run on pages where some forms/panels are not present.
*/
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const TOKEN_KEY = "paya_token";
const USER_KEY = "paya_user";
let token = localStorage.getItem(TOKEN_KEY) || "";
let currentUser = null;

try {
  currentUser = JSON.parse(localStorage.getItem(USER_KEY) || "null");
} catch {
  currentUser = null;
}

const audio = $("#audio");
const year = $("#year");
if (year) year.textContent = new Date().getFullYear();

function toast(message) {
  const el = $("#toast");
  if (!el) {
    console.log(message);
    return;
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3000);
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function authHeaders(extra = {}) {
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

async function api(url, options = {}) {
  const headers = authHeaders(options.headers || {});
  const response = await fetch(url, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = data && typeof data === "object"
      ? (data.error || data.message || "Request failed")
      : (data || "Request failed");
    throw new Error(message);
  }
  return data;
}

function saveSession(user, newToken) {
  if (newToken) {
    token = newToken;
    localStorage.setItem(TOKEN_KEY, token);
  }
  if (user) {
    currentUser = user;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  updateAccountUI();
}

function clearSession() {
  token = "";
  currentUser = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  updateAccountUI();
}

function isAdmin() {
  return ["admin", "owner"].includes(String(currentUser?.role || "").toLowerCase());
}

function isOwner() {
  return String(currentUser?.role || "").toLowerCase() === "owner";
}

function updateAccountUI() {
  const userPanel = $("#userPanel");
  const welcome = $("#welcome");
  const adminPanel = $("#adminPanel");
  const ownerPanel = $("#ownerPanel");
  const loginOpen = $("#loginOpen");
  const account = $("#account");

  if (userPanel) userPanel.hidden = !currentUser;
  if (welcome) welcome.textContent = currentUser
    ? `Welcome, ${currentUser.name || currentUser.username || currentUser.email || "User"}`
    : "";
  if (adminPanel) adminPanel.hidden = !isAdmin();
  if (ownerPanel) ownerPanel.hidden = !isOwner();
  if (loginOpen) loginOpen.hidden = !!currentUser;
  if (account) account.hidden = !!currentUser;

  const roleLabel = $("#userRole");
  if (roleLabel && currentUser) roleLabel.textContent = currentUser.role || "user";

  const profileName = $("#profileName");
  const profileBio = $("#profileBio");
  if (profileName && currentUser && !profileName.value) {
    profileName.value = currentUser.name || currentUser.username || "";
  }
  if (profileBio && currentUser && !profileBio.value) {
    profileBio.value = currentUser.bio || "";
  }
}

function songId(song) {
  return song.id ?? song.song_id ?? song.uuid ?? "";
}

function songTitle(song) {
  return song.title || song.name || "Untitled song";
}

function songArtist(song) {
  return song.artist || song.artist_name || song.username || "Unknown artist";
}

function songAudioUrl(song) {
  return song.audio_url || song.file_url || song.url || "";
}

function renderSongs(items = []) {
  const container = $("#songs");
  if (!container) return;

  if (!items.length) {
    container.innerHTML = '<p class="empty-state">No songs found yet.</p>';
    return;
  }

  container.innerHTML = items.map((song) => {
    const id = escapeHTML(songId(song));
    const title = escapeHTML(songTitle(song));
    const artist = escapeHTML(songArtist(song));
    const cover = song.cover_url || song.image_url || song.artwork_url || "";
    const coverHTML = cover
      ? `<img class="song-cover" src="${escapeHTML(cover)}" alt="${title} cover" loading="lazy">`
      : '<div class="song-cover song-cover-placeholder">♪</div>';
    const likes = Number(song.likes ?? song.like_count ?? 0);
    return `
      <article class="song-card" data-song-id="${id}">
        ${coverHTML}
        <div class="song-info">
          <h3>${title}</h3>
          <p>${artist}</p>
          <small data-like-count>${likes} likes</small>
        </div>
        <div class="song-actions">
          <button type="button" data-play="${id}">Play</button>
          <button type="button" data-like="${id}">Like</button>
          <button type="button" data-share="${id}">Share</button>
          <a href="/api/songs/${encodeURIComponent(songId(song))}/download">Download</a>
        </div>
      </article>`;
  }).join("");

  container.querySelectorAll("[data-play]").forEach((button) => {
    button.addEventListener("click", () => {
      const song = items.find((item) => String(songId(item)) === button.dataset.play);
      if (song) playSong(song);
    });
  });
  container.querySelectorAll("[data-like]").forEach((button) => {
    button.addEventListener("click", () => likeSong(button.dataset.like, button));
  });
  container.querySelectorAll("[data-share]").forEach((button) => {
    button.addEventListener("click", () => {
      const song = items.find((item) => String(songId(item)) === button.dataset.share);
      if (song) shareSong(song);
    });
  });
}

function playSong(song) {
  if (!audio) return toast("Audio player is not available on this page.");
  const url = songAudioUrl(song) || `/api/songs/${encodeURIComponent(songId(song))}/stream`;
  audio.src = url;
  const title = $("#playingTitle");
  const artist = $("#playingArtist");
  if (title) title.textContent = songTitle(song);
  if (artist) artist.textContent = songArtist(song);
  audio.play().catch(() => toast("Tap play again to start the song."));
    }function visitorKey() {
  let key = localStorage.getItem("paya_visitor_key");
  if (!key) {
    key = (window.crypto?.randomUUID?.() || `visitor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem("paya_visitor_key", key);
  }
  return key;
}

async function likeSong(id, button) {
  try {
    const result = await api(`/api/songs/${encodeURIComponent(id)}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitor_key: visitorKey() })
    });
    const card = button.closest(".song-card");
    const count = $("[data-like-count]", card);
    if (count && result.likes !== undefined) count.textContent = `${result.likes} likes`;
    button.textContent = result.liked === false ? "Like" : "Liked";
    toast(result.message || (result.liked === false ? "Like removed" : "Song liked"));
  } catch (error) {
    toast(error.message);
  }
}

async function shareSong(song) {
  const url = new URL(`/api/songs/${encodeURIComponent(songId(song))}/stream`, location.origin).href;
  const shareData = { title: songTitle(song), text: `${songTitle(song)} — ${songArtist(song)}`, url };
  try {
    if (navigator.share) await navigator.share(shareData);
    else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      toast("Song link copied.");
    } else {
      window.prompt("Copy this song link:", url);
    }
  } catch (error) {
    if (error.name !== "AbortError") toast("Could not share this song.");
  }
}

async function loadSongs(query = "") {
  const container = $("#songs");
  if (container) container.innerHTML = '<p class="loading">Loading songs…</p>';
  try {
    const result = await api(`/api/songs?q=${encodeURIComponent(query)}`);
    renderSongs(result.songs || []);
  } catch (error) {
    if (container) container.innerHTML = `<p class="error">${escapeHTML(error.message)}</p>`;
  }
}

async function loadAds() {
  const container = $("#homepageAdList");
  if (!container) return;
  try {
    const result = await api("/api/ads?placement=homepage");
    const ads = result.ads || [];
    container.innerHTML = ads.length ? ads.map((ad) => {
      const image = ad.image_url
        ? `<img src="${escapeHTML(ad.image_url)}" alt="${escapeHTML(ad.title || "Advertisement")}" loading="lazy">`
        : "";
      const href = ad.link_url || ad.url || "#";
      return `<a class="ad-card" href="${escapeHTML(href)}" target="_blank" rel="noopener">${image}<span>${escapeHTML(ad.title || "")}</span></a>`;
    }).join("") : "";
  } catch (error) {
    console.warn("Could not load adverts:", error.message);
  }
}

async function loadMine() {
  const container = $("#mySongs");
  if (!container || !token) return;
  try {
    const result = await api("/api/my-songs");
    const songs = result.songs || [];
    container.innerHTML = songs.length
      ? songs.map((song) => `<p>${escapeHTML(songTitle(song))} — <span>${escapeHTML(song.status || "pending")}</span></p>`).join("")
      : "<p>You have not uploaded any songs yet.</p>";
  } catch (error) {
    container.innerHTML = `<p>${escapeHTML(error.message)}</p>`;
  }
}

async function loadPendingSongs() {
  const container = $("#pendingSongs");
  if (!container || !isAdmin()) return;
  try {
    const result = await api("/api/admin/songs");
    const songs = result.songs || [];
    container.innerHTML = songs.length ? songs.map((song) => `
      <div class="admin-item">
        <strong>${escapeHTML(songTitle(song))}</strong>
        <span>${escapeHTML(songArtist(song))}</span>
        <button type="button" data-song-approve="${escapeHTML(songId(song))}">Approve</button>
        <button type="button" data-song-reject="${escapeHTML(songId(song))}">Reject</button>
      </div>`).join("") : "<p>No songs awaiting review.</p>";

    $$("[data-song-approve]", container).forEach((button) =>
      button.addEventListener("click", () => moderateSong(button.dataset.songApprove, "approved")));
    $$("[data-song-reject]", container).forEach((button) =>
      button.addEventListener("click", () => moderateSong(button.dataset.songReject, "rejected")));
  } catch (error) {
    container.innerHTML = `<p>${escapeHTML(error.message)}</p>`;
  }
}

async function moderateSong(id, status) {
  try {
    await api(`/api/admin/songs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    toast(`Song ${status}.`);
    loadPendingSongs();
    loadSongs($("#search")?.value || "");
  } catch (error) {
    toast(error.message);
  }
}

async function loadPendingAds() {
  const container = $("#pendingAds");
  if (!container || !isAdmin()) return;
  try {
    const result = await api("/api/admin/ads");
    const ads = result.ads || [];
    container.innerHTML = ads.length ? ads.map((ad) => `
      <div class="admin-item">
        <strong>${escapeHTML(ad.title || "Advertisement")}</strong>
        <button type="button" data-ad-approve="${escapeHTML(ad.id)}">Approve</button>
        <button type="button" data-ad-reject="${escapeHTML(ad.id)}">Reject</button>
      </div>`).join("") : "<p>No adverts awaiting review.</p>";

    $$("[data-ad-approve]", container).forEach((button) =>
      button.addEventListener("click", () => moderateAd(button.dataset.adApprove, "approved")));
    $$("[data-ad-reject]", container).forEach((button) =>
      button.addEventListener("click", () => moderateAd(button.dataset.adReject, "rejected")));
  } catch (error) {
    container.innerHTML = `<p>${escapeHTML(error.message)}</p>`;
  }
}

async function moderateAd(id, status) {
  try {
    await api(`/api/admin/ads/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    toast(`Advert ${status}.`);
    loadPendingAds();
    loadAds();
  } catch (error) {
    toast(error.message);
  }
}

async function loadNews() {
  const container = $("#newsList");
  if (!container) return;
  try {
    const result = await api("/api/news");
    const news = result.news || [];
    container.innerHTML = news.length ? news.map((item) => `
      <article class="news-card">
        ${item.image_url ? `<img src="${escapeHTML(item.image_url)}" alt="${escapeHTML(item.title || "News")}" loading="lazy">` : ""}
        <h3>${escapeHTML(item.title || "")}</h3>
        <p>${escapeHTML(item.content || item.body || "")}</p>
        ${item.created_at ? `<small>${escapeHTML(new Date(item.created_at).toLocaleDateString())}</small>` : ""}
      </article>`).join("") : "<p>No news posted yet.</p>";
  } catch (error) {
    container.innerHTML = `<p>${escapeHTML(error.message)}</p>`;
  }
}

async function uploadImage(endpoint, file) {
   // NEWS IMAGE PREVIEW
const newsImageInput = $("#newsImage");

if (newsImageInput) {
  const preview = document.createElement("img");

  preview.alt = "News image preview";
  preview.style.display = "none";
  preview.style.maxWidth = "100%";
  preview.style.maxHeight = "250px";
  preview.style.marginTop = "10px";
  preview.style.borderRadius = "10px";

  newsImageInput.insertAdjacentElement("afterend", preview);

  newsImageInput.addEventListener("change", () => {
    const file = newsImageInput.files?.[0];

    if (!file) {
      preview.removeAttribute("src");
      preview.style.display = "none";
      return;
    }

    preview.src = URL.createObjectURL(file);
    preview.style.display = "block";
  });
          }
  const formData = new FormData();
  formData.append("image", file);
  return api(endpoint, { method: "POST", body: formData });
}

function firstFile(form, selectors) {
  for (const selector of selectors) {
    const input = $(selector, form);
    if (input?.files?.[0]) return input.files[0];
  }
  return null;
      }function bindForm(selector, handler) {
  const form = $(selector);
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await handler(form);
    } catch (error) {
      toast(error.message);
    }
  });
}

bindForm("#registerForm", async (form) => {
  const data = Object.fromEntries(new FormData(form).entries());
  const result = await api("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  saveSession(result.user || result, result.token);
  form.reset();
  toast("Account created successfully.");
  await refreshDashboard();
});

bindForm("#loginForm", async (form) => {
  const data = Object.fromEntries(new FormData(form).entries());

  const result = await api("/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  saveSession(result.user || result, result.token);
  form.reset();
  toast("Login successful.");
  await refreshDashboard();
});

const logout = $("#logout");
if (logout) logout.addEventListener("click", () => {
  clearSession();
  toast("You have logged out.");
  loadPendingSongs();
  loadPendingAds();
});

bindForm("#uploadForm", async (form) => {
  if (!token) throw new Error("Please log in before uploading.");
  const formData = new FormData(form);
  await api("/api/songs", { method: "POST", body: formData });
  form.reset();
  const message = $("#uploadMsg");
  if (message) message.textContent = "Song submitted for approval.";
  toast("Song uploaded.");
  loadMine();
});

bindForm("#adForm", async (form) => {
  if (!token) throw new Error("Please log in before submitting an advert.");
  const formData = new FormData(form);
  await api("/api/ads", { method: "POST", body: formData });
  form.reset();
  const message = $("#adMsg");
  if (message) message.textContent = "Advert submitted for approval.";
  toast("Advert submitted.");
  loadPendingAds();
});

const search = $("#search");
const searchBtn = $("#searchBtn");
if (searchBtn) searchBtn.addEventListener("click", () => loadSongs(search?.value || ""));
if (search) search.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    loadSongs(search.value);
  }
});

const loginOpen = $("#loginOpen");
if (loginOpen) loginOpen.addEventListener("click", () => {
  $("#account")?.scrollIntoView({ behavior: "smooth", block: "center" });
});

bindForm("#profileForm", async (form) => {
  if (!token) throw new Error("Please log in first.");
  const name = $("#profileName", form)?.value?.trim() || "";
  const bio = $("#profileBio", form)?.value?.trim() || "";
  const file = firstFile(form, ["#profileAvatar", 'input[name="avatar"]', 'input[name="image"]']);

  if (file) {
    const uploaded = await uploadImage("/api/profile/avatar", file);
    const avatarUrl = uploaded.avatar_url || uploaded.image_url || uploaded.url;
    if (avatarUrl) currentUser = { ...currentUser, avatar_url: avatarUrl };
  }

  const result = await api("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, bio })
  });
  saveSession(result.user || result, token);
  toast("Profile updated.");
});

bindForm("#newsForm", async (form) => {
  if (!isAdmin()) {
    throw new Error("Only an administrator can post news.");
  }

  const title =
    $('input[name="title"]', form)?.value?.trim() || "";

  const content =
    $('textarea[name="content"]', form)?.value?.trim() || "";

  const category =
    $('select[name="category"]', form)?.value || "music";

  const file = firstFile(form, ['input[name="image"]']);

  const typedImageUrl =
    $('input[name="image_url"]', form)?.value?.trim() || "";

  let image_url = typedImageUrl;

  if (file) {
    const uploaded = await uploadImage(
      "/api/admin/news/image",
      file
    );

    image_url =
      uploaded.image_url ||
      uploaded.url ||
      uploaded.publicUrl ||
      typedImageUrl;
  }

  await api("/api/admin/news", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title,
      content,
      category,
      image_url
    })
  });

  form.reset();

  if (newsImageInput) {
    newsImageInput.dispatchEvent(new Event("change"));
  }

  const message = $("#newsMsg");
  if (message) {
    message.textContent = "News published successfully.";
  }

  toast("News published.");

  await loadNews();
});
  
  

async function loadOwnerUsers() {
  const container = $("#ownerUsers") || $("#usersList");
  if (!container || !isOwner()) return;
  try {
    const result = await api("/api/owner/users");
    const users = result.users || [];
    container.innerHTML = users.length ? users.map((user) => `
      <div class="admin-item">
        <strong>${escapeHTML(user.name || user.username || user.email || "User")}</strong>
        <span>${escapeHTML(user.email || "")}</span>
        <span>Role: ${escapeHTML(user.role || "user")}</span>
        <select aria-label="Role for ${escapeHTML(user.email || user.id)}" data-user-role="${escapeHTML(user.id)}">
          <option value="user" ${user.role === "user" ? "selected" : ""}>User</option>
          <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
          <option value="owner" ${user.role === "owner" ? "selected" : ""}>Owner</option>
        </select>
        <button type="button" data-save-role="${escapeHTML(user.id)}">Save role</button>
      </div>`).join("") : "<p>No users found.</p>";

    $$("[data-save-role]", container).forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.saveRole;
        const select = $(`[data-user-role="${CSS.escape(id)}"]`, container);
        if (!select) return;
        try {
          await api(`/api/owner/users/${encodeURIComponent(id)}/role`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: select.value })
          });
          toast("User role updated.");
          loadOwnerUsers();
        } catch (error) {
          toast(error.message);
        }
      });
    });
  } catch (error) {
    container.innerHTML = `<p>${escapeHTML(error.message)}</p>`;
  }
}

async function refreshDashboard() {
  updateAccountUI();
  await Promise.allSettled([
    loadMine(),
    loadPendingSongs(),
    loadPendingAds(),
    loadOwnerUsers()
  ]);
}

async function restoreSession() {
  if (!token) {
    updateAccountUI();
    return;
  }
  try {
    const result = await api("/api/me");
    const user = result.user || result;
    if (user && (user.id || user.email || user.name)) {
      saveSession(user, token);
    }
  } catch {
    clearSession();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await restoreSession();
  await Promise.allSettled([
    loadSongs(),
    loadAds(),
    loadNews(),
    refreshDashboard()
  ]);
});
