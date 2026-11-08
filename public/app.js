// Mobile-safe account tab switching: use delegated capture so tabs keep
// working even if other page initialization code fails later.
document.addEventListener("click", (event) => {
  const tab = event.target.closest(".tab[data-tab]");
  if (!tab) return;
  event.preventDefault();
  event.stopPropagation();
  const mode = tab.dataset.tab;
  document.querySelectorAll(".tabs .tab").forEach((item) => {
    item.classList.toggle("active", item === tab);
    item.setAttribute("aria-selected", item === tab ? "true" : "false");
  });
  const registerForm = document.getElementById("registerForm");
  const loginForm = document.getElementById("loginForm");
  if (registerForm) registerForm.classList.toggle("hidden", mode !== "register");
  if (loginForm) loginForm.classList.toggle("hidden", mode !== "login");
}, true);

/* Paya Music UG - public/app.js
   Complete frontend script. It safely checks optional page elements so the same
   file can run on pages where some forms/panels are not present.
*/
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const TOKEN_KEY = "paya_token";
const USER_KEY = "paya_user";
const LIKES_KEY = "paya_liked_songs";
const DEFAULT_SONG_COVER = "/paya-default-cover.svg";
function savedLikes() { try { return JSON.parse(localStorage.getItem(LIKES_KEY) || "[]").map(String); } catch { return []; } }
function saveLike(id, liked) { const ids = new Set(savedLikes()); if (liked) ids.add(String(id)); else ids.delete(String(id)); localStorage.setItem(LIKES_KEY, JSON.stringify([...ids])); }
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
  const profileEditor = $("#profileEditor");
  const welcome = $("#welcome");
  const adminPanel = $("#adminPanel");
  const ownerPanel = $("#ownerPanel");
  const loginOpen = $("#loginOpen");
  const account = $("#account");
  const tabs = $(".tabs", account || document);
  const registerForm = $("#registerForm");
  const loginForm = $("#loginForm");
  const registrationOnly = new URLSearchParams(window.location.search).get("artist-register") === "1";

  // A shareable artist-registration view that never exposes the signed-in
  // owner's profile/dashboard and does not replace the owner's local session.
  document.body.classList.toggle("artist-registration-only", registrationOnly);
  if (account) account.hidden = false;
  if (userPanel) userPanel.classList.toggle("hidden", registrationOnly || !currentUser);
  if (profileEditor) profileEditor.classList.toggle("hidden", registrationOnly || !currentUser);
  if (tabs) tabs.hidden = registrationOnly || !!currentUser;
  if (registerForm) registerForm.classList.toggle("hidden", registrationOnly ? false : !!currentUser);
  if (loginForm) loginForm.classList.toggle("hidden", registrationOnly || !!currentUser);
  if (welcome) welcome.textContent = currentUser
    ? `Welcome, ${currentUser.name || currentUser.username || currentUser.email || "User"}`
    : "";
  if (adminPanel) adminPanel.classList.toggle("hidden", !isAdmin());
  if (ownerPanel) ownerPanel.classList.toggle("hidden", !isOwner());
  if (loginOpen) loginOpen.hidden = !!currentUser;

  const roleLabel = $("#userRole");
  if (roleLabel && currentUser) roleLabel.textContent = currentUser.role || "user";

  const profileName = $("#profileName");
  const profileBio = $("#profileBio");
  const profileAvatar = $("#profileAvatar");
  const navAvatar = $("#navAvatar");
  const navArtistName = $("#navArtistName");
  const accountAvatarLink = $("#accountAvatarLink");
  if (navAvatar && accountAvatarLink) {
    const savedAvatar = currentUser?.avatar_url || "";
    if (savedAvatar) { navAvatar.src = savedAvatar; navAvatar.hidden = false; navAvatar.style.display = "block"; }
    else { navAvatar.removeAttribute("src"); navAvatar.hidden = true; }
    accountAvatarLink.classList.toggle("hidden", !currentUser);
  }
  if (navArtistName) {
    navArtistName.textContent = currentUser?.name || currentUser?.username || "";
  }
  if (profileAvatar) {
    profileAvatar.src = currentUser?.avatar_url || "";
    profileAvatar.hidden = !currentUser?.avatar_url;
  }
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
    const cover = song.cover_url || song.image_url || song.artwork_url || DEFAULT_SONG_COVER;
    const coverHTML = cover
      ? `<img class="song-cover" src="${escapeHTML(cover)}" alt="${title} cover" loading="lazy">`
      : '<div class="song-cover song-cover-placeholder">♪</div>';
    const likes = Number(song.likes ?? song.like_count ?? 0);
    const plays = Number(song.play_count ?? 0);
    const downloads = Number(song.download_count ?? 0);
    return `
      <article class="song-card" data-song-id="${id}">
        ${coverHTML}
        <div class="song-info">
          <h3>${title}</h3>
          <p>${artist}</p>
          <small class="song-stat-line"><span data-like-count>${likes} likes</span> · <span>${plays} plays</span> · <span>${downloads} downloads</span></small>
        </div>
        <div class="song-actions">
          <button type="button" data-play="${id}">Play</button>
          <button type="button" data-like="${id}" aria-pressed="${savedLikes().includes(String(songId(song)))}">${savedLikes().includes(String(songId(song))) ? "Liked" : "Like"}</button>
          <button type="button" data-share="${id}">Share</button>
          <a href="/api/songs/${encodeURIComponent(songId(song))}/download">Download</a>
          ${isAdmin() ? `<button type="button" class="delete-song-btn" data-delete-song="${id}">Delete</button>` : ""}
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
  container.querySelectorAll("[data-delete-song]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.deleteSong;
      if (!isAdmin() || !window.confirm("Permanently delete this song? This cannot be undone.")) return;
      button.disabled = true;
      try {
        await api(`/api/admin/songs/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast("Song deleted.");
        await loadSongs($("#search")?.value || "");
        await loadMine();
        await loadPendingSongs();
      } catch (error) {
        toast(error.message || "Could not delete song.");
        button.disabled = false;
      }
    });
  });
}

let lastCountedPlay = "";
audio?.addEventListener("playing", () => {
  const id = audio.dataset.payaSongId;
  if (!id || lastCountedPlay === id) return;
  lastCountedPlay = id;
  api(`/api/songs/${encodeURIComponent(id)}/play`, { method: "POST" })
    .catch((error) => console.warn("Could not record song play:", error.message));
});

function playSong(song) {
  if (!audio) return toast("Audio player is not available on this page.");
  audio.dataset.payaSongId = String(songId(song));
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
    saveLike(id, result.liked !== false);
    button.textContent = result.liked === false ? "Like" : "Liked";
    button.setAttribute("aria-pressed", String(result.liked !== false));
    toast(result.message || (result.liked === false ? "Like removed" : "Song liked"));
  } catch (error) {
    toast(error.message);
  }
}

async function shareSong(song) {
  const url = new URL(`/song/${encodeURIComponent(songId(song))}`, location.origin).href;
  const shareData = {
    title: `${songTitle(song)} — ${songArtist(song)} | Paya Music UG`,
    text: `Listen to ${songTitle(song)} by ${songArtist(song)} on Paya Music UG:`,
    url
  };
  try {
    if (navigator.share) await navigator.share(shareData);
    else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      toast("Song page link copied. Share it on WhatsApp to show the artwork.");
    } else {
      window.prompt("Copy this song page link:", url);
    }
  } catch (error) {
    if (error.name !== "AbortError") toast("Could not share this song.");
  }
}

async function loadSongs(query = "") {
  const container = $("#songs");
  const sort = $("#songSort")?.value || "newest";
  if (container) container.innerHTML = '<p class="loading">Loading songs…</p>';
  try {
    const result = await api(`/api/songs?q=${encodeURIComponent(query)}&sort=${encodeURIComponent(sort)}`);
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
      ? songs.map((song) => `
        <div class="my-song-stat">
          <strong>${escapeHTML(songTitle(song))}</strong>
          <span class="my-song-status">${escapeHTML(song.status || "pending")}</span>
          <div class="my-song-counts">
            <span>▶ ${Number(song.play_count || 0)} plays</span>
            <span>↓ ${Number(song.download_count || 0)} downloads</span>
          </div>
          <button type="button" data-edit-own-song="${escapeHTML(songId(song))}">Edit song details</button>
        </div>`).join("")
      : "<p>You have not uploaded any songs yet.</p>";
    $$("[data-edit-own-song]", container).forEach((button) => {
      button.addEventListener("click", async () => {
        const song = songs.find((item) => String(songId(item)) === button.dataset.editOwnSong);
        if (!song) return;
        const title = window.prompt("Song title:", songTitle(song));
        if (title === null) return;
        const artist = window.prompt("Artist name:", songArtist(song));
        if (artist === null) return;
        button.disabled = true;
        try {
          await api(`/api/my-songs/${encodeURIComponent(songId(song))}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, artist, genre: song.genre || "", description: song.description || "" })
          });
          toast("Your song details were updated.");
          await Promise.all([loadMine(), loadSongs($("#search")?.value || "")]);
        } catch (error) {
          toast(error.message || "Could not update song.");
          button.disabled = false;
        }
      });
    });
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
        <button type="button" data-delete-song="${escapeHTML(songId(song))}">Delete</button>
      </div>`).join("") : "<p>No songs awaiting review.</p>";

    $$$("[data-song-approve]", container).forEach((button) =>
      button.addEventListener("click", () => moderateSong(button.dataset.songApprove, "approved")));
    $$("[data-song-reject]", container).forEach((button) =>
      button.addEventListener("click", () => moderateSong(button.dataset.songReject, "rejected")));
    $$("[data-delete-song]", container).forEach((button) =>
      button.addEventListener("click", async () => {
        if (!isAdmin() || !window.confirm("Permanently delete this song? This cannot be undone.")) return;
        button.disabled = true;
        try {
          await api(`/api/admin/songs/${encodeURIComponent(button.dataset.deleteSong)}`, { method: "DELETE" });
          toast("Song deleted.");
          await loadPendingSongs();
          await loadSongs($("#search")?.value || "");
        } catch (error) { toast(error.message || "Could not delete song."); button.disabled = false; }
      }));
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

    $$$("[data-ad-approve]", container).forEach((button) =>
      button.addEventListener("click", () => moderateAd(button.dataset.adApprove, "approved")));
    $$$("[data-ad-reject]", container).forEach((button) =>
      button.addEventListener("click", () => moderateAd(button.dataset.adReject, "rejected")));
  } catch (error) {
    container.innerHTML = `<p>${escapeHTML(error.message)}</p>`;
  }
}

async function loadPendingProfiles() {
  const container = $("#pendingProfiles");
  if (!container || !isAdmin()) return;
  try {
    const result = await api("/api/admin/profiles");
    const items = result.submissions || [];
    container.innerHTML = items.length ? items.map((item) => `<div class="admin-item"><strong>${escapeHTML(item.name || "Artist profile")}</strong><p>${escapeHTML(item.bio || "")}</p>${item.avatar_url ? `<img src="${escapeHTML(item.avatar_url)}" alt="Pending profile" width="90">` : ""}<button type="button" data-profile-approve="${escapeHTML(item.id)}">Approve</button><button type="button" data-profile-reject="${escapeHTML(item.id)}">Reject</button></div>`).join("") : "<p>No artist profiles awaiting review.</p>";
    $$$("[data-profile-approve]", container).forEach((button) => button.addEventListener("click", () => moderateProfile(button.dataset.profileApprove, "approved")));
    $$$("[data-profile-reject]", container).forEach((button) => button.addEventListener("click", () => moderateProfile(button.dataset.profileReject, "rejected")));
  } catch (error) { container.innerHTML = `<p>${escapeHTML(error.message)}</p>`; }
}

async function moderateProfile(id, status) {
  try { await api(`/api/admin/profiles/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); toast(`Artist profile ${status}.`); loadPendingProfiles(); }
  catch (error) { toast(error.message); }
}

async function loadPendingNews() {
  const container = $("#pendingNews");
  if (!container || !isAdmin()) return;
  try {
    const result = await api("/api/admin/news");
    const items = result.news || [];
    container.innerHTML = items.length ? items.map((item) => `<div class="admin-item"><strong>${escapeHTML(item.title || "News article")}</strong><p>${escapeHTML((item.content || "").slice(0, 240))}</p><button type="button" data-news-approve="${escapeHTML(item.id)}">Approve & publish</button><button type="button" data-news-reject="${escapeHTML(item.id)}">Reject</button></div>`).join("") : "<p>No news awaiting review.</p>";
    $$$("[data-news-approve]", container).forEach((button) => button.addEventListener("click", () => moderateNews(button.dataset.newsApprove, "published")));
    $$$("[data-news-reject]", container).forEach((button) => button.addEventListener("click", () => moderateNews(button.dataset.newsReject, "rejected")));
  } catch (error) { container.innerHTML = `<p>${escapeHTML(error.message)}</p>`; }
}

async function moderateNews(id, status) {
  try { await api(`/api/admin/news/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); toast(status === "published" ? "News published." : "News rejected."); loadPendingNews(); loadNews(); }
  catch (error) { toast(error.message); }
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

function formatNewsText(value = "") {
  const lines = String(value).replace(/\r/g, "").split("\n");
  const inline = (text) => escapeHTML(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<strong>$1</strong>");
  const output = [];
  let listOpen = false;
  const closeList = () => { if (listOpen) { output.push("</ul>"); listOpen = false; } };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { closeList(); continue; }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    const bullet = line.match(/^[-•]\s+(.+)$/);
    if (heading) {
      closeList();
      output.push("<h4>" + inline(heading[1]) + "</h4>");
    } else if (bullet) {
      if (!listOpen) { output.push("<ul>"); listOpen = true; }
      output.push("<li>" + inline(bullet[1]) + "</li>");
    } else {
      closeList();
      output.push("<p>" + inline(line) + "</p>");
    }
  }
  closeList();
  return output.join("");
}

async function loadNews() {
  const container = $("#newsList");
  if (!container) return;
  try {
    const result = await api("/api/news");
    const news = result.news || [];
    container.innerHTML = news.length ? news.map((item) => `
      <article class="news-card">
        ${item.image_url ? `<img class="news-image" src="${escapeHTML(item.image_url)}" alt="${escapeHTML(item.title || "News")}" loading="lazy">` : ""}
        <div class="news-content">
          <h3>${escapeHTML(item.title || "")}</h3>
          <div class="news-body">${formatNewsText(item.content || item.body || "")}</div>
          ${item.created_at ? `<small class="muted">${escapeHTML(new Date(item.created_at).toLocaleDateString())}</small>` : ""}
        </div>
      </article>`).join("") : "<p>No news posted yet.</p>";
  } catch (error) {
    container.innerHTML = `<p>${escapeHTML(error.message)}</p>`;
  }
}

// Upload a selected image file to the requested protected endpoint.
async function uploadImage(endpoint, file) {
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

// Tab switching is handled by the delegated listener at the top of this file.

bindForm("#registerForm", async (form) => {
  const data = Object.fromEntries(new FormData(form).entries());
  const result = await api("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const registrationOnly = new URLSearchParams(window.location.search).get("artist-register") === "1";
  form.reset();
  if (registrationOnly) {
    const claimed = Number(result.claimed_songs || 0);
    const message = claimed
      ? `Artist account created. ${claimed} matching song(s) have been added to the artist account. The artist can now sign in.`
      : "Artist account created successfully. The artist can now sign in.";
    const accountMsg = $("#accountMsg");
    if (accountMsg) accountMsg.textContent = message;
    toast("Artist account created successfully.");
    return;
  }
  saveSession(result.user || result, result.token);
  toast("Account created successfully.");
  await refreshDashboard();
});

bindForm("#loginForm", async (form) => {
  const submit = form.querySelector('button[type="submit"], input[type="submit"]');
  const originalLabel = submit?.textContent || submit?.value || "Sign in";
  const status = $("#loginMsg");
  const data = Object.fromEntries(new FormData(form).entries());
  if (status) { status.textContent = "Signing in…"; status.setAttribute("role", "status"); }
  if (submit) { submit.disabled = true; if (submit.tagName === "BUTTON") submit.textContent = "Signing in…"; else submit.value = "Signing in…"; }
  try {
    const result = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    if (!result.token || !result.user) throw new Error("The server did not return a valid login session. Please try again.");
    saveSession(result.user, result.token);
    form.reset();
    const name = result.user.name || result.user.email || "your account";
    if (status) status.textContent = `Signed in successfully as ${name}.`;
    toast(`Welcome, ${name}! You are signed in.`);
    await refreshDashboard();
  } catch (error) {
    if (status) status.textContent = error.message || "Sign in failed. Please try again.";
    throw error;
  } finally {
    if (submit) { submit.disabled = false; if (submit.tagName === "BUTTON") submit.textContent = originalLabel; else submit.value = originalLabel; }
  }
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
  const preview = $("#songCoverPreview");
  if (preview) { preview.removeAttribute("src"); preview.hidden = true; }
  const message = $("#uploadMsg");
  if (message) message.textContent = isAdmin() ? "Song uploaded and published successfully." : "Song submitted for approval.";
  toast(isAdmin() ? "Song uploaded and published." : "Song uploaded and submitted for approval.");
  loadMine();
});

const songCoverInput = $("#songCoverImage");
const songCoverPreview = $("#songCoverPreview");
if (songCoverInput && songCoverPreview) {
  songCoverInput.addEventListener("change", () => {
    const file = songCoverInput.files?.[0];
    if (!file) { songCoverPreview.removeAttribute("src"); songCoverPreview.hidden = true; return; }
    if (!file.type.startsWith("image/")) {
      toast("Please choose a JPG, PNG, or WEBP song cover.");
      songCoverInput.value = "";
      songCoverPreview.removeAttribute("src");
      songCoverPreview.hidden = true;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { songCoverPreview.src = reader.result; songCoverPreview.hidden = false; };
    reader.onerror = () => toast("The song cover could not be previewed.");
    reader.readAsDataURL(file);
  });
}

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
if (search) {
  let searchTimer;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadSongs(search.value), 250);
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      clearTimeout(searchTimer);
      loadSongs(search.value);
    }
  });
}

const loginOpen = $("#loginOpen");
if (loginOpen) loginOpen.addEventListener("click", () => {
  $('.tab[data-tab="login"]')?.click();
  $("#account")?.scrollIntoView({ behavior: "smooth", block: "center" });
});

const accountAvatarButton = $("#accountAvatarLink");
if (accountAvatarButton) {
  accountAvatarButton.addEventListener("click", () => {
    $("#account")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}


// Show a local preview as soon as an owner chooses a news photo.
const newsImageInput = $("#newsImage");
if (newsImageInput) {
  const newsPreview = document.createElement("img");
  newsPreview.alt = "Selected news photo preview";
  newsPreview.hidden = true;
  newsPreview.style.cssText = "display:block;max-width:100%;max-height:280px;object-fit:contain;margin-top:12px;border-radius:12px";
  newsImageInput.insertAdjacentElement("afterend", newsPreview);
  newsImageInput.addEventListener("change", () => {
    const selected = newsImageInput.files && newsImageInput.files[0];
    if (!selected) {
      newsPreview.removeAttribute("src");
      newsPreview.hidden = true;
      return;
    }
    if (!selected.type.startsWith("image/")) {
      toast("Please choose an image file.");
      newsImageInput.value = "";
      newsPreview.removeAttribute("src");
      newsPreview.hidden = true;
      return;
    }
    // Use FileReader for a phone-compatible local preview.
    // This avoids blob URL preview failures on some mobile browsers.
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        toast("Could not display this photo. Please choose another JPG, PNG, or WEBP image.");
        newsPreview.hidden = true;
        return;
      }
      newsPreview.src = reader.result;
      newsPreview.hidden = false;
    };
    reader.onerror = () => {
      toast("Could not read this photo. Please choose it again.");
      newsPreview.removeAttribute("src");
      newsPreview.hidden = true;
    };
    reader.readAsDataURL(selected);
  });
}

const profilePicturePicker = $("#profilePreview");
const profileImageInput = $("#profileImage");
const profileAvatarPreview = $("#profileAvatar");
const profilePlaceholder = $("#profilePlaceholder");

function showSelectedProfilePhoto(file) {
  if (!file || !profileAvatarPreview || !profilePlaceholder || !profilePicturePicker) return;
  if (!file.type || !file.type.startsWith("image/")) {
    toast("Please choose a JPG, PNG, or WEBP image.");
    profileImageInput.value = "";
    return;
  }

  // FileReader works reliably in mobile browsers and previews the photo
  // directly from the phone before any upload is attempted.
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result !== "string" || !reader.result) {
      toast("The photo could not be previewed. Please choose it again.");
      return;
    }
    profileAvatarPreview.src = reader.result;
    profileAvatarPreview.hidden = false;
    profilePlaceholder.hidden = true;
    profilePicturePicker.classList.add("has-image");
  };
  reader.onerror = () => toast("The photo could not be opened. Please choose another image.");
  reader.readAsDataURL(file);
}

if (profilePicturePicker && profileImageInput) {
  profilePicturePicker.addEventListener("click", () => profileImageInput.click());
  profileImageInput.addEventListener("change", () => {
    const file = profileImageInput.files && profileImageInput.files[0];
    showSelectedProfilePhoto(file);
  });
}
bindForm("#profileForm", async (form) => {
  if (!token) throw new Error("Please log in first.");
  const name = $("#profileName", form)?.value?.trim() || "";
  const bio = $("#profileBio", form)?.value?.trim() || "";
  // Read the profile picker by its unique ID so the selected phone photo
  // cannot be missed by a broad form selector.
  const file = $("#profileImage", form)?.files?.[0] || null;
  let avatar_url = currentUser?.avatar_url || null;
  if (file) {
    if (!file.type.startsWith("image/")) {
      throw new Error("Please choose a JPG, PNG, or WEBP image.");
    }
    const uploaded = await uploadImage("/api/profile/avatar", file);
    avatar_url = uploaded.avatar_url || uploaded.image_url || uploaded.url || "";
    if (!avatar_url) {
      throw new Error("The profile photo did not upload. Please try again.");
    }
  }
  const result = await api("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, bio, avatar_url })
  });
  // Keep the uploaded URL even if the profile response omits that field.
  // Apply the same saved URL to both profile and header images.
  const savedAvatarUrl =
    result.user?.avatar_url ||
    (typeof avatar_url === "string" ? avatar_url : "") ||
    currentUser?.avatar_url ||
    "";
  currentUser = {
    ...(currentUser || {}),
    ...(result.user || {}),
    ...(savedAvatarUrl ? { avatar_url: savedAvatarUrl } : {})
  };
  localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
  updateAccountUI();
  if (savedAvatarUrl) {
    const avatar = $("#profileAvatar");
    const navAvatar = $("#navAvatar");
    if (avatar) {
      avatar.src = savedAvatarUrl;
      avatar.hidden = false;
    }
    if (navAvatar) {
      navAvatar.src = savedAvatarUrl;
      navAvatar.hidden = false;
      navAvatar.style.display = "block";
    }
    if (profileAvatarPreview) {
      profileAvatarPreview.src = savedAvatarUrl;
      profileAvatarPreview.hidden = false;
    }
    if (profilePlaceholder) profilePlaceholder.hidden = true;
    profilePicturePicker?.classList.add("has-image");
    $("#accountAvatarLink")?.classList.remove("hidden");
  }
  const message = $("#profileMsg");
  if (message) message.textContent = result.message || "Artist profile updated successfully.";
  toast(result.message || "Artist profile updated successfully.");
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

  // News pictures are selected directly from the phone gallery.
  const file = $("#newsImage", form)?.files?.[0] || null;
  let image_url = "";

  if (file) {
    if (!file.type.startsWith("image/")) {
      throw new Error("Please choose a JPG, PNG, or WEBP news photo.");
    }
    const uploaded = await uploadImage("/api/admin/news/image", file);
    image_url = uploaded.image_url || uploaded.url || uploaded.publicUrl || "";
    if (!image_url) {
      throw new Error("The news photo did not upload. Please try again.");
    }
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

  const message = $("#newsMsg");
  if (message) {
    message.textContent = "News published successfully.";
  }

  toast("News published successfully.");

  await loadNews();
});
  
  

async function loadOwnerUsers() {
  const container = $("#ownerUsers");
  const summary = $("#ownerSummary");
  const searchInput = $("#ownerUserSearch");
  if (!container || !isOwner()) return;
  try {
    const [userResult, songResult] = await Promise.all([
      api("/api/owner/users"),
      api("/api/owner/songs")
    ]);
    const users = userResult.users || [];
    const songs = songResult.songs || [];
    const admins = users.filter((user) => user.role === "admin").length;
    if (summary) summary.textContent = `${users.length} registered accounts · ${admins} administrators · ${songs.length} songs`;

    const render = () => {
      const query = (searchInput?.value || "").trim().toLowerCase();
      const filtered = users.filter((user) =>
        [user.name, user.username, user.email, user.role].some((value) =>
          String(value || "").toLowerCase().includes(query)
        )
      );
      const userHTML = filtered.length ? filtered.map((user) => {
        const role = String(user.role || "artist").toLowerCase();
        const isProtectedOwner = role === "owner";
        return `
          <div class="admin-item">
            <strong>${escapeHTML(user.name || user.username || user.email || "User")}</strong>
            <span>${escapeHTML(user.email || "")}</span>
            <span>Role: ${escapeHTML(role)}</span>
            ${isProtectedOwner ? '<span>Owner account — protected</span>' : `
              <label>Registered artist name
                <input type="text" maxlength="100" value="${escapeHTML(user.name || "")}" data-user-name="${escapeHTML(user.id)}">
              </label>
              <button type="button" data-save-user-name="${escapeHTML(user.id)}">Save artist name</button>
              <select aria-label="Role for ${escapeHTML(user.email || user.id)}" data-user-role="${escapeHTML(user.id)}">
                <option value="artist" ${role === "artist" ? "selected" : ""}>Artist / standard account</option>
                <option value="admin" ${role === "admin" ? "selected" : ""}>Admin</option>
              </select>
              <button type="button" data-save-role="${escapeHTML(user.id)}">Save role</button>`}
          </div>`;
      }).join("") : "<p>No matching users found.</p>";

      const songHTML = songs.filter((song) =>
        [song.title, song.artist, song.status].some((value) => String(value || "").toLowerCase().includes(query))
      ).map((song) => `
        <div class="admin-item">
          <label>Song title
            <input type="text" maxlength="120" data-owner-song-title="${escapeHTML(song.id)}" value="${escapeHTML(song.title || "")}">
          </label>
          <label>Artist credit
            <input type="text" maxlength="120" data-owner-song-artist="${escapeHTML(song.id)}" value="${escapeHTML(song.artist || "")}">
          </label>
          <span>Status: ${escapeHTML(song.status || "unknown")}</span>
          <button type="button" data-save-owner-song="${escapeHTML(song.id)}">Save song changes</button>
        </div>`).join("") || "<p>No matching songs found.</p>";

      container.innerHTML = `
        <h4>Registered accounts — edit artist names and roles</h4>
        ${userHTML}
        <h4>Full song catalogue — edit any song</h4>
        ${songHTML}`;

      $$$("[data-save-role]", container).forEach((button) => {
        button.addEventListener("click", async () => {
          const id = button.dataset.saveRole;
          const select = container.querySelector(`[data-user-role="${CSS.escape(id)}"]`);
          if (!select) return;
          button.disabled = true;
          try {
            await api(`/api/owner/users/${encodeURIComponent(id)}/role`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role: select.value })
            });
            toast("User role updated.");
            await loadOwnerUsers();
          } catch (error) {
            toast(error.message);
            button.disabled = false;
          }
        });
      });
      $$$("[data-save-user-name]", container).forEach((button) => {
        button.addEventListener("click", async () => {
          const id = button.dataset.saveUserName;
          const input = container.querySelector(`[data-user-name="${CSS.escape(id)}"]`);
          if (!input) return;
          button.disabled = true;
          try {
            await api(`/api/owner/users/${encodeURIComponent(id)}/name`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: input.value })
            });
            toast("Artist profile name updated.");
            await loadOwnerUsers();
          } catch (error) {
            toast(error.message);
            button.disabled = false;
          }
        });
      });
      $$$("[data-save-owner-song]", container).forEach((button) => {
        button.addEventListener("click", async () => {
          const id = button.dataset.saveOwnerSong;
          const title = container.querySelector(`[data-owner-song-title="${CSS.escape(id)}"]`)?.value || "";
          const artist = container.querySelector(`[data-owner-song-artist="${CSS.escape(id)}"]`)?.value || "";
          button.disabled = true;
          try {
            await api(`/api/owner/songs/${encodeURIComponent(id)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title, artist })
            });
            toast("Song details updated.");
            await loadOwnerUsers();
            await loadSongs($("#search")?.value || "");
          } catch (error) {
            toast(error.message);
            button.disabled = false;
          }
        });
      });
    };
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.addEventListener("input", render);
      searchInput.dataset.bound = "true";
    }
    render();
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
    loadPendingNews(),
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

// Reliable header sign-in navigation: directly show the login form.
const headerSignInButton = $("#loginOpen");
if (headerSignInButton) {
  headerSignInButton.addEventListener("click", (event) => {
    event.preventDefault();
    const accountSection = $("#account");
    const registerForm = $("#registerForm");
    const loginForm = $("#loginForm");
    const userPanel = $("#userPanel");
    if (currentUser) {
      accountSection?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (registerForm) registerForm.hidden = true;
    if (loginForm) loginForm.hidden = false;
    if (registerForm) registerForm.classList.add("hidden");
    if (loginForm) loginForm.classList.remove("hidden");
    if (userPanel) userPanel.classList.add("hidden");
    $$(".tabs .tab").forEach((tab) => {
      const selected = tab.dataset.tab === "login";
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", selected ? "true" : "false");
    });
    accountSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
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
