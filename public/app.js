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
  // Remove the signed-in credentials and cached account profile immediately.
  token = "";
  currentUser = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);

  // Clear account-only form fields and visible personal account details.
  $$("#profileEditor input, #profileEditor textarea, #profileEditor select, #userPanel input, #userPanel textarea").forEach((field) => {
    if (field.type === "file") field.value = "";
    else if (field.type !== "checkbox" && field.type !== "radio") field.value = "";
  });
  updateAccountUI();
}

// Keep other open tabs on this device signed out too.
window.addEventListener("storage", (event) => {
  if (event.key === TOKEN_KEY && !event.newValue) {
    token = "";
    currentUser = null;
    localStorage.removeItem(USER_KEY);
    window.location.reload();
  }
});

function isAdmin() {
  const email = String(currentUser?.email || "").trim().toLowerCase();
  if (email === "payamusic361@gmail.com" && !isOwner()) return false;
  return ["admin", "superadmin", "owner"].includes(String(currentUser?.role || "").toLowerCase());
}

function isOwner() {
  return String(currentUser?.role || "").toLowerCase() === "owner";
}

function hasManagementAccess() {
  return String(currentUser?.role || "").toLowerCase() === "owner";
}

function updateAccountUI() {
  const userPanel = $("#userPanel");
  const profileEditor = $("#profileEditor");
  const welcome = $("#welcome");
  const accountRoleLabel = $("#accountRoleLabel");
  const adminPanel = $("#adminPanel");
  const ownerPanel = $("#ownerPanel");
  const loginOpen = $("#loginOpen");
  const headerLogout = $("#headerLogout");
  const account = $("#account");
  const tabs = $(".tabs", account || document);
  const registerForm = $("#registerForm");
  const loginForm = $("#loginForm");
  const registrationOnly = new URLSearchParams(window.location.search).get("artist-register") === "1";
  const registrationSessionNotice = $("#registrationSessionNotice");
  if (registrationSessionNotice) {
    if (registrationOnly && currentUser) {
      const signedInName = currentUser.name || currentUser.username || currentUser.email || "your account";
      const signedInRole = String(currentUser.role || "user").toLowerCase();
      const roleName = signedInRole === "owner" ? "Owner" : signedInRole === "admin" ? "Admin" : "Artist account";
      registrationSessionNotice.textContent = `You are already signed in as ${signedInName} (${roleName}). This is the shared artist-registration page; your account is still signed in. Sign out before testing a new artist registration.`;
      registrationSessionNotice.hidden = false;
    } else {
      registrationSessionNotice.textContent = "";
      registrationSessionNotice.hidden = true;
    }
  }

  // A shareable artist-registration view that never exposes the signed-in
  // owner's profile/dashboard and does not replace the owner's local session.
  document.body.classList.toggle("artist-registration-only", registrationOnly);
  document.body.classList.toggle("signed-in", !!currentUser);
  if (account) account.hidden = false;
  if (userPanel) userPanel.classList.toggle("hidden", registrationOnly || !currentUser);
  if (profileEditor) profileEditor.classList.toggle("hidden", registrationOnly || !currentUser);
  const activeAccountMode = $(".tabs .tab.active", account || document)?.dataset.tab || "register";
  if (tabs) tabs.hidden = !!currentUser;
  if (registerForm) registerForm.classList.toggle("hidden", !!currentUser || activeAccountMode !== "register");
  if (loginForm) loginForm.classList.toggle("hidden", !!currentUser || activeAccountMode !== "login");
  if (welcome) welcome.textContent = currentUser
    ? `Welcome, ${currentUser.name || currentUser.username || currentUser.email || "User"}`
    : "";
  if (accountRoleLabel) accountRoleLabel.textContent = currentUser ? `Account type: ${String(currentUser.account_type || "unclassified").replace("_", " + ")} · Access role: ${currentUser.role || "user"}` : "";
  if (adminPanel) adminPanel.classList.toggle("hidden", !isAdmin());
  if (ownerPanel) {
    const ownerAccess = hasManagementAccess();
    const paymentAccess = String(currentUser?.email || "").trim().toLowerCase() === "payamusic361@gmail.com";
    const panelAccess = ownerAccess || paymentAccess;
    ownerPanel.classList.toggle("hidden", !panelAccess);
    ownerPanel.setAttribute("aria-hidden", panelAccess ? "false" : "true");
    ["ownerSummary", "ownerStats", "ownerUserSearch", "ownerUsers"].forEach((id) => {
      const element = document.getElementById(id);
      if (element) element.classList.toggle("hidden", !panelAccess);
    });
    if (ownerPanel.querySelector("h3")) {
      ownerPanel.querySelector("h3").textContent = "Paya Music UG Management";
    }
    const intro = ownerPanel.querySelector(":scope > .muted");
    if (intro) intro.textContent = ownerAccess
      ? "Manage platform operations, payment settings, revenue requests, artists and songs. Only the Owner can change account roles or ownership permissions."
      : "Manage Paya Music UG payment methods and revenue requests. Ownership, users, roles and platform security remain under the Owner's control.";
  }
  const newsSubmission = $("#newsSubmission");
  if (newsSubmission) newsSubmission.classList.toggle("hidden", !currentUser);
  if (loginOpen) loginOpen.hidden = !!currentUser;
  if (headerLogout) headerLogout.classList.toggle("hidden", !currentUser);

  const roleLabel = $("#userRole");
  if (roleLabel && currentUser) roleLabel.textContent = currentUser.role || "user";

  const uploadForm = $("#uploadForm");
  const uploadNotice = $("#uploadAccessNotice");
  const accountType = String(currentUser?.account_type || "unclassified");
  const canUpload = ["artist", "dj", "artist_dj"].includes(accountType) || isAdmin();
  if (uploadForm) uploadForm.classList.toggle("hidden", !!currentUser && !canUpload);
  if (uploadNotice) {
    uploadNotice.hidden = !(currentUser && !canUpload);
    uploadNotice.textContent = currentUser && !canUpload
      ? "Your Listener account is for discovering and listening to music. To upload music, ask Paya Music UG Management to update your account type."
      : "";
  }

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

  // Once an artist has saved profile details, show a clean public-style
  // profile card. Keep the editor hidden until the artist chooses to edit.
  const profileDisplay = $("#profileDisplay");
  const profileForm = $("#profileForm");
  const profilePicker = $("#profilePreview");
  const displayAvatar = $("#profileDisplayAvatar");
  const displayName = $("#profileDisplayName");
  const displayBio = $("#profileDisplayBio");
  const hasSavedProfile = !!(currentUser && (
    String(currentUser.bio || "").trim() || currentUser.avatar_url
  ));
  if (profileDisplay) profileDisplay.hidden = !hasSavedProfile;
  if (profileForm) profileForm.classList.toggle("hidden", hasSavedProfile);
  if (profilePicker) profilePicker.classList.toggle("hidden", hasSavedProfile);
  if (displayName) displayName.textContent = currentUser?.name || currentUser?.username || "Artist";
  if (displayBio) displayBio.textContent = currentUser?.bio || "";
  if (displayAvatar) {
    displayAvatar.src = currentUser?.avatar_url || "";
    displayAvatar.hidden = !currentUser?.avatar_url;
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

// Split featured credits so a collaboration appears in every credited artist's catalogue.
function artistNames(credit) {
  const names = String(credit || "Unknown artist")
    .split(/\s+(?:ft\.?|feat\.?|featuring)\s+|\s*[&,+]\s*|\s+x\s+/i)
    .map((name) => name.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  return [...new Set(names.length ? names : ["Unknown artist"])];
}

let catalogueSongs = [];
function renderMusicHome(items = []) {
  const artistMap = new Map();
  items.forEach((song) => artistNames(songArtist(song)).forEach((name) => {
    const key = name.toLocaleLowerCase();
    if (!artistMap.has(key)) artistMap.set(key, { name, songs: [], latest: song.created_at || "" });
    const artist = artistMap.get(key);
    artist.songs.push(song);
    if (new Date(song.created_at || 0) > new Date(artist.latest || 0)) artist.latest = song.created_at || "";
  }));
  const artists = [...artistMap.values()];
  const top = [...artists].sort((a,b) => b.songs.length-a.songs.length || a.name.localeCompare(b.name));
  const newest = [...artists].sort((a,b) => new Date(b.latest || 0)-new Date(a.latest || 0));
  const artistCard = (artist) => {
    const cover = artist.songs.find(song => song.cover_url)?.cover_url || DEFAULT_SONG_COVER;
    return `<button class="artist-tile" type="button" data-open-artist="${escapeHTML(artist.name)}">
      <img src="${escapeHTML(cover)}" alt="" loading="lazy">
      <span>${escapeHTML(artist.name)}</span>
      <small>${artist.songs.length} ${artist.songs.length === 1 ? "song" : "songs"}</small>
    </button>`;
  };
  const topEl = $("#topArtistsList");
  const newEl = $("#newArtistsList");
  if (topEl) topEl.innerHTML = top.length ? top.slice(0,12).map(artistCard).join("") : '<p class="muted">Artist profiles will appear here as music is published.</p>';
  if (newEl) newEl.innerHTML = newest.length ? newest.slice(0,12).map(artistCard).join("") : '<p class="muted">New artists will appear here.</p>';
  const trendingEl = $("#trendingSongsList");
  if (trendingEl) {
    const trending = [...items].sort((a,b) => Number(b.play_count||0)-Number(a.play_count||0) || Number(b.download_count||0)-Number(a.download_count||0) || Number(b.likes||0)-Number(a.likes||0) || new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,10);
    trendingEl.innerHTML = trending.length ? trending.map((song,index) => `
      <article class="trending-row">
        <span class="trend-number">${index+1}</span>
        <button type="button" class="trend-play" data-home-play="${escapeHTML(songId(song))}" aria-label="Play ${escapeHTML(songTitle(song))}">▶</button>
        <img src="${escapeHTML(song.cover_url || DEFAULT_SONG_COVER)}" alt="" loading="lazy">
        <div class="trend-song-name">
          <button type="button" class="trend-title-button" data-expand-song="${escapeHTML(songId(song))}"><strong>${escapeHTML(songTitle(song))}</strong></button>
          <button type="button" class="trend-artist-button" data-open-artist="${escapeHTML(artistNames(songArtist(song))[0])}">${escapeHTML(songArtist(song))}</button>
        </div>
        <span class="trend-count">${Number(song.play_count||0)} plays</span>
      </article>`).join("") : '<p class="muted">New releases will appear here.</p>';
  }
  document.querySelectorAll("[data-open-artist]").forEach(button => {
    button.addEventListener("click", () => {
      const name = button.dataset.openArtist;
      const input = $("#search");
      if (input) input.value = name;
      // Filter the complete catalogue by every credited artist, including featured artists.
      const matches = catalogueSongs.filter(song =>
        artistNames(songArtist(song)).some(artist => artist.toLocaleLowerCase() === name.toLocaleLowerCase())
      );
      if (matches.length) {
        renderSongs(matches);
        const heading = $("#discover h2, #discover h3");
        if (heading) heading.textContent = `${name} — Songs`;
      } else {
        loadSongs(name);
      }
      $("#discover")?.scrollIntoView({behavior:"smooth",block:"start"});
    });
  });
  document.querySelectorAll("[data-expand-song]").forEach(button => {
    button.addEventListener("click", () => {
      const song = items.find(item => String(songId(item)) === button.dataset.expandSong);
      if (!song) return;
      const row = button.closest(".trending-row");
      const existing = row?.nextElementSibling;
      if (existing?.classList.contains("expanded-song-panel")) {
        existing.remove();
        return;
      }
      document.querySelectorAll(".expanded-song-panel").forEach(panel => panel.remove());
      const cover = song.cover_url || song.image_url || song.artwork_url || DEFAULT_SONG_COVER;
      const title = escapeHTML(songTitle(song));
      const artist = escapeHTML(songArtist(song));
      const description = song.description ? escapeHTML(song.description) : "Listen to this release on Paya Music UG.";
      const likes = Number(song.likes ?? song.like_count ?? 0);
      const panel = document.createElement("section");
      panel.className = "expanded-song-panel";
      panel.innerHTML = `
        <button type="button" class="expanded-song-close" aria-label="Close song details">×</button>
        <div class="expanded-song-main">
          <img class="expanded-song-cover" src="${escapeHTML(cover)}" alt="${title} cover">
          <div class="expanded-song-meta">
            <span class="expanded-song-kicker">NOW ON PAYA MUSIC UG</span>
            <h3>${title}</h3>
            <button type="button" class="expanded-song-artist" data-open-artist="${escapeHTML(artistNames(songArtist(song))[0])}">${artist}</button>
            <p>${description}</p>
            <div class="expanded-song-actions">
              <button type="button" class="expanded-song-play">▶ Play song</button>
              <a href="/api/songs/${encodeURIComponent(songId(song))}/download">↓ Download song</a>
              <span>${likes} likes</span>
            </div>
          </div>
        </div>`;
      row?.insertAdjacentElement("afterend", panel);
      panel.querySelector(".expanded-song-close")?.addEventListener("click", () => panel.remove());
      panel.querySelector(".expanded-song-play")?.addEventListener("click", () => playSong(song));
      panel.querySelector("[data-open-artist]")?.addEventListener("click", () => {
        const name = panel.querySelector("[data-open-artist]").dataset.openArtist;
        const matches = catalogueSongs.filter(item => artistNames(songArtist(item)).some(n => n.toLocaleLowerCase() === name.toLocaleLowerCase()));
        renderSongs(matches);
        const heading = $("#discover h2, #discover h3");
        if (heading) heading.textContent = `${name} — Songs`;
        $("#discover")?.scrollIntoView({behavior:"smooth",block:"start"});
      });
      panel.scrollIntoView({behavior:"smooth",block:"nearest"});
    });
  });
  document.querySelectorAll("[data-home-play]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const song = items.find(item => String(songId(item)) === button.dataset.homePlay);
      if (song) {
        playSong(song);
        button.setAttribute("aria-label", `Playing ${songTitle(song)}`);
      }
    });
  });
}

function songAudioUrl(song) {
  return song.audio_url || song.file_url || song.url || "";
}

function renderSearchArtistProfiles(items = [], query = "") {
  const discover = $("#discover");
  const songsContainer = $("#songs");
  if (!discover || !songsContainer) return;
  let section = $("#artistSearchProfiles");
  if (!section) {
    section = document.createElement("section");
    section.id = "artistSearchProfiles";
    section.className = "artist-search-profiles";
    discover.insertBefore(section, songsContainer);
  }
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery || !items.length) {
    section.innerHTML = "";
    section.hidden = true;
    return;
  }
  const groups = new Map();
  items.forEach((song) => artistNames(songArtist(song)).forEach((name) => {
    const key = name.toLocaleLowerCase();
    if (!groups.has(key)) groups.set(key, { name, songs: [], profile: song.artist_profile || null, sample: song });
    const group = groups.get(key);
    group.songs.push(song);
    if (!group.profile && song.artist_profile) group.profile = song.artist_profile;
  }));
  const cards = [...groups.values()].map((artist) => {
    const profile = artist.profile || {};
    const sample = artist.sample || {};
    const avatar = profile.avatar_url || sample.cover_url || DEFAULT_SONG_COVER;
    const name = profile.name || artist.name;
    const bio = profile.bio || sample.description || "Discover songs and releases by this artist on Paya Music UG.";
    const details = [sample.country, sample.genre].filter(Boolean).map(escapeHTML).join(" · ");
    return `<article class="search-artist-card">
      <img class="search-artist-avatar" src="${escapeHTML(avatar)}" alt="${escapeHTML(name)} profile picture">
      <div class="search-artist-info">
        <p class="eyebrow">ARTIST PROFILE</p>
        <h3><a class="artist-profile-link" href="${profile.id ? "/artist/" + encodeURIComponent(profile.id) : "#"}">${escapeHTML(name)}</a></h3>
        ${details ? `<p class="search-artist-details">${details}</p>` : ""}
        <p class="search-artist-bio">${escapeHTML(bio)}</p>
        <small>${artist.songs.length} matching ${artist.songs.length === 1 ? "song" : "songs"}</small>
        ${profile.id ? `<a class="artist-profile-open" href="/artist/${encodeURIComponent(profile.id)}">Open artist profile →</a>` : ""}
      </div>
    </article>`;
  });
  section.innerHTML = `<div class="search-results-heading"><span class="eyebrow">YOUR SEARCH RESULTS</span><strong>${escapeHTML(cleanQuery)}</strong></div>${cards.join("")}`;
  section.hidden = false;
}

function renderSongs(items = []) {
  const container = $("#songs");
  if (!container) return;

  if (!items.length) {
    container.innerHTML = '<p class="empty-state">No songs found yet.</p>';
    return;
  }

  const grouped = new Map();
  for (const song of items) {
    for (const artistName of artistNames(songArtist(song))) {
      if (!grouped.has(artistName)) grouped.set(artistName, []);
      grouped.get(artistName).push(song);
    }
  }

  container.innerHTML = [...grouped.entries()].map(([artistName, artistSongs]) => `
    <section class="artist-song-group" id="artist-${encodeURIComponent(artistName).replace(/%/g, "-")}">
      <div class="artist-song-group-heading">
        <h3>${escapeHTML(artistName)}</h3>
        <span>${artistSongs.length} ${artistSongs.length === 1 ? "song" : "songs"}</span>
      </div>
      <div class="artist-song-group-grid">${artistSongs.map((song) => {
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
          <p>${song.artist_profile?.id ? `<a class="artist-profile-link" href="/artist/${encodeURIComponent(song.artist_profile.id)}">${artist}</a>` : artist}</p>
          <small class="song-stat-line"><button type="button" class="song-like-inline" data-like="${id}" aria-pressed="${savedLikes().includes(String(songId(song)))}">${savedLikes().includes(String(songId(song))) ? "♥ Liked" : "♡ Like"}</button><span data-like-count>${likes} likes</span><span>${plays} plays</span><span>${downloads} downloads</span></small>
        </div>
        <div class="song-actions">
          <button type="button" data-play="${id}">Play</button>
          <button type="button" data-share="${id}">Share</button>
          <a href="/api/songs/${encodeURIComponent(songId(song))}/download">Download</a>
          ${isAdmin() ? `<button type="button" data-edit-public-song="${id}">Edit</button>` : ""}
          ${isAdmin() ? `<button type="button" data-change-artwork="${id}">Change artwork</button>` : ""}
          ${isAdmin() ? `<button type="button" class="delete-song-btn" data-delete-song="${id}">Delete</button>` : ""}
        </div>
      </article>`;
  }).join("")}</div></section>`).join("");

  container.querySelectorAll("[data-edit-public-song]").forEach((button) => {
    button.addEventListener("click", async () => {
      const song = items.find((item) => String(songId(item)) === button.dataset.editPublicSong);
      if (!song) return;
      const title = window.prompt("Song title:", songTitle(song));
      if (title === null) return;
      const artist = window.prompt("Artist name:", songArtist(song));
      if (artist === null) return;
      const country = window.prompt("Artist's country:", song.country || "");
      if (country === null) return;
      button.disabled = true;
      try {
        const ownerEditing = hasManagementAccess();
        await api(ownerEditing
          ? `/api/owner/songs/${encodeURIComponent(songId(song))}`
          : `/api/my-songs/${encodeURIComponent(songId(song))}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, artist, country, genre: song.genre || "", description: song.description || "" })
        });
        toast("Song details updated.");
        await Promise.all([loadSongs($("#search")?.value || ""), loadMine()]);
      } catch (error) {
        toast(error.message || "Could not update song.");
        button.disabled = false;
      }
    });
  });

  container.querySelectorAll("[data-change-artwork]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!isAdmin()) return toast("Admin access required.");
      const songIdToUpdate = button.dataset.changeArtwork;
      const picker = document.createElement("input");
      picker.type = "file";
      picker.accept = "image/jpeg,image/png,image/webp";
      picker.addEventListener("change", async () => {
        const file = picker.files?.[0];
        if (!file) return;
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return toast("Choose a JPG, PNG, or WEBP image.");
        if (file.size > 5 * 1024 * 1024) return toast("Artwork must be no larger than 5 MB.");
        const formData = new FormData();
        formData.append("cover_image", file);
        button.disabled = true;
        try {
          await api("/api/admin/songs/" + encodeURIComponent(songIdToUpdate) + "/artwork", { method: "PATCH", body: formData });
          toast("Song artwork updated successfully.");
          await loadSongs($("#search")?.value || "");
          await loadMine();
        } catch (error) {
          toast(error.message || "Could not update song artwork.");
          button.disabled = false;
        }
      });
      picker.click();
    });
  });
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
    const country = $("#countryFilter")?.value || "";
    const result = await api(`/api/songs?q=${encodeURIComponent(query)}&sort=${encodeURIComponent(sort)}&country=${encodeURIComponent(country)}`);
    catalogueSongs = result.songs || [];
    renderMusicHome(catalogueSongs);
    renderSearchArtistProfiles(catalogueSongs, query);
    renderSongs(catalogueSongs);
    if (String(query || "").trim()) {
      requestAnimationFrame(() => {
        const target = $("#artistSearchProfiles") && !$("#artistSearchProfiles").hidden
          ? $("#artistSearchProfiles")
          : $("#songs");
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
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
      const href = ad.target_url || ad.link_url || ad.url || "#";
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
          ${isAdmin() ? `<button type="button" data-edit-own-song="${escapeHTML(songId(song))}">Edit song details</button>` : ""}
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

    $$("[data-song-approve]", container).forEach((button) =>
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

    $$("[data-ad-approve]", container).forEach((button) =>
      button.addEventListener("click", () => moderateAd(button.dataset.adApprove, "approved")));
    $$("[data-ad-reject]", container).forEach((button) =>
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
    $$("[data-profile-approve]", container).forEach((button) => button.addEventListener("click", () => moderateProfile(button.dataset.profileApprove, "approved")));
    $$("[data-profile-reject]", container).forEach((button) => button.addEventListener("click", () => moderateProfile(button.dataset.profileReject, "rejected")));
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
    $$("[data-news-approve]", container).forEach((button) => button.addEventListener("click", () => moderateNews(button.dataset.newsApprove, "published")));
    $$("[data-news-reject]", container).forEach((button) => button.addEventListener("click", () => moderateNews(button.dataset.newsReject, "rejected")));
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
      <article class="news-story" id="news-${escapeHTML(item.id)}">
        <div class="news-story-copy">
          <span class="news-category">${escapeHTML(String(item.category || "music").replace(/[-_]/g, " ").toUpperCase())}</span>
          <h3>${escapeHTML(item.title || "")}</h3>
          <small class="news-byline">Story by Paya Music UG${item.published_at ? ` · ${escapeHTML(new Date(item.published_at).toLocaleDateString())}` : ""}</small>
          <button type="button" class="news-share-btn" data-news-share="${escapeHTML(item.id)}" data-news-title="${escapeHTML(item.title || "")}">↗ Share news</button>
          ${isAdmin() ? `<button type="button" class="news-edit-btn" data-edit-news="${escapeHTML(item.id)}">Edit news</button>` : ""}
        </div>
        ${item.image_url ? `<img class="news-story-image" src="${escapeHTML(item.image_url)}" alt="${escapeHTML(item.title || "News")}" loading="lazy">` : ""}
        <details class="news-story-details">
          <summary>Read full story</summary>
          <div class="news-body">${formatNewsText(item.content || item.body || "")}</div>
          <section class="news-discussion" data-news-comments="${escapeHTML(item.id)}">
            <h3>💬 Join the Discussion</h3>
            <div class="news-comment-list"><p>Loading comments…</p></div>
            <form class="news-comment-form">
              <h4>Leave a reply</h4>
              <input name="name" maxlength="15" required placeholder="Your Name (max 15 chars)">
              <textarea name="body" maxlength="1500" required placeholder="Write your thoughts…"></textarea>
              <input type="hidden" name="parent_id" value="">
              <button type="submit">Post comment</button>
              <button type="button" class="comment-cancel-reply" hidden>Cancel reply</button>
            </form>
          </section>
        </details>
      </article>`).join("") : "<p>No news posted yet.</p>";
    container.querySelectorAll("[data-edit-news]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!isAdmin()) return toast("Admin access required.");
        const item = news.find((entry) => String(entry.id) === button.dataset.editNews);
        if (!item) return;
        const title = window.prompt("News title:", item.title || "");
        if (title === null) return;
        const content = window.prompt("News story:", item.content || item.body || "");
        if (content === null) return;
        const category = window.prompt("News category:", item.category || "music");
        if (category === null) return;
        if (!title.trim() || !content.trim()) return toast("Title and story cannot be empty.");
        button.disabled = true;
        try {
          await api("/api/admin/news/" + encodeURIComponent(item.id), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: title.trim(), content: content.trim(), category: category.trim() || "music" })
          });
          toast("News article updated.");
          await loadNews();
        } catch (error) {
          toast(error.message || "Could not update news article.");
          button.disabled = false;
        }
      });
    });
    await Promise.all(news.map((item) => loadNewsComments(item.id)));
    // Open a shared story when its hash is present.
    const sharedNewsId = new URLSearchParams(window.location.search).get("news");
    if (sharedNewsId) {
      const sharedArticle = document.getElementById("news-" + sharedNewsId);
      if (sharedArticle) {
        const details = sharedArticle.querySelector(".news-story-details");
        if (details) details.open = true;
        sharedArticle.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else {
      const sharedHashId = window.location.hash.match(/^#news-(.+)$/)?.[1];
      if (sharedHashId) document.getElementById("news-" + decodeURIComponent(sharedHashId))?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (error) {
    container.innerHTML = `<p>${escapeHTML(error.message)}</p>`;
  }
}


document.addEventListener("click", async (event) => {
  const shareButton = event.target.closest("[data-news-share]");
  if (!shareButton) return;
  const newsId = shareButton.dataset.newsShare;
  const title = shareButton.dataset.newsTitle || "Paya Music UG News";
  const url = new URL("/news/" + encodeURIComponent(newsId), window.location.origin).href;
  try {
    if (navigator.share) {
      await navigator.share({ title, text: "Read this story on Paya Music UG", url });
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      toast("News link copied. Share it with your friends.");
    } else {
      window.prompt("Copy this news link:", url);
    }
  } catch (error) {
    if (error.name !== "AbortError") toast("Could not share this news story.");
  }
});

async function loadNewsComments(newsId) {
  const section = document.querySelector('[data-news-comments="' + CSS.escape(String(newsId)) + '"]');
  if (!section) return;
  const list = section.querySelector(".news-comment-list");
  try {
    const result = await api("/api/news/" + encodeURIComponent(newsId) + "/comments");
    const comments = result.comments || [];
    const roots = comments.filter((item) => !item.parent_id);
    function renderComment(item, nested) {
      const replies = comments.filter((reply) => String(reply.parent_id) === String(item.id));
      return '<article class="news-comment' + (nested ? ' is-reply' : '') + '">' +
        '<div class="news-comment-author">' + escapeHTML(item.name) + '</div>' +
        '<p>' + escapeHTML(item.body) + '</p>' +
        '<small>' + (item.created_at ? escapeHTML(new Date(item.created_at).toLocaleString()) : '') + '</small>' +
        '<div class="news-comment-actions">' +
        '<button type="button" data-comment-reaction="like" data-comment-id="' + item.id + '">❤️ ' + Number(item.likes || 0) + '</button>' +
        '<button type="button" data-comment-reaction="dislike" data-comment-id="' + item.id + '">👎 ' + Number(item.dislikes || 0) + '</button>' +
        '<button type="button" data-comment-reply="' + item.id + '">↩ Reply</button>' +
        (isAdmin() ? '<button type="button" data-comment-delete="' + item.id + '">Delete</button>' : '') +
        '</div>' + replies.map((reply) => renderComment(reply, true)).join('') + '</article>';
    }
    list.innerHTML = roots.length ? roots.map((item) => renderComment(item, false)).join('') : '<p>No comments yet. Start the discussion.</p>';
  } catch (error) {
    list.innerHTML = '<p>Comments are temporarily unavailable.</p>';
  }
  const form = section.querySelector(".news-comment-form");
  if (form && !form.dataset.bound) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await api("/api/news/" + encodeURIComponent(newsId) + "/comments", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: data.get("name"), body: data.get("body"), parent_id: data.get("parent_id") || null })
        });
        const savedName = data.get("name");
        form.reset();
        form.elements.name.value = savedName;
        form.elements.parent_id.value = "";
        form.querySelector(".comment-cancel-reply").hidden = true;
        form.querySelector("h4").textContent = "Leave a reply";
        await loadNewsComments(newsId);
        toast("Comment posted.");
      } catch (error) { toast(error.message); }
      finally { submit.disabled = false; }
    });
    form.querySelector(".comment-cancel-reply").addEventListener("click", () => {
      form.elements.parent_id.value = "";
      form.querySelector("h4").textContent = "Leave a reply";
      form.querySelector(".comment-cancel-reply").hidden = true;
    });
    form.dataset.bound = "true";
  }
}

document.addEventListener("click", async (event) => {
  const reply = event.target.closest("[data-comment-reply]");
  if (reply) {
    const section = reply.closest(".news-discussion");
    const form = section && section.querySelector(".news-comment-form");
    if (form) {
      form.elements.parent_id.value = reply.dataset.commentReply;
      form.querySelector("h4").textContent = "Reply to comment";
      form.querySelector(".comment-cancel-reply").hidden = false;
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      form.elements.body.focus();
    }
    return;
  }
  const reaction = event.target.closest("[data-comment-reaction]");
  if (reaction) {
    const section = reaction.closest(".news-discussion");
    let visitorKey = localStorage.getItem("paya_comment_visitor");
    if (!visitorKey) {
      visitorKey = "visitor-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      localStorage.setItem("paya_comment_visitor", visitorKey);
    }
    try {
      await api("/api/news/comments/" + encodeURIComponent(reaction.dataset.commentId) + "/reaction", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reaction: reaction.dataset.commentReaction, visitor_key: visitorKey })
      });
      await loadNewsComments(section.dataset.newsComments);
    } catch (error) { toast(error.message); }
    return;
  }
  const remove = event.target.closest("[data-comment-delete]");
  if (remove && isAdmin() && window.confirm("Delete this comment and its replies?")) {
    const section = remove.closest(".news-discussion");
    try {
      await api("/api/admin/news/comments/" + encodeURIComponent(remove.dataset.commentDelete), { method: "DELETE" });
      await loadNewsComments(section.dataset.newsComments);
      toast("Comment deleted.");
    } catch (error) { toast(error.message); }
  }
});

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


document.querySelectorAll("[data-password-toggle]").forEach((button) => button.addEventListener("click", () => {
 const input=button.parentElement.querySelector("input");
 input.type=input.type==="password"?"text":"password";
 button.textContent=input.type==="password"?"Show":"Hide";
}));
const recoveryForm=$("#forgotPasswordForm");
$("#forgotPasswordOpen")?.addEventListener("click",()=>{$("#loginForm")?.classList.add("hidden");recoveryForm?.classList.remove("hidden");});
$("#backToLogin")?.addEventListener("click",()=>{recoveryForm?.classList.add("hidden");$("#loginForm")?.classList.remove("hidden");});
bindForm("#forgotPasswordForm",async(form)=>{
 const result=await api("/api/password/forgot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(form).entries()))});
 $("#forgotPasswordMsg").textContent=result.message||"If the email is registered, a recovery link will be sent.";
});
// Live previews for profile and cover images during account registration.
function previewRegistrationImage(inputId, targetId, mode) {
  const input = document.getElementById(inputId);
  const target = document.getElementById(targetId);
  if (!input || !target) return;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      input.value = "";
      toast("Choose a JPG, PNG or WEBP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      input.value = "";
      toast("Images must be 5 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (mode === "cover") {
        target.style.backgroundImage = `url("${reader.result}")`;
        const hint = target.querySelector(".register-cover-hint");
        if (hint) hint.style.display = "none";
      } else {
        target.innerHTML = "";
        const img = document.createElement("img");
        img.src = reader.result;
        img.alt = "Selected profile picture preview";
        target.appendChild(img);
      }
    };
    reader.readAsDataURL(file);
  });
}
previewRegistrationImage("registerAvatar", "registerAvatarPreview", "avatar");
previewRegistrationImage("registerCover", "registerCoverPreview", "cover");

bindForm("#registerForm", async (form) => {
  const profilePhoto = $("#registerAvatar")?.files?.[0] || null;
  const coverPhoto = $("#registerCover")?.files?.[0] || null;
  const data = Object.fromEntries(new FormData(form).entries());
  const registrationOnly = new URLSearchParams(window.location.search).get("artist-register") === "1";
  if (registrationOnly) data.account_type = "artist";
  const result = await api("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  // Registration returns a short-lived session token. Use it to upload an
  // optional profile photo and save its public URL to the new account.
  let registeredUser = result.user || result;
  let profilePhotoWarning = "";
  if (profilePhoto || coverPhoto) {
    try {
      const profileUpdates = {
        name: registeredUser.name || data.name,
        bio: registeredUser.bio || ""
      };
      for (const [file, endpoint, field] of [
        [profilePhoto, "/api/profile/avatar", "avatar_url"],
        [coverPhoto, "/api/profile/cover", "cover_url"]
      ]) {
        if (!file) continue;
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          throw new Error("Choose JPG, PNG or WEBP images.");
        }
        if (file.size > 5 * 1024 * 1024) {
          throw new Error("Profile and cover images must be 5 MB or smaller.");
        }
        const fd = new FormData();
        fd.append("image", file);
        const uploaded = await api(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${result.token}` },
          body: fd
        });
        profileUpdates[field] = uploaded[field];
      }
      const saved = await api("/api/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${result.token}`
        },
        body: JSON.stringify(profileUpdates)
      });
      registeredUser = saved.user || { ...registeredUser, ...profileUpdates };
    } catch (photoError) {
      profilePhotoWarning = ` Your account was created, but an image could not be saved: ${photoError.message}`;
    }
  }

  form.reset();
  if (registrationOnly) {
    const claimed = Number(result.claimed_songs || 0);
    const message = claimed
      ? `Artist account created. ${claimed} matching song(s) have been added to the artist account. The artist can now sign in.`
      : "Artist account created successfully. The artist can now sign in.";
    const accountMsg = $("#accountMsg");
    if (accountMsg) accountMsg.textContent = message + profilePhotoWarning;
    // Keep the artist on the registration page, but switch to sign-in after registration.
    const loginTab = $('.tab[data-tab="login"]');
    if (loginTab) loginTab.click();
    toast("Artist account created successfully. Please sign in.");
    return;
  }
  saveSession(registeredUser, result.token);
  toast(profilePhotoWarning ? "Account created. " + profilePhotoWarning : "Account created successfully.");
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
    // Leave the registration-only URL after authentication so the real account dashboard is shown.
    if (new URLSearchParams(window.location.search).get("artist-register") === "1") {
      window.location.replace("/");
      return;
    }
    await refreshDashboard();
  } catch (error) {
    if (status) status.textContent = error.message || "Sign in failed. Please try again.";
    throw error;
  } finally {
    if (submit) { submit.disabled = false; if (submit.tagName === "BUTTON") submit.textContent = originalLabel; else submit.value = originalLabel; }
  }
});

const headerLogoutButton = $("#headerLogout");
if (headerLogoutButton) headerLogoutButton.addEventListener("click", () => $("#logout")?.click());

const logout = $("#logout");
if (logout) logout.addEventListener("click", () => {
  clearSession();
  // Reload immediately so private account panels and cached page content disappear.
  window.location.replace("/");
});

bindForm("#uploadForm", async (form) => {
  if (!token) throw new Error("Please log in before uploading.");
  const formData = new FormData(form);
  await api("/api/songs", { method: "POST", body: formData });
  form.reset();
  const preview = $("#songCoverPreview");
  if (preview) { preview.removeAttribute("src"); preview.hidden = true; }
  const message = $("#uploadMsg");
  if (message) message.textContent = "Song uploaded and published successfully.";
  toast("Song uploaded and published.");
  await loadSongs($("#search")?.value || "");
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
  const formData = Object.fromEntries(new FormData(form).entries());
  await api("/api/ads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formData)
  });
  form.reset();
  const message = $("#adMsg");
  if (message) message.textContent = "Advert published successfully.";
  toast("Advert published successfully.");
  loadAds();
});

const search = $("#search");
const searchBtn = $("#searchBtn");
if (searchBtn) searchBtn.addEventListener("click", () => loadSongs(search?.value || ""));
const countryFilter = $("#countryFilter");
if (countryFilter) countryFilter.addEventListener("change", () => loadSongs(search?.value || ""));
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
    // Reveal the profile editor while keeping registration and sign-in hidden.
    const accountSection = $("#account");
    const profileEditor = $("#profileEditor");
    if (!accountSection || !profileEditor) return;
    accountSection.classList.add("show-profile-editor");
    accountSection.scrollIntoView({ behavior: "smooth", block: "start" });
    profileEditor.scrollIntoView({ behavior: "smooth", block: "center" });
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
// Let an artist reopen the editor without losing their saved profile.
document.addEventListener("click", (event) => {
  if (!event.target.closest("#editArtistProfile")) return;
  $("#profileDisplay")?.setAttribute("hidden", "");
  $("#profileForm")?.classList.remove("hidden");
  $("#profilePreview")?.classList.remove("hidden");
  $("#profileForm")?.scrollIntoView({ behavior: "smooth", block: "center" });
});

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
  if (!token) throw new Error("Please register or sign in before submitting news.");
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
    const uploaded = await uploadImage("/api/news/image", file);
    image_url = uploaded.image_url || uploaded.url || uploaded.publicUrl || "";
    if (!image_url) {
      throw new Error("The news photo did not upload. Please try again.");
    }
  }

  await api("/api/news", {
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
    message.textContent = "News submitted. It will appear after owner/admin approval.";
  }

  toast("News submitted for approval.");

  await loadNews();
  if (hasManagementAccess()) await loadOwnerUsers();
});
  
  

async function loadOwnerUsers() {
  const container = $("#ownerUsers");
  const summary = $("#ownerSummary");
  const searchInput = $("#ownerUserSearch");
  if (!container || (!hasManagementAccess() && String(currentUser?.email || "").trim().toLowerCase() !== "payamusic361@gmail.com")) return;
  try {
    // Load account totals independently so a failure in the song or user
    // management panels cannot hide the registered-account count.
    const statsContainer = $("#ownerStats");
    if (statsContainer) statsContainer.innerHTML = '<p class="muted">Loading registered account totals…</p>';
    const statsPromise = api("/api/owner/stats");
    const [statsResult, userResult, songResult] = await Promise.allSettled([
      statsPromise,
      api("/api/owner/users"),
      api("/api/owner/songs")
    ]);
    const stats = statsResult.status === "fulfilled" ? statsResult.value : {};
    if (statsContainer) {
      statsContainer.innerHTML = statsResult.status === "fulfilled" ? [
        ["Registered accounts", stats.registered_accounts],
        ["Artists", stats.artists],
        ["Listeners", stats.listeners],
        ["DJs", stats.djs],
        ["Artists + DJs", stats.artist_djs],
        ["Unclassified accounts", stats.unclassified],
        ["Unique visitors", stats.unique_visitors],
        ["Total visits", stats.total_visits],
        ["Songs on Paya", stats.songs],
        ["Published news", stats.published_news],
        ["Active adverts", stats.active_adverts]
      ].map(([label, value]) => `<div class="owner-stat"><strong>${Number(value || 0).toLocaleString()}</strong><span>${escapeHTML(label)}</span></div>`).join("") : `<p class="error">${escapeHTML(statsResult.reason?.message || "Could not load registered account totals.")}</p>`;
    }
    if (summary && statsResult.status === "fulfilled") summary.textContent = `${Number(stats.registered_accounts || 0).toLocaleString()} registered accounts`;
    if (userResult.status === "rejected") throw userResult.reason;
    const users = userResult.value.users || [];
    const songs = songResult.status === "fulfilled" ? (songResult.value.songs || []) : [];
    const admins = users.filter((user) => user.role === "admin").length;
    if (summary) summary.textContent = `${Number(stats.registered_accounts ?? users.length).toLocaleString()} registered accounts · ${admins} administrators · ${songs.length} songs`;

    const render = () => {
      const query = (searchInput?.value || "").trim().toLowerCase();
      const filtered = users.filter((user) =>
        [user.name, user.username, user.email, user.role, user.account_type].some((value) =>
          String(value || "").toLowerCase().includes(query)
        )
      );
      const userHTML = filtered.length ? filtered.map((user) => {
        const role = String(user.role || "artist").toLowerCase();
        const isProtectedOwner = role === "owner";
        const canManageRoles = isOwner();
        return `
          <div class="admin-item">
            <strong>${escapeHTML(user.name || user.username || user.email || "User")}</strong>
            <span>${escapeHTML(user.email || "")}</span>
            <span>Admin role: ${escapeHTML(role)}</span>
            <span>Account type: ${escapeHTML(String(user.account_type || "unclassified").replace("_", " + "))}</span>
            ${!isProtectedOwner ? `<label>Member account type
              <select data-user-account-type="${escapeHTML(user.id)}">
                <option value="artist" ${user.account_type === "artist" ? "selected" : ""}>Artist</option>
                <option value="listener" ${user.account_type === "listener" ? "selected" : ""}>Listener</option>
                <option value="dj" ${user.account_type === "dj" ? "selected" : ""}>DJ</option>
                <option value="artist_dj" ${user.account_type === "artist_dj" ? "selected" : ""}>Artist + DJ</option>
                <option value="unclassified" ${!user.account_type || user.account_type === "unclassified" ? "selected" : ""}>Unclassified</option>
              </select>
            </label>
            <button type="button" data-save-account-type="${escapeHTML(user.id)}">Save account type</button>` : ""}
            ${isProtectedOwner ? '<span>Owner account — protected</span>' : `
              ${isOwner() ? `<label>Registered artist name
                <input type="text" maxlength="100" value="${escapeHTML(user.name || "")}" data-user-name="${escapeHTML(user.id)}">
              </label>
              <button type="button" data-save-user-name="${escapeHTML(user.id)}">Save artist name</button>` : ""}
              ${canManageRoles ? `<select aria-label="Role for ${escapeHTML(user.email || user.id)}" data-user-role="${escapeHTML(user.id)}">
                <option value="artist" ${role === "artist" ? "selected" : ""}>Artist / standard account</option>
                <option value="admin" ${role === "admin" ? "selected" : ""}>Admin</option>
                <option value="superadmin" ${role === "superadmin" ? "selected" : ""}>Super Admin</option>
              </select>
              <button type="button" data-save-role="${escapeHTML(user.id)}">Save role</button>` : ""}`}
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
        ${isOwner() ? "<h4>Full song catalogue — edit any song</h4>" : "<h4>Song catalogue</h4>"}
        ${isOwner() ? songHTML : ""}`;

      $("[data-save-account-type]", container).forEach((button) => {
        button.addEventListener("click", async () => {
          const id = button.dataset.saveAccountType;
          const select = container.querySelector(`[data-user-account-type="${CSS.escape(id)}"]`);
          if (!select) return;
          button.disabled = true;
          try {
            await api(`/api/owner/users/${encodeURIComponent(id)}/account-type`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ account_type: select.value })
            });
            toast("Member account type updated.");
            await loadOwnerUsers();
          } catch (error) {
            toast(error.message);
            button.disabled = false;
          }
        });
      });
      $("[data-save-role]", container).forEach((button) => {
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
      $$("[data-save-user-name]", container).forEach((button) => {
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
      $$("[data-save-owner-song]", container).forEach((button) => {
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

function focusSharedSong() {
  const sharedSongId = new URLSearchParams(window.location.search).get("song");
  if (!sharedSongId) return;
  const card = Array.from(document.querySelectorAll(".song-card"))
    .find((item) => item.dataset.songId === sharedSongId);
  if (!card) {
    toast("That song could not be found in the music catalogue.");
    return;
  }
  card.classList.add("shared-song-highlight");
  card.scrollIntoView({ behavior: "smooth", block: "center" });
}

document.addEventListener("DOMContentLoaded", async () => {
  await restoreSession();
  api("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_type: "visit", visitor_key: visitorKey() }) }).catch(() => {});
  await Promise.allSettled([
    loadSongs(),
    loadAds(),
    loadNews(),
    refreshDashboard()
  ]);
  focusSharedSong();
});
