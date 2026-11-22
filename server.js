
require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");
const { Readable } = require("stream");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase environment variables are missing");
}

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is missing");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MUSIC_BUCKET = "music";
const IMAGE_BUCKET = "media";

function convertM4aToMp3(inputBuffer) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("Audio converter is unavailable"));
    const ffmpeg = spawn(ffmpegPath, [
      "-hide_banner", "-loglevel", "error",
      "-i", "pipe:0",
      "-vn", "-codec:a", "libmp3lame", "-b:a", "192k",
      "-f", "mp3", "pipe:1"
    ]);
    const output = [];
    const errors = [];
    ffmpeg.stdout.on("data", chunk => output.push(chunk));
    ffmpeg.stderr.on("data", chunk => errors.push(chunk));
    ffmpeg.on("error", reject);
    ffmpeg.on("close", code => {
      if (code === 0 && output.length) return resolve(Buffer.concat(output));
      reject(new Error(Buffer.concat(errors).toString("utf8").slice(0, 1000) || "M4A conversion failed"));
    });
    ffmpeg.stdin.on("error", () => {});
    ffmpeg.stdin.end(inputBuffer);
  });
}

async function getSongEventCounts(table, songIds) {
  const { data, error } = await supabase
    .from(table)
    .select("song_id")
    .in("song_id", songIds);

  if (error) {
    // Keep the site working if the download-count migration has not yet been run.
    if (table === "song_downloads") {
      console.warn("Song download counts are not ready yet:", error.message);
      return new Map();
    }
    throw error;
  }

  const counts = new Map();
  for (const event of data || []) {
    counts.set(event.song_id, (counts.get(event.song_id) || 0) + 1);
  }
  return counts;
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "data:", "https://knedortbcjaaprmwuqqg.supabase.co"]
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(express.json({ limit: "2mb" }));
// DYNAMIC XML SITEMAP: include the homepage and all public songs/news.
app.get("/sitemap.xml", async (req, res) => {
  const siteUrl = "https://paya-music-ug.onrender.com";
  const entries = [
    { url: siteUrl + "/", lastmod: new Date().toISOString().slice(0, 10), priority: "1.0" }
  ];
  const artistIds = new Set();

  try {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("songs")
        .select("id, created_at, uploader_id")
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .range(offset, offset + 999);
      if (error) throw error;
      for (const song of data || []) {
        entries.push({
          url: siteUrl + "/song/" + encodeURIComponent(song.id),
          lastmod: song.created_at ? new Date(song.created_at).toISOString().slice(0, 10) : "",
          priority: "0.8"
        });
        if (song.uploader_id) artistIds.add(song.uploader_id);
      }
      if (!data || data.length < 1000) break;
    }

    for (const artistId of artistIds) {
      entries.push({
        url: siteUrl + "/artist/" + encodeURIComponent(artistId),
        priority: "0.7"
      });
    }

    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("news")
        .select("id, published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .range(offset, offset + 999);
      if (error) throw error;
      for (const article of data || []) {
        entries.push({
          url: siteUrl + "/news/" + encodeURIComponent(article.id),
          lastmod: article.published_at ? new Date(article.published_at).toISOString().slice(0, 10) : "",
          priority: "0.7"
        });
      }
      if (!data || data.length < 1000) break;
    }

    const xmlEscape = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    const urls = entries.map((entry) =>
      "<url><loc>" + xmlEscape(entry.url) + "</loc>" +
      (entry.lastmod ? "<lastmod>" + xmlEscape(entry.lastmod) + "</lastmod>" : "") +
      "<priority>" + entry.priority + "</priority></url>"
    ).join("");
    res.set("Cache-Control", "public, max-age=900");
    res.type("application/xml").send('<?xml version="1.0" encoding="UTF-8"?>' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls + "</urlset>");
  } catch (error) {
    console.error("Sitemap generation failed:", error);
    res.status(503).type("text/plain").send("Sitemap temporarily unavailable");
  }
});

app.use(express.static("public"));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200
}));

// AUDIO UPLOAD
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// IMAGE UPLOAD
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return callback(new Error("Upload a JPG, PNG, or WEBP image"));
    }

    callback(null, true);
  }
});

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function makeToken(user) {
  return jwt.sign(
    { id: user.id },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// AUTHENTICATION
async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.replace(/^Bearer\s+/i, "");

    if (!token) {
      return res.status(401).json({ error: "Please sign in" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, role, account_type, bio, avatar_url, cover_url")
      .eq("id", decoded.id)
      .maybeSingle();

    if (error || !user) {
      return res.status(401).json({ error: "Account not found" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      error: "Invalid or expired session"
    });
  }
}

function admin(req, res, next) {
  const email = String(req.user.email || "").trim().toLowerCase();
  const isPaymentManagerOnly = email === "payamusic361@gmail.com" && req.user.role !== "owner";
  if (isPaymentManagerOnly || !["admin", "superadmin", "owner"].includes(req.user.role)) {
    return res.status(403).json({
      error: "Admin access required"
    });
  }

  next();
}

function newsModerator(req, res, next) {
  const email = String(req.user.email || "").trim().toLowerCase();
  const permittedRole = ["admin", "superadmin", "owner"].includes(String(req.user.role || "").toLowerCase());
  if (!permittedRole && email !== "payamusic361@gmail.com") {
    return res.status(403).json({ error: "News management access required" });
  }
  next();
}

function operationalAdmin(req, res, next) {
  if (req.user.role !== "owner") {
    return res.status(403).json({ error: "Owner access required" });
  }
  next();
}

function songCatalogueEditor(req, res, next) {
  const email = String(req.user.email || "").trim().toLowerCase();
  if (req.user.role !== "owner" && email !== "payamusic361@gmail.com") {
    return res.status(403).json({ error: "Song catalogue editing access required" });
  }
  next();
}

function songAssetManager(req, res, next) {
  const email = String(req.user.email || "").trim().toLowerCase();
  const permittedRole = ["admin", "superadmin", "owner"].includes(String(req.user.role || "").toLowerCase());
  if (!permittedRole && email !== "payamusic361@gmail.com") {
    return res.status(403).json({ error: "Song artwork and deletion access required" });
  }
  next();
}

function managementViewer(req, res, next) {
  const email = String(req.user.email || "").trim().toLowerCase();
  if (req.user.role !== "owner" && email !== "payamusic361@gmail.com") {
    return res.status(403).json({ error: "Management access required" });
  }
  next();
}

function paymentManager(req, res, next) {
  const email = String(req.user.email || "").trim().toLowerCase();
  if (req.user.role !== "owner" && email !== "payamusic361@gmail.com") {
    return res.status(403).json({ error: "Payment management access required" });
  }
  next();
}

function owner(req, res, next) {
  if (req.user.role !== "owner") {
    return res.status(403).json({
      error: "Owner access required"
    });
  }

  next();
}

// REGISTER
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const requestedAccountType = String(req.body.account_type || "artist").trim().toLowerCase();
    const allowedAccountTypes = ["artist", "listener", "dj", "artist_dj"];
    if (!allowedAccountTypes.includes(requestedAccountType)) {
      return res.status(400).json({ error: "Choose Artist, Listener, DJ or Artist + DJ." });
    }

    if (
      !name ||
      !email ||
      !password ||
      password.length < 10
    ) {
      return res.status(400).json({
        error: "Enter your name, email and a password of at least 10 characters"
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        error: "Email already registered"
      });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const { data: user, error } = await supabase
      .from("users")
      .insert({
        name: name.trim(),
        email: normalizedEmail,
        password_hash,
        role: "artist",
        account_type: requestedAccountType,
        bio: ""
      })
      .select("id, name, email, role, account_type, bio, avatar_url, cover_url")
      .single();

    if (error) throw error;

    // Automatically move songs uploaded by Paya admins/owner into the
    // newly registered artist's account when the artist name matches.
    let claimedSongs = 0;
    const normalizedArtistName = String(user.name || "").trim().replace(/\s+/g, " ").toLowerCase();
    if (["artist", "artist_dj"].includes(user.account_type) && normalizedArtistName) {
      const { data: staff, error: staffError } = await supabase
        .from("users")
        .select("id")
        .in("role", ["owner", "admin"]);
      if (staffError) throw staffError;

      const staffIds = (staff || []).map((item) => item.id);
      if (staffIds.length) {
        const { data: uploadedSongs, error: songsError } = await supabase
          .from("songs")
          .select("id, artist")
          .in("uploader_id", staffIds);
        if (songsError) throw songsError;

        const matchingSongIds = (uploadedSongs || [])
          .filter((song) => String(song.artist || "").trim().replace(/\s+/g, " ").toLowerCase() === normalizedArtistName)
          .map((song) => song.id);

        if (matchingSongIds.length) {
          const { data: movedSongs, error: moveError } = await supabase
            .from("songs")
            .update({ uploader_id: user.id })
            .in("id", matchingSongIds)
            .in("uploader_id", staffIds)
            .select("id");
          if (moveError) throw moveError;
          claimedSongs = (movedSongs || []).length;
        }
      }
    }

    res.status(201).json({
      token: makeToken(user),
      user,
      claimed_songs: claimedSongs
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      error: "Registration failed"
    });
  }
});

// LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .toLowerCase()
      .trim();

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (
      error ||
      !user ||
      !(await bcrypt.compare(
        req.body.password || "",
        user.password_hash
      ))
    ) {
      return res.status(401).json({
        error: "Incorrect email or password"
      });
    }

    delete user.password_hash;

    res.json({
      token: makeToken(user),
      user
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      error: "Login failed"
    });
  }
});

// CURRENT ACCOUNT
app.get("/api/me", auth, (req, res) => {
  res.json({ user: req.user });
});

// UPDATE ARTIST PROFILE DIRECTLY; profile pictures do not require approval.
app.patch("/api/profile", auth, async (req, res) => {
  try {
    const { name, bio, avatar_url, cover_url } = req.body;
    if (typeof name !== "string" || name.trim().length < 2 || typeof bio !== "string") {
      return res.status(400).json({ error: "Enter an artist name and biography." });
    }
    const updates = {
      name: name.trim().slice(0, 120),
      bio: bio.slice(0, 1000)
    };
    if (typeof avatar_url === "string" && avatar_url.startsWith("https://")) {
      updates.avatar_url = avatar_url;
    }
    if (typeof cover_url === "string" && cover_url.startsWith("https://")) {
      updates.cover_url = cover_url;
    }
    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", req.user.id)
      .select("id, name, email, role, account_type, bio, avatar_url, cover_url")
      .single();
    if (error) throw error;
    res.json({
      message: data.avatar_url
        ? "Artist profile saved successfully."
        : "Artist profile saved. Choose a photo to add your profile picture.",
      user: data
    });
  } catch (error) {
    console.error("Profile update error:", error.message, error.code || "");
    res.status(500).json({ error: "Profile update failed. Please try again." });
  }
});

// PROFILE PICTURE UPLOAD; FINAL PROFILE CHANGE IS SUBMITTED BY /api/profile
app.post("/api/profile/avatar", auth, imageUpload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Please choose an image" });
    const ext = req.file.mimetype === "image/png" ? "png" : req.file.mimetype === "image/webp" ? "webp" : "jpg";
    const filename = `profile-submissions/${req.user.id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(filename, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(filename);
    res.json({ avatar_url: data.publicUrl });
  } catch (error) {
    console.error("Profile picture upload error:", error.message, error.code || "");
    res.status(500).json({ error: "Profile picture upload failed." });
  }
});

// COVER PHOTO UPLOAD
app.post("/api/profile/cover", auth, imageUpload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Please choose a cover image" });
    const ext = req.file.mimetype === "image/png" ? "png" : req.file.mimetype === "image/webp" ? "webp" : "jpg";
    const filename = `profile-covers/${req.user.id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(filename, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(filename);
    res.json({ cover_url: data.publicUrl });
  } catch (error) {
    console.error("Profile cover upload error:", error.message, error.code || "");
    res.status(500).json({ error: "Cover photo upload failed." });
  }
});

// UPLOAD SONG
app.post("/api/songs", auth, upload.fields([{ name: "audio", maxCount: 1 }, { name: "cover_image", maxCount: 1 }]), async (req, res) => {
  try {
    const file = req.files?.audio?.[0] || null;
    const coverFile = req.files?.cover_image?.[0] || null;
    const { title, artist, genre, description } = req.body;
    const accountType = String(req.user.account_type || "unclassified");
    const isDesignatedManagementUploader = String(req.user.email || "").trim().toLowerCase() === "payamusic361@gmail.com";
    const isStaffUploader = ["owner", "admin", "superadmin"].includes(String(req.user.role || "").toLowerCase()) || isDesignatedManagementUploader;
    const uploadType = String(req.body.upload_type || (req.body.is_remix ? "remix" : "song")).trim().toLowerCase();
    if (!isStaffUploader && !["artist", "dj", "artist_dj"].includes(accountType)) {
      return res.status(403).json({ error: "Only Artist, DJ or Artist + DJ accounts can upload music. Contact Paya Music UG Management if your account type needs correction." });
    }
    if (!["song", "dj_mix", "remix"].includes(uploadType)) {
      return res.status(400).json({ error: "Choose an original song, DJ nonstop/mix or remix." });
    }
    if (!isStaffUploader && uploadType === "dj_mix" && !["dj", "artist_dj"].includes(accountType)) {
      return res.status(403).json({ error: "DJ nonstop/mix uploads are available to DJ and Artist + DJ accounts." });
    }

    const originalName = String(file?.originalname || "");
    const extension = originalName.toLowerCase().split(".").pop();
    const isM4a = extension === "m4a";
    const isMp3 = extension === "mp3";
    const acceptedAudioTypes = [
      "audio/mpeg", "audio/mp3", "audio/x-mpeg", "audio/mpeg3",
      "audio/x-mpeg-3", "audio/mp4", "audio/x-m4a", "audio/m4a",
      "application/octet-stream", "video/mp4", ""
    ];

    if (!file || (!isMp3 && !isM4a) || !acceptedAudioTypes.includes(String(file.mimetype || "").toLowerCase())) {
      return res.status(400).json({
        error: "Please upload an MP3 or M4A audio file"
      });
    }

    let audioBuffer = file.buffer;
    if (isM4a) {
      try {
        audioBuffer = await convertM4aToMp3(file.buffer);
      } catch (conversionError) {
        console.error("M4A conversion error:", conversionError.message);
        return res.status(400).json({
          error: "This M4A file could not be converted. Please try another audio file."
        });
      }
    }

    if (!title || !artist) {
      return res.status(400).json({
        error: "Song title and artist are required"
      });
    }

    const isRemix = uploadType === "remix" || ["true", "1", "yes", "on", "remix"].includes(
      String(req.body.is_remix || req.body.version_type || "").trim().toLowerCase()
    );
    const cleanTitle = String(title).trim().slice(0, 120);
    const cleanArtist = String(artist).trim().slice(0, 120);
    const audioSha256 = crypto.createHash("sha256").update(audioBuffer).digest("hex");

    // Block identical audio even if the uploader renames the file.
    const { data: identicalAudio, error: hashCheckError } = await supabase
      .from("songs")
      .select("id, title, artist")
      .eq("audio_sha256", audioSha256)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();

    if (hashCheckError) throw hashCheckError;
    if (identicalAudio) {
      return res.status(409).json({
        error: "This exact audio file is already published. Upload a genuinely different recording or remix."
      });
    }

    // Block the same title by the same artist, unless it is explicitly marked as a remix.
    if (!isRemix) {
      const { data: matchingSongs, error: titleCheckError } = await supabase
        .from("songs")
        .select("id, title, artist")
        .eq("status", "approved")
        .ilike("title", cleanTitle)
        .ilike("artist", cleanArtist)
        .limit(20);

      if (titleCheckError) throw titleCheckError;
      const normalizeSongText = (value) => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
      const duplicate = (matchingSongs || []).find(song =>
        normalizeSongText(song.title) === normalizeSongText(cleanTitle) &&
        normalizeSongText(song.artist) === normalizeSongText(cleanArtist)
      );

      if (duplicate) {
        return res.status(409).json({
          error: "This song title by this artist is already published. If this is a genuine remix, select the Remix option and upload a different audio recording."
        });
      }
    }

    const publishedTitle = isRemix && !/\bremix\b/i.test(cleanTitle)
      ? `${cleanTitle} (Remix)`
      : cleanTitle;

    const filename = `${Date.now()}-${req.user.id}.mp3`;
    let cover_url = null;
    let coverFilename = null;
    const { error: storageError } = await supabase.storage.from(MUSIC_BUCKET).upload(filename, audioBuffer, { contentType: "audio/mpeg", upsert: false });
    if (storageError) throw storageError;
    if (coverFile) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(coverFile.mimetype) || coverFile.size > 5 * 1024 * 1024) {
        await supabase.storage.from(MUSIC_BUCKET).remove([filename]);
        return res.status(400).json({ error: "Song cover must be JPG, PNG, or WEBP and no larger than 5 MB." });
      }
      const ext = coverFile.mimetype === "image/png" ? "png" : coverFile.mimetype === "image/webp" ? "webp" : "jpg";
      coverFilename = `song-covers/${req.user.id}-${Date.now()}.${ext}`;
      const { error: coverError } = await supabase.storage.from(IMAGE_BUCKET).upload(coverFilename, coverFile.buffer, { contentType: coverFile.mimetype, upsert: false });
      if (coverError) { await supabase.storage.from(MUSIC_BUCKET).remove([filename]); throw coverError; }
      cover_url = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(coverFilename).data.publicUrl;
    }
    const { data, error } = await supabase.from("songs").insert({
        title: publishedTitle,
        cover_url: cover_url || "/paya-default-cover.svg",
        artist: cleanArtist,
        country: String(req.body.country || "").trim().slice(0, 80),
        genre: (genre || "").slice(0, 60),
        description: (description || "").slice(0, 500),
        filename,
        original_name: file.originalname,
        mime_type: "audio/mpeg",
        size: audioBuffer.length,
        audio_sha256: audioSha256,
        upload_type: uploadType,
        uploader_id: req.user.id,
        status: "approved"
      })
      .select()
      .single();

    if (error) {
      await supabase.storage.from(MUSIC_BUCKET).remove([filename]);
      if (coverFilename) await supabase.storage.from(IMAGE_BUCKET).remove([coverFilename]);
      throw error;
    }

    res.status(201).json({
      message: "Song uploaded and published successfully.",
      song: data
    });
  } catch (error) {
    console.error("Song upload error:", error);
    res.status(500).json({
      error: "Song upload failed"
    });
  }
});

// PUBLIC ARTIST COUNTRY DIRECTORY; one country per credited artist.
app.get("/api/artist-countries", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("artist_countries")
      .select("artist_name, country");
    if (error) throw error;
    res.json({ artists: data || [] });
  } catch (error) {
    console.error("Artist country directory error:", error.message);
    res.status(500).json({ error: "Could not load artist countries" });
  }
});

app.put("/api/artist-countries", auth, managementViewer, async (req, res) => {
  try {
    const artistName = String(req.body.artist_name || "").trim().replace(/\s+/g, " ").slice(0, 120);
    const country = String(req.body.country || "").trim().slice(0, 80);
    if (artistName.length < 2 || country.length < 2) {
      return res.status(400).json({ error: "Enter the artist name and their country." });
    }
    const normalizedName = artistName.toLocaleLowerCase();
    const { data, error } = await supabase
      .from("artist_countries")
      .upsert({ artist_name: artistName, normalized_name: normalizedName, country }, { onConflict: "normalized_name" })
      .select("artist_name, country")
      .single();
    if (error) throw error;
    res.json({ artist: data });
  } catch (error) {
    console.error("Artist country save error:", error.message);
    res.status(500).json({ error: "Could not save artist country" });
  }
});

// PUBLIC APPROVED SONGS
app.get("/api/songs", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim().slice(0, 100);
    let request = supabase
      .from("songs")
      .select("id, title, artist, country, genre, description, cover_url, created_at, uploader_id")
      .eq("status", "approved");
    if (query) {
      const safeQuery = query.replace(/[,%()]/g, " ").trim();
      if (safeQuery) request = request.or(`title.ilike.%${safeQuery}%,artist.ilike.%${safeQuery}%,genre.ilike.%${safeQuery}%`);
    }
    const country = String(req.query.country || "").trim().slice(0, 80);
    if (country) request = request.ilike("country", country);
    // Fetch in small pages so every approved song is returned even when the
    // Supabase project's configured maximum response size is unusually low.
    let songs = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await request
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = data || [];
      songs.push(...page);
      if (page.length < pageSize) break;
    }
    const sort = String(req.query.sort || "newest");
    if (songs.length) {
      const ids = songs.map((song) => song.id);
      const [playCounts, downloadCounts] = await Promise.all([
        getSongEventCounts("song_plays", ids),
        getSongEventCounts("song_downloads", ids)
      ]);
      songs = songs.map((song) => ({
        ...song,
        play_count: playCounts.get(song.id) || 0,
        download_count: downloadCounts.get(song.id) || 0
      }));
      if (sort === "played") {
        songs.sort((a, b) => b.play_count - a.play_count || new Date(b.created_at) - new Date(a.created_at));
      }
      const { data: likes, error: likesError } = await supabase.from("song_likes").select("song_id").in("song_id", ids);
      if (likesError) throw likesError;
      const likeCounts = new Map();
      for (const like of likes || []) likeCounts.set(like.song_id, (likeCounts.get(like.song_id) || 0) + 1);
      songs = songs.map((song) => ({ ...song, likes: likeCounts.get(song.id) || 0 }));
      if (sort === "liked") songs.sort((a, b) => b.likes - a.likes || new Date(b.created_at) - new Date(a.created_at));
    }
    // Attach only public artist-profile fields to songs uploaded by registered artists.
    const uploaderIds = [...new Set(songs.map((song) => song.uploader_id).filter(Boolean))];
    let profilesById = new Map();
    if (uploaderIds.length) {
      const { data: profiles, error: profilesError } = await supabase
        .from("users")
        .select("id, name, bio, avatar_url")
        .in("id", uploaderIds);
      if (!profilesError) profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));
    }
    const songsWithProfiles = songs.map((song) => ({
      ...song,
      artist_profile: song.uploader_id ? (profilesById.get(song.uploader_id) || null) : null
    }));
    res.json({ songs: songsWithProfiles });
  } catch (error) {
    res.status(500).json({
      error: "Could not load songs"
    });
  }
});

// NEWS SHARE LINKS: expose the article headline and image to WhatsApp/social crawlers.
app.get("/news/:id", async (req, res) => {
  try {
    const { data: article, error } = await supabase.from("news")
      .select("id, title, content, category, image_url, published_at, status")
      .eq("id", req.params.id).eq("status", "published").maybeSingle();
    if (error || !article) return res.status(404).send("News story not found");
    const siteUrl = `${req.protocol}://${req.get("host")}`;
    const pageUrl = `${siteUrl}/news/${encodeURIComponent(article.id)}`;
    const targetUrl = `/?news=${encodeURIComponent(article.id)}`;
    let imageUrl = `${siteUrl}/paya-default-cover.svg`;
    try {
      const candidate = new URL(article.image_url || "/paya-default-cover.svg", siteUrl);
      if (candidate.protocol === "https:" || candidate.origin === siteUrl) imageUrl = candidate.href;
    } catch {}
    const title = String(article.title || "Paya Music UG News");
    const plainContent = String(article.content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const description = (plainContent || `Read the latest ${article.category || "news"} story on Paya Music UG.`).slice(0, 120);
    // Use a landscape-only thumbnail for social previews when the article image is in Supabase Storage.
    // The original article artwork and on-site news display remain unchanged.
    if (imageUrl.includes("/storage/v1/object/public/")) {
      imageUrl = imageUrl.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
      imageUrl += `${imageUrl.includes("?") ? "&" : "?"}width=1200&height=630&resize=cover`;
    }
    const safeTitle = escapeHTML(title);
    const safeDescription = escapeHTML(description);
    const safeImage = escapeHTML(imageUrl);
    const safePageUrl = escapeHTML(pageUrl);
    const safeTargetUrl = escapeHTML(targetUrl);
    res.set("Cache-Control", "public, max-age=300");
    res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle} | Paya Music UG</title><meta name="description" content="${safeDescription}">
<meta property="og:type" content="article"><meta property="og:site_name" content="Paya Music UG">
<meta property="og:title" content="${safeTitle}"><meta property="og:description" content="${safeDescription}">
<meta property="og:url" content="${safePageUrl}"><meta property="og:image" content="${safeImage}">
<meta property="og:image:alt" content="${safeTitle}"><meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}"><meta name="twitter:description" content="${safeDescription}">
<meta name="twitter:image" content="${safeImage}"><link rel="canonical" href="${safePageUrl}">
<style>body{margin:0;min-height:100vh;background:#0c0d0f;color:#f5f2eb;font:16px Arial,sans-serif;display:grid;place-items:center;padding:24px;text-align:center}main{max-width:560px}img{width:100%;max-height:340px;object-fit:cover;border-radius:12px}h1{font-size:25px;line-height:1.3}p{color:#aaa;line-height:1.6}a{display:inline-block;margin-top:14px;padding:13px 20px;background:#e8b84c;color:#15120b;text-decoration:none;font-weight:bold;border-radius:5px}</style>
</head><body><main><img src="${safeImage}" alt="${safeTitle}"><h1>${safeTitle}</h1><p>${safeDescription}</p><p>Opening this story on Paya Music UG…</p><a href="${safeTargetUrl}">Read full story</a></main>
<script>window.location.replace(${JSON.stringify(targetUrl)});</script></body></html>`);
  } catch (error) {
    console.error("News share page error:", error);
    res.status(500).send("Could not open news story");
  }
});

// PUBLIC ARTIST PROFILE PAGES: shareable profile, biography and published catalogue.
app.get("/artist/:id", async (req, res) => {
  try {
    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("id, name, bio, avatar_url")
      .eq("id", req.params.id)
      .maybeSingle();
    if (profileError || !profile) return res.status(404).send("Artist not found");

    let songs = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase
        .from("songs")
        .select("id, title, artist, description, cover_url, genre, country, created_at")
        .eq("uploader_id", profile.id)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .range(offset, offset + 499);
      if (error) throw error;
      songs.push(...(data || []));
      if (!data || data.length < 500) break;
    }

    const siteUrl = "https://paya-music-ug.onrender.com";
    const pageUrl = siteUrl + "/artist/" + encodeURIComponent(profile.id);
    const artistName = String(profile.name || "Paya Artist");
    const bio = String(profile.bio || ("Discover music and releases by " + artistName + " on Paya Music UG."));
    const imageUrl = (() => {
      try {
        const candidate = new URL(profile.avatar_url || "/paya-default-cover.svg", siteUrl);
        return candidate.protocol === "https:" || candidate.origin === siteUrl
          ? candidate.href : siteUrl + "/paya-default-cover.svg";
      } catch {
        return siteUrl + "/paya-default-cover.svg";
      }
    })();
    const safeName = escapeHTML(artistName);
    const safeBio = escapeHTML(bio);
    const safeImage = escapeHTML(imageUrl);
    const safePageUrl = escapeHTML(pageUrl);
    const structuredData = {
      "@context": "https://schema.org",
      "@type": "MusicGroup",
      "name": artistName,
      "description": bio,
      "image": imageUrl,
      "url": pageUrl,
      "genre": [...new Set(songs.map(song => song.genre).filter(Boolean))],
      "track": songs.slice(0, 50).map(song => ({
        "@type": "MusicRecording",
        "name": song.title,
        "url": siteUrl + "/song/" + encodeURIComponent(song.id)
      }))
    };
    const safeStructuredData = JSON.stringify(structuredData).replace(/</g, "\\u003c");
    const songCards = songs.length ? songs.map(song => {
      const songTitle = escapeHTML(song.title || "Untitled song");
      const creditedArtist = escapeHTML(song.artist || artistName);
      let cover = siteUrl + "/paya-default-cover.svg";
      try {
        const candidate = new URL(song.cover_url || "/paya-default-cover.svg", siteUrl);
        if (candidate.protocol === "https:" || candidate.origin === siteUrl) cover = candidate.href;
      } catch {}
      const safeCover = escapeHTML(cover);
      const streamUrl = "/api/songs/" + encodeURIComponent(song.id) + "/stream";
      const downloadUrl = "/api/songs/" + encodeURIComponent(song.id) + "/download";
      const songPageUrl = "/song/" + encodeURIComponent(song.id);
      return `<article class="track">
        <img src="${safeCover}" alt="${songTitle} cover" loading="lazy">
        <div class="track-info"><h2><a href="${songPageUrl}">${songTitle}</a></h2>
        <p>${creditedArtist}${song.genre ? " · " + escapeHTML(song.genre) : ""}${song.country ? " · " + escapeHTML(song.country) : ""}</p>
        <audio controls preload="none" src="${streamUrl}">Audio playback is not supported by this browser.</audio>
        </div><a class="download" href="${downloadUrl}" rel="nofollow">Download</a>
      </article>`;
    }).join("") : '<p class="empty">No published songs yet. Check back for new releases.</p>';

    res.set("Cache-Control", "public, max-age=300");
    res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeName} | Artist Profile | Paya Music UG</title>
<meta name="description" content="${safeBio.slice(0, 180)}"><meta name="robots" content="index,follow">
<link rel="canonical" href="${safePageUrl}">
<meta property="og:type" content="profile"><meta property="og:site_name" content="Paya Music UG">
<meta property="og:title" content="${safeName} | Paya Music UG"><meta property="og:description" content="${safeBio.slice(0, 180)}">
<meta property="og:url" content="${safePageUrl}"><meta property="og:image" content="${safeImage}">
<meta property="og:image:alt" content="${safeName} profile picture">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${safeName} | Paya Music UG">
<meta name="twitter:description" content="${safeBio.slice(0, 180)}"><meta name="twitter:image" content="${safeImage}">
<script type="application/ld+json">${safeStructuredData}</script>
<style>
*{box-sizing:border-box}body{margin:0;background:#0c0d0f;color:#f5f2eb;font:16px Arial,sans-serif;padding:24px 16px}
main{max-width:980px;margin:0 auto}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:24px}
.top a,.download,.back{color:#e8c36d;text-decoration:none}.brand{font-weight:800;letter-spacing:.08em}
.profile{display:flex;align-items:center;gap:24px;padding:26px;border:1px solid #34363a;border-radius:18px;background:#17191d}
.avatar{width:150px;height:150px;flex:0 0 150px;object-fit:cover;border-radius:50%;border:3px solid #d5aa4e;background:#25272b}
h1{font-size:clamp(26px,5vw,42px);margin:0 0 10px}.bio{color:#c3c3c3;line-height:1.7;margin:0;white-space:pre-wrap}
.catalogue{margin-top:34px}.catalogue-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.catalogue h2{font-size:24px}.count{color:#d8b96e;font-size:13px}
.track{display:grid;grid-template-columns:86px minmax(0,1fr) auto;gap:16px;align-items:center;padding:14px 0;border-bottom:1px solid #303238}
.track img{width:86px;height:86px;object-fit:cover;border-radius:9px}.track-info{min-width:0}
.track-info h2{font-size:17px;margin:0 0 6px}.track-info h2 a{color:#f5f2eb;text-decoration:none}
.track-info p{color:#aaa;font-size:13px;margin:0 0 10px}.track audio{width:100%;max-width:480px;height:38px}
.download{padding:10px 13px;border:1px solid #66532e;border-radius:999px;font-size:12px;font-weight:700}
.empty{color:#aaa;padding:22px 0}footer{margin-top:36px;padding-top:18px;border-top:1px solid #303238;color:#999;font-size:13px}
@media(max-width:600px){body{padding:16px 12px}.profile{padding:17px;gap:14px;align-items:flex-start}.avatar{width:88px;height:88px;flex-basis:88px}.bio{font-size:13px}.track{grid-template-columns:68px minmax(0,1fr);gap:11px}.track img{width:68px;height:68px}.track-info h2{font-size:15px}.track audio{width:100%}.download{grid-column:2;justify-self:start;padding:8px 11px}}
</style></head><body><main>
<nav class="top"><a class="brand" href="/">PAYA MUSIC UG</a><a href="/">Discover music</a></nav>
<header class="profile"><img class="avatar" src="${safeImage}" alt="${safeName} profile picture" width="300" height="300">
<div><p class="count">PUBLIC ARTIST PROFILE</p><h1>${safeName}</h1><p class="bio">${safeBio}</p></div></header>
<section class="catalogue"><div class="catalogue-head"><h2>Music by ${safeName}</h2><span class="count">${songs.length} published ${songs.length === 1 ? "song" : "songs"}</span></div>${songCards}</section>
<footer><a class="back" href="/">Discover more music on Paya Music UG</a></footer>
<iframe name="payaSongDownloadFrame" title="Song download" hidden></iframe>
</section>
<section class="discovery" aria-label="More music"><h2>Discover more music on Paya Music UG</h2><div class="discovery-grid">${moreSongsHTML || '<p>Explore the full music catalogue on Paya Music UG.</p>'}</div><p style="text-align:center;margin-top:24px"><a class="button secondary" href="/#music">Explore all music</a> <a class="button secondary" href="/artists">Discover artists</a></p></section>
</main></body></html>`);
  } catch (error) {
    console.error("Artist profile page error:", error);
    res.status(500).send("Could not load artist profile");
  }
});

// SEO SONG PAGES: render the complete approved song page for visitors and search crawlers.
app.get("/song/:id", async (req, res) => {
  try {
    const { data: song, error } = await supabase.from("songs")
      .select("id, title, artist, description, cover_url, genre, country, created_at, status")
      .eq("id", req.params.id).eq("status", "approved").maybeSingle();
    if (error || !song) return res.status(404).send("Song not found");

    // Social/search crawlers receive the song-specific metadata below (title, artist, artwork).
    // Real visitors are sent into the full Paya Music UG catalogue with this song selected.
    const userAgent = String(req.get("user-agent") || "");
    const metadataCrawler = /facebookexternalhit|Facebot|WhatsApp|TelegramBot|Twitterbot|LinkedInBot|Slackbot|Discordbot|Googlebot|bingbot|Applebot|Pinterestbot/i.test(userAgent);
    if (!metadataCrawler) {
      return res.redirect(302, `/?song=${encodeURIComponent(song.id)}#music`);
    }

    const siteUrl = "https://paya-music-ug.onrender.com";
    const pageUrl = siteUrl + "/song/" + encodeURIComponent(song.id);
    const audioUrl = siteUrl + "/api/songs/" + encodeURIComponent(song.id) + "/stream";
    const downloadUrl = siteUrl + "/api/songs/" + encodeURIComponent(song.id) + "/download";
    let imageUrl = siteUrl + "/paya-default-cover.svg";
    try {
      const candidate = new URL(song.cover_url || "/paya-default-cover.svg", siteUrl);
      if (candidate.protocol === "https:" || candidate.origin === siteUrl) imageUrl = candidate.href;
    } catch {}

    const songTitle = String(song.title || "Song");
    const artistName = String(song.artist || "Artist");
    const title = songTitle + " — " + artistName;
    const description = String(song.description || ("Listen to and download " + songTitle + " by " + artistName + " on Paya Music UG.")).slice(0, 180);
    const safeTitle = escapeHTML(title);
    const safeDescription = escapeHTML(description);
    const safeImage = escapeHTML(imageUrl);
    const safePageUrl = escapeHTML(pageUrl);
    const safeAudioUrl = escapeHTML(audioUrl);
    const safeDownloadUrl = escapeHTML(downloadUrl);
    const downloadFilename = escapeHTML((songTitle + " - " + artistName + " - Paya Music UG.mp3").replace(/[\\/:*?"<>|]+/g, "-").replace(/\\s+/g, " ").trim());
    const safeGenre = escapeHTML(song.genre || "");
    const safeCountry = escapeHTML(song.country || "");
    const structuredData = {
      "@context": "https://schema.org", "@type": "MusicRecording",
      "name": songTitle, "byArtist": { "@type": "Person", "name": artistName },
      "description": description, "image": imageUrl, "url": pageUrl, "audio": audioUrl,
      "genre": song.genre || undefined, "datePublished": song.created_at || undefined,
      "publisher": { "@type": "Organization", "name": "Paya Music UG", "url": siteUrl }
    };
    const safeStructuredData = JSON.stringify(structuredData).replace(/</g, "\\u003c");

    res.set("Cache-Control", "public, max-age=300");
    res.type("html").send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle} | Paya Music UG</title>
<meta name="description" content="${safeDescription}"><meta name="robots" content="index,follow">
<link rel="canonical" href="${safePageUrl}">
<meta property="og:type" content="music.song"><meta property="og:site_name" content="Paya Music UG">
<meta property="og:title" content="${safeTitle}"><meta property="og:description" content="${safeDescription}">
<meta property="og:url" content="${safePageUrl}"><meta property="og:image" content="${safeImage}">
<meta property="og:image:alt" content="${safeTitle} cover artwork">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDescription}"><meta name="twitter:image" content="${safeImage}">
<script type="application/ld+json">${safeStructuredData}</script>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0c0d0f;color:#f5f2eb;font:16px Arial,sans-serif;padding:0 0 36px}
.site-header{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px max(18px,calc((100% - 1100px)/2));background:#101114;border-bottom:1px solid #343434}
.brand{color:#f5f2eb;text-decoration:none;font-weight:900;letter-spacing:1px;white-space:nowrap}.brand span{color:#e8b84c}
.site-nav{display:flex;gap:18px;flex-wrap:wrap}.site-nav a{color:#ddd;text-decoration:none;font-size:14px}.site-nav a:hover{color:#e8b84c}
main{max-width:1050px;margin:0 auto;text-align:center;padding:26px 18px}.song-content{max-width:720px;margin:0 auto}.cover{display:block;width:min(46vw,190px);height:auto;max-height:250px;aspect-ratio:auto;object-fit:contain;border-radius:14px;margin:0 auto 14px}
h1{font-size:clamp(25px,5vw,36px);margin:16px 0 8px}.artist{font-size:20px;color:#d4d0c8;margin:0 0 16px}
p{color:#aaa;line-height:1.65}.meta{color:#c8b27d;font-size:14px;margin:12px 0 22px}
audio{width:100%;margin:18px 0 10px}a.button{display:inline-block;margin:12px 6px;padding:14px 22px;border-radius:7px;background:#e8b84c;color:#15120b;text-decoration:none;font-weight:bold}
a.secondary{background:#252525;color:#f5f2eb;border:1px solid #51452c}.description{max-width:620px;margin:18px auto}
.discovery{margin:46px auto 0;padding:28px 0;border-top:1px solid #343434;text-align:left}.discovery h2{font-size:24px;margin:0 0 18px}.discovery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:14px}.discovery-card{display:flex;flex-direction:column;overflow:hidden;border:1px solid #343434;border-radius:12px;background:#17181b;color:#f5f2eb;text-decoration:none}.discovery-card img{width:100%;aspect-ratio:1;object-fit:cover}.discovery-card span{display:flex;flex-direction:column;gap:5px;padding:10px}.discovery-card strong{font-size:14px}.discovery-card small{font-size:12px;color:#aaa}
@media(max-width:520px){.site-header{align-items:flex-start;flex-direction:column;gap:10px}.site-nav{gap:14px}main{padding:20px 14px}}
</style></head><body>
<header class="site-header"><a class="brand" href="/">PAYA <span>MUSIC UG</span></a><nav class="site-nav" aria-label="Main navigation"><a href="/">Home</a><a href="/#music">Music</a><a href="/#artists">Artists</a><a href="/advertise">Advertise</a></nav></header>
<main><section class="song-content">
<img class="cover" src="${safeImage}" alt="${safeTitle} cover artwork" width="600" height="600">
<h1>${safeTitle}</h1><p class="artist">${escapeHTML(artistName)}</p>
${song.genre ? '<p class="meta">Genre: ' + safeGenre + '</p>' : ''}
${song.country ? '<p class="meta">Country: ' + safeCountry + '</p>' : ''}
${song.description ? '<p class="description">' + safeDescription + '</p>' : '<p class="description">Listen to ' + escapeHTML(songTitle) + ' by ' + escapeHTML(artistName) + ' on Paya Music UG, an international music discovery platform.</p>'}
<audio controls preload="none" src="${safeAudioUrl}">Your browser does not support audio playback.</audio>
<div><a class="button" href="${safeDownloadUrl}" target="payaSongDownloadFrame" rel="nofollow" aria-label="Download ${safeTitle} MP3">Download MP3</a><a class="button secondary" href="/">Explore more music</a></div>
</main></body></html>`);
  } catch (error) {
    console.error("Song SEO page error:", error);
    res.status(500).send("Could not load song page");
  }
});

// MY SONGS
app.get("/api/my-songs", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("songs")
      .select("*")
      .eq("uploader_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const songs = data || [];
    if (songs.length) {
      const ids = songs.map((song) => song.id);
      const [playCounts, downloadCounts] = await Promise.all([
        getSongEventCounts("song_plays", ids),
        getSongEventCounts("song_downloads", ids)
      ]);
      for (const song of songs) {
        song.play_count = playCounts.get(song.id) || 0;
        song.download_count = downloadCounts.get(song.id) || 0;
      }
    }

    res.json({ songs });
  } catch (error) {
    res.status(500).json({
      error: "Could not load your songs"
    });
  }
});

// ARTISTS: EDIT ONLY THEIR OWN SONG DETAILS
app.patch("/api/my-songs/:id", auth, admin, async (req, res) => {
  try {
    const { title, artist, genre, description, country } = req.body || {};
    const updates = {};
    if (typeof title === "string") updates.title = title.trim().slice(0, 120);
    if (typeof artist === "string") updates.artist = artist.trim().slice(0, 120);
    if (typeof genre === "string") updates.genre = genre.trim().slice(0, 60);
    if (typeof country === "string") updates.country = country.trim().slice(0, 80);
    if (typeof description === "string") updates.description = description.trim().slice(0, 500);
    if (!updates.title || !updates.artist) {
      return res.status(400).json({ error: "Song title and artist are required" });
    }
    const { data, error } = await supabase.from("songs")
      .update(updates)
      .eq("id", req.params.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Song not found in your account" });
    res.json({ song: data });
  } catch (error) {
    console.error("Artist song edit failed:", error);
    res.status(500).json({ error: "Could not update your song" });
  }
});

// ADMIN/OWNER: CHANGE SONG ARTWORK WITHOUT RE-UPLOADING THE AUDIO
app.patch("/api/admin/songs/:id/artwork", auth, songAssetManager, imageUpload.single("cover_image"), async (req, res) => {
  let uploadedPath = null;
  try {
    if (!req.file) return res.status(400).json({ error: "Please choose a JPG, PNG, or WEBP artwork image." });
    const { data: song, error: songLookupError } = await supabase
      .from("songs")
      .select("id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (songLookupError) throw songLookupError;
    if (!song) return res.status(404).json({ error: "Song not found." });

    const ext = req.file.mimetype === "image/png" ? "png" : req.file.mimetype === "image/webp" ? "webp" : "jpg";
    uploadedPath = "song-covers/" + req.params.id + "-" + Date.now() + "." + ext;
    const { error: uploadError } = await supabase.storage.from(IMAGE_BUCKET).upload(uploadedPath, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: false
    });
    if (uploadError) throw uploadError;

    const cover_url = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(uploadedPath).data.publicUrl;
    const { data, error } = await supabase
      .from("songs")
      .update({ cover_url })
      .eq("id", req.params.id)
      .select("id, title, artist, cover_url")
      .single();
    if (error) throw error;
    res.json({ message: "Song artwork updated successfully.", song: data });
  } catch (error) {
    if (uploadedPath) await supabase.storage.from(IMAGE_BUCKET).remove([uploadedPath]).catch(() => {});
    console.error("Song artwork update failed:", error);
    res.status(500).json({ error: "Could not update song artwork. Please try again." });
  }
});
// ADMIN: PENDING SONGS
app.get("/api/admin/songs", auth, admin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("songs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.json({ songs: data || [] });
  } catch (error) {
    res.status(500).json({
      error: "Could not load pending songs"
    });
  }
});

// APPROVE OR REJECT SONG
app.patch("/api/admin/songs/:id", auth, admin, async (req, res) => {
  try {
    const { status } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        error: "Invalid song status"
      });
    }

    const { data, error } = await supabase
      .from("songs")
      .update({ status })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ song: data });
  } catch (error) {
    res.status(500).json({
      error: "Song review failed"
    });
  }
});

// OWNER/ADMIN: DELETE A SONG
app.delete("/api/admin/songs/:id", auth, songAssetManager, async (req, res) => {
  try {
    const { data, error } = await supabase.from("songs").delete().eq("id", req.params.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Song not found" });
    res.json({ deleted: true, id: data.id });
  } catch (error) {
    console.error("Song deletion failed:", error);
    res.status(500).json({ error: "Could not delete song" });
  }
});

// Record a successful song play for the Most Played chart.
app.post("/api/songs/:id/play", async (req, res) => {
  try {
    const songId = Number(req.params.id);
    if (!Number.isInteger(songId)) return res.status(400).json({ error: "Invalid song" });
    const { data: song, error: songError } = await supabase.from("songs").select("id").eq("id", songId).eq("status", "approved").maybeSingle();
    if (songError || !song) return res.status(404).json({ error: "Song not found" });
    const { error } = await supabase.from("song_plays").insert({ song_id: songId });
    if (error) throw error;
    res.status(201).json({ recorded: true });
  } catch (error) {
    console.error("Song play count error:", error);
    res.status(500).json({ error: "Could not record play" });
  }
});
// STREAM OR DOWNLOAD SONG
app.get("/api/songs/:id/:action", async (req, res) => {
  try {
    const { id, action } = req.params;

    if (!["stream", "download"].includes(action)) {
      return res.status(400).json({
        error: "Invalid action"
      });
    }

    const { data: song, error } = await supabase
      .from("songs")
      .select("filename, original_name, mime_type, title, artist, cover_url")
      .eq("id", id)
      .eq("status", "approved")
      .single();

    if (error || !song) {
      return res.status(404).json({
        error: "Song not found"
      });
    }

    const { data, error: storageError } = await supabase.storage
      .from(MUSIC_BUCKET)
      .createSignedUrl(song.filename, 300, { download: false });

    if (storageError || !data?.signedUrl) {
      return res.status(500).json({ error: "Could not access audio file" });
    }

    if (action === "download") {
      const audioResponse = await fetch(data.signedUrl);
      if (!audioResponse.ok) return res.status(502).json({ error: "Could not retrieve audio file" });
      const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
      let downloadBuffer = audioBuffer;

      // Embed uploaded artwork as the MP3 ID3 front-cover image.
      if (song.cover_url && ffmpegPath) {
        try {
          const coverResponse = await fetch(song.cover_url);
          if (coverResponse.ok) {
            const coverBuffer = Buffer.from(await coverResponse.arrayBuffer());
            if (coverBuffer.length) {
              downloadBuffer = await new Promise((resolve, reject) => {
                const ffmpeg = spawn(ffmpegPath, [
                  "-hide_banner", "-loglevel", "error",
                  "-i", "pipe:0", "-i", "pipe:3",
                  "-map", "0:a:0", "-map", "1:v:0",
                  "-c:a", "copy", "-c:v", "mjpeg",
                  "-disposition:v:0", "attached_pic",
                  "-metadata", "title=" + String(song.title || "Song"),
                  "-metadata", "artist=" + String(song.artist || "Artist"),
                  "-metadata:s:v", "title=Album cover",
                  "-metadata:s:v", "comment=Cover (front)",
                  "-id3v2_version", "3", "-f", "mp3", "pipe:1"
                ], { stdio: ["pipe", "pipe", "pipe", "pipe"] });
                const output = [];
                const errors = [];
                ffmpeg.stdout.on("data", chunk => output.push(chunk));
                ffmpeg.stderr.on("data", chunk => errors.push(chunk));
                ffmpeg.on("error", reject);
                ffmpeg.on("close", code => {
                  if (code === 0 && output.length) resolve(Buffer.concat(output));
                  else reject(new Error(Buffer.concat(errors).toString("utf8").slice(0, 500) || "Could not embed cover artwork"));
                });
                ffmpeg.stdin.on("error", () => {});
                ffmpeg.stdio[3].on("error", () => {});
                ffmpeg.stdin.end(audioBuffer);
                ffmpeg.stdio[3].end(coverBuffer);
              });
            }
          }
        } catch (coverError) {
          console.warn("Could not embed song cover; sending original audio:", coverError.message);
          downloadBuffer = audioBuffer;
        }
      }

      const safeBaseName = (String(song.title || "Song") + " - " + String(song.artist || "Artist") + " - Paya Music UG")
        .replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
      res.set({
        "Content-Type": "audio/mpeg",
        "Content-Length": String(downloadBuffer.length),
        "Content-Disposition": 'attachment; filename="' + safeBaseName + '.mp3"',
        "Cache-Control": "private, no-store"
      });

      const { error: countError } = await supabase.from("song_downloads").insert({ song_id: Number(id) });
      if (countError) console.error("Song download count error:", countError.message);
      return res.status(200).send(downloadBuffer);
    }

    const headers = {};

    if (req.headers.range) {
      headers.Range = req.headers.range;
    }

    const audioResponse = await fetch(data.signedUrl, { headers });

    if (!audioResponse.ok && audioResponse.status !== 206) {
      return res.status(502).json({
        error: "Audio file could not be streamed"
      });
    }

    res.status(audioResponse.status);
    res.setHeader("Content-Type", song.mime_type || "audio/mpeg");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");

    const contentLength = audioResponse.headers.get("content-length");
    const contentRange = audioResponse.headers.get("content-range");

    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    if (contentRange) {
      res.setHeader("Content-Range", contentRange);
    }

    if (!audioResponse.body) {
      return res.status(502).end("Audio response is empty");
    }

    Readable.fromWeb(audioResponse.body).pipe(res);
  } catch (error) {
    console.error("Song streaming error:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Song unavailable"
      });
    }
  }
});

// PUBLIC SONG LIKES
app.post("/api/songs/:id/like", async (req, res) => {
  try {
    const songId = Number(req.params.id);
    const visitorKey = String(req.body.visitor_key || "");

    if (
      !Number.isInteger(songId) ||
      visitorKey.length < 10 ||
      visitorKey.length > 100
    ) {
      return res.status(400).json({
        error: "Invalid like request"
      });
    }

    const { data: song } = await supabase
      .from("songs")
      .select("id")
      .eq("id", songId)
      .eq("status", "approved")
      .maybeSingle();

    if (!song) {
      return res.status(404).json({
        error: "Song not found"
      });
    }

    const { data: existing } = await supabase
      .from("song_likes")
      .select("id")
      .eq("song_id", songId)
      .eq("visitor_key", visitorKey)
      .maybeSingle();

    // Likes are permanent per visitor and song: tapping Like again must
    // never remove an existing like or reduce the public like count.
    if (!existing) {
      const { error } = await supabase
        .from("song_likes")
        .insert({
          song_id: songId,
          visitor_key: visitorKey
        });

      if (error) throw error;
    }

    const { count, error: countError } = await supabase
      .from("song_likes")
      .select("*", { count: "exact", head: true })
      .eq("song_id", songId);

    if (countError) throw countError;

    res.json({
      liked: true,
      likes: count || 0
    });
  } catch (error) {
    console.error("Like action error:", error);
    res.status(500).json({
      error: "Like action failed"
    });
  }
});


// PAYA REVENUE REQUESTS: public enquiries, owner-managed manually (no online payment is claimed).
app.post("/api/revenue-requests", async (req, res) => {
  try {
    const { service_type, customer_name, contact_email, contact_whatsapp, details } = req.body || {};
    const allowed = ["advertising", "featured_artist", "music_promotion", "sponsored_news"];
    if (!allowed.includes(service_type) || !String(customer_name || "").trim() || !String(contact_email || "").trim()) {
      return res.status(400).json({ error: "Choose a service and enter your name and email." });
    }
    const { data, error } = await supabase.from("revenue_requests").insert({
      service_type,
      customer_name: String(customer_name).trim().slice(0, 120),
      contact_email: String(contact_email).trim().slice(0, 200),
      contact_whatsapp: String(contact_whatsapp || "").trim().slice(0, 40),
      details: String(details || "").trim().slice(0, 2000),
      status: "new"
    }).select("id, service_type, status, created_at").single();
    if (error) throw error;
    res.status(201).json({ message: "Your request has been sent to Paya Music UG. We will contact you to discuss the package and price.", request: data });
  } catch (error) {
    console.error("Revenue request error:", error.message);
    res.status(500).json({ error: "Could not send your request. Please try again." });
  }
});

// OWNER: view and update revenue enquiries and manually verified payment status.
app.get("/api/owner/revenue-requests", auth, paymentManager, async (req, res) => {
  const { data, error } = await supabase.from("revenue_requests").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: "Could not load revenue requests. Check the revenue_requests database setup." });
  res.json({ requests: data || [] });
});

app.patch("/api/owner/revenue-requests/:id", auth, paymentManager, async (req, res) => {
  const allowed = ["new", "contacted", "paid", "completed", "rejected"];
  const status = String(req.body.status || "");
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid request status." });
  const updates = { status, updated_at: new Date().toISOString() };
  if (typeof req.body.owner_note === "string") updates.owner_note = req.body.owner_note.trim().slice(0, 1000);
  if (typeof req.body.amount_agreed === "number" && Number.isFinite(req.body.amount_agreed) && req.body.amount_agreed >= 0) updates.amount_agreed = req.body.amount_agreed;
  if (typeof req.body.payment_reference === "string") updates.payment_reference = req.body.payment_reference.trim().slice(0, 120);
  const { data, error } = await supabase.from("revenue_requests").update(updates).eq("id", req.params.id).select().single();
  if (error || !data) return res.status(500).json({ error: "Could not update this request." });
  res.json({ request: data });
});


/* PAYMENT METHODS: owner-managed manual payment instructions. */
app.get("/api/payment-methods", async (req, res) => {
  try {
    const { data, error } = await supabase.from("payment_methods")
      .select("id, method_code, display_name, country, account_name, account_number, instructions, sort_order")
      .eq("is_enabled", true).eq("is_published", true)
      .order("sort_order", { ascending: true }).order("display_name", { ascending: true });
    if (error) throw error;
    res.set("Cache-Control", "public, max-age=60");
    res.json({ methods: data || [] });
  } catch (error) {
    console.error("Public payment methods error:", error.message);
    res.status(500).json({ error: "Could not load payment methods." });
  }
});

app.get("/api/owner/payment-methods", auth, paymentManager, async (req, res) => {
  const { data, error } = await supabase.from("payment_methods").select("*")
    .order("sort_order", { ascending: true }).order("display_name", { ascending: true });
  if (error) return res.status(500).json({ error: "Could not load payment settings. Check the payment_methods table." });
  res.json({ methods: data || [] });
});

app.post("/api/owner/payment-methods", auth, paymentManager, async (req, res) => {
  try {
    const body = req.body || {};
    const method_code = String(body.method_code || "").trim().toLowerCase().slice(0, 60);
    const display_name = String(body.display_name || "").trim().slice(0, 100);
    if (!/^[a-z0-9_]+$/.test(method_code) || !display_name) {
      return res.status(400).json({ error: "Choose a payment method and enter its public name." });
    }
    const record = {
      method_code,
      display_name,
      country: String(body.country || "").trim().slice(0, 80),
      account_name: String(body.account_name || "").trim().slice(0, 120),
      account_number: String(body.account_number || "").trim().slice(0, 120),
      instructions: String(body.instructions || "").trim().slice(0, 1000),
      is_enabled: body.is_enabled === true,
      is_published: body.is_enabled === true && body.is_published === true,
      sort_order: Number.isFinite(Number(body.sort_order)) ? Math.max(0, Math.min(9999, Number(body.sort_order))) : 0,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from("payment_methods")
      .upsert(record, { onConflict: "method_code" }).select().single();
    if (error) throw error;
    res.json({ message: "Payment method saved.", method: data });
  } catch (error) {
    console.error("Payment method save error:", error.message);
    res.status(500).json({ error: "Could not save this payment method." });
  }
});

app.patch("/api/owner/payment-methods/:id", auth, paymentManager, async (req, res) => {
  try {
    const body = req.body || {};
    const updates = { updated_at: new Date().toISOString() };
    if (typeof body.method_code === "string" && /^[a-z0-9_]+$/.test(body.method_code.trim())) updates.method_code = body.method_code.trim().slice(0, 60);
    if (typeof body.is_enabled === "boolean") updates.is_enabled = body.is_enabled;
    if (typeof body.is_published === "boolean") updates.is_published = body.is_published && body.is_enabled !== false;
    if (typeof body.display_name === "string") updates.display_name = body.display_name.trim().slice(0, 100);
    if (typeof body.country === "string") updates.country = body.country.trim().slice(0, 80);
    if (typeof body.account_name === "string") updates.account_name = body.account_name.trim().slice(0, 120);
    if (typeof body.account_number === "string") updates.account_number = body.account_number.trim().slice(0, 120);
    if (typeof body.instructions === "string") updates.instructions = body.instructions.trim().slice(0, 1000);
    const { data, error } = await supabase.from("payment_methods").update(updates)
      .eq("id", req.params.id).select().single();
    if (error || !data) return res.status(404).json({ error: "Payment method not found or could not be updated." });
    res.json({ message: "Payment settings updated.", method: data });
  } catch (error) {
    console.error("Payment method update error:", error.message);
    res.status(500).json({ error: "Could not update this payment method." });
  }
});

// PUBLIC ADVERT SUBMISSION
app.post("/api/ads", async (req, res) => {
  try {
    const {
      business_name,
      title,
      description,
      image_url,
      target_url,
      placement,
      contact_email,
      contact_whatsapp
    } = req.body;

    if (
      !business_name ||
      !title ||
      !image_url ||
      !target_url ||
      !contact_email
    ) {
      return res.status(400).json({
        error: "Complete the required advert details"
      });
    }

    if (![image_url, target_url].every(value => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    })) {
      return res.status(400).json({
        error: "Links must use HTTPS"
      });
    }

    const { data, error } = await supabase
      .from("ads")
      .insert({
        business_name: String(business_name).slice(0, 120),
        title: String(title).slice(0, 120),
        description: String(description || "").slice(0, 500),
        image_url,
        target_url,
        placement: placement || "homepage",
        contact_email: String(contact_email).slice(0, 200),
        contact_whatsapp: String(contact_whatsapp || "").slice(0, 40),
        status: "approved"
      })
      .select("id, business_name, title, status")
      .single();

    if (error) throw error;

    res.status(201).json({
      message: "Advert published successfully.",
      advert: data
    });
  } catch (error) {
    console.error("Advert submission error:", error);
    res.status(500).json({
      error: "Advert submission failed"
    });
  }
});

// PUBLIC APPROVED ADVERTS
app.get("/api/ads", async (req, res) => {
  const { data, error } = await supabase
    .from("ads")
    .select("id, business_name, title, description, image_url, target_url, placement")
    .eq("status", "approved");

  if (error) {
    return res.status(500).json({
      error: "Could not load adverts"
    });
  }

  res.json({ ads: data || [] });
});

// ADMIN: PENDING ADVERTS
app.get("/api/admin/ads", auth, admin, async (req, res) => {
  const { data, error } = await supabase
    .from("ads")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    return res.status(500).json({
      error: "Could not load adverts"
    });
  }

  res.json({ ads: data || [] });
});

// ADMIN: REVIEW ADVERT
app.patch("/api/admin/ads/:id", auth, admin, async (req, res) => {
  const { status } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({
      error: "Invalid advert status"
    });
  }

  const { data, error } = await supabase
    .from("ads")
    .update({ status })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) {
    return res.status(500).json({
      error: "Advert review failed"
    });
  }

  res.json({ advert: data });
});

// ADMIN: PENDING PROFILE SUBMISSIONS
app.get("/api/admin/profiles", auth, admin, async (req, res) => {
  const { data, error } = await supabase.from("profile_submissions").select("*").eq("status", "pending").order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: "Could not load profile submissions" });
  res.json({ submissions: data || [] });
});

app.patch("/api/admin/profiles/:id", auth, admin, async (req, res) => {
  const status = req.body.status;
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "Invalid profile review status" });
  const { data: item, error: readError } = await supabase.from("profile_submissions").select("*").eq("id", req.params.id).eq("status", "pending").single();
  if (readError || !item) return res.status(404).json({ error: "Pending profile submission not found" });
  if (status === "approved") {
    const { error: updateError } = await supabase.from("users").update({ name: item.name, bio: item.bio, avatar_url: item.avatar_url }).eq("id", item.user_id);
    if (updateError) return res.status(500).json({ error: "Could not apply profile changes" });
  }
  const { data, error } = await supabase.from("profile_submissions").update({ status, reviewed_by: req.user.id, reviewed_at: new Date().toISOString() }).eq("id", item.id).select().single();
  if (error) return res.status(500).json({ error: "Could not save profile review" });
  res.json({ submission: data });
});

// PUBLIC NEWS
app.get("/api/news", async (req, res) => {
  const { data, error } = await supabase
    .from("news")
    .select("id, title, content, category, image_url, published_at, author_id")
    .eq("status", "published")
    .order("published_at", { ascending: false });

  if (error) {
    return res.status(500).json({
      error: "Could not load news"
    });
  }

  const authorIds = [...new Set((data || []).map((item) => item.author_id).filter(Boolean))];
  let authorNames = {};
  if (authorIds.length) {
    const { data: authors, error: authorsError } = await supabase
      .from("users")
      .select("id, name")
      .in("id", authorIds);
    if (!authorsError) {
      authorNames = Object.fromEntries((authors || []).map((author) => [String(author.id), author.name]));
    }
  }

  const news = (data || []).map((item) => ({
    ...item,
    author_name: item.author_id ? (authorNames[String(item.author_id)] || null) : null
  }));
  res.json({ news });
});


// SIGNED-IN COMMUNITY NEWS SUBMISSION — publish immediately.
// REGISTERED COMMUNITY MEMBERS MAY SUBMIT NEWS; OWNER/ADMIN APPROVAL REQUIRED.
app.post("/api/news", auth, async (req, res) => {
  try {
    const { title, content, category, image_url } = req.body || {};
    if (!String(title || "").trim() || !String(content || "").trim()) {
      return res.status(400).json({ error: "News headline and story are required." });
    }
    const { data, error } = await supabase.from("news").insert({
      title: String(title).trim().slice(0, 200),
      content: String(content).trim().slice(0, 10000),
      category: String(category || "music").slice(0, 40),
      image_url: image_url || null,
      status: "pending",
      author_id: req.user.id
    }).select().single();
    if (error) throw error;
    res.status(201).json({ message: "News submitted successfully and is awaiting owner/admin approval.", article: data });
  } catch (error) {
    console.error("Community news submission error:", error);
    res.status(500).json({ error: "Could not submit news. Please check your details and try again." });
  }
});

app.post("/api/news/image", auth, imageUpload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Please choose an image." });
    const extension = req.file.mimetype === "image/png" ? "png" : req.file.mimetype === "image/webp" ? "webp" : "jpg";
    const filename = `news/community-${req.user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(filename, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(filename);
    res.json({ image_url: data.publicUrl });
  } catch (error) {
    console.error("Community news image upload error:", error);
    res.status(500).json({ error: "Could not upload the news image." });
  }
});

app.get("/api/news/:id/comments", async (req, res) => {
  const { data, error } = await supabase.from("news_comments")
    .select("id, news_id, parent_id, name, body, created_at")
    .eq("news_id", String(req.params.id)).order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: "Comments are not configured yet. Please contact the site owner." });
  const ids = (data || []).map((item) => item.id);
  let reactions = [];
  if (ids.length) {
    const result = await supabase.from("news_comment_reactions").select("comment_id, reaction").in("comment_id", ids);
    if (result.error) return res.status(500).json({ error: "Could not load comment reactions." });
    reactions = result.data || [];
  }
  const counts = new Map();
  for (const item of reactions) {
    const key = String(item.comment_id);
    const count = counts.get(key) || { likes: 0, dislikes: 0 };
    count[item.reaction === "like" ? "likes" : "dislikes"] += 1;
    counts.set(key, count);
  }
  res.json({ comments: (data || []).map((item) => Object.assign({}, item, counts.get(String(item.id)) || { likes: 0, dislikes: 0 })) });
});

app.post("/api/news/:id/comments", async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 15);
  const body = String(req.body.body || "").trim().slice(0, 1500);
  const parentId = req.body.parent_id || null;
  if (!name || !body) return res.status(400).json({ error: "Enter your name and comment." });
  const { data: article, error: articleError } = await supabase.from("news")
    .select("id").eq("id", req.params.id).eq("status", "published").maybeSingle();
  if (articleError || !article) return res.status(404).json({ error: "News article not found." });
  if (parentId) {
    const { data: parent } = await supabase.from("news_comments").select("id, news_id").eq("id", parentId).maybeSingle();
    if (!parent || String(parent.news_id) !== String(req.params.id)) return res.status(400).json({ error: "Reply target not found." });
  }
  const { data, error } = await supabase.from("news_comments")
    .insert({ news_id: String(req.params.id), parent_id: parentId, name, body })
    .select("id, news_id, parent_id, name, body, created_at").single();
  if (error) return res.status(500).json({ error: "Could not post comment." });
  res.status(201).json({ comment: data });
});

app.post("/api/news/comments/:id/reaction", async (req, res) => {
  const reaction = req.body.reaction;
  const visitorKey = String(req.body.visitor_key || "").slice(0, 100);
  if (!["like", "dislike"].includes(reaction) || !visitorKey) return res.status(400).json({ error: "Invalid reaction." });
  const { error } = await supabase.from("news_comment_reactions")
    .upsert({ comment_id: req.params.id, visitor_key: visitorKey, reaction }, { onConflict: "comment_id,visitor_key" });
  if (error) return res.status(500).json({ error: "Could not save reaction." });
  res.json({ saved: true });
});

app.delete("/api/admin/news/comments/:id", auth, admin, async (req, res) => {
  const { error } = await supabase.from("news_comments").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "Could not delete comment." });
  res.json({ deleted: true });
});

// ADMIN: PENDING NEWS REVIEW
app.get("/api/admin/news", auth, newsModerator, async (req, res) => {
  const { data, error } = await supabase.from("news").select("*").eq("status", "pending").order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: "Could not load pending news" });
  res.json({ news: data || [] });
});

app.patch("/api/admin/news/:id", auth, newsModerator, async (req, res) => {
  const { status, title, content, category } = req.body || {};
  if (typeof title === "string" || typeof content === "string" || typeof category === "string") {
    const updates = {};
    if (typeof title === "string") updates.title = title.trim().slice(0, 200);
    if (typeof content === "string") updates.content = content.trim().slice(0, 10000);
    if (typeof category === "string") updates.category = category.trim().slice(0, 60) || "music";
    if (("title" in updates && !updates.title) || ("content" in updates && !updates.content)) return res.status(400).json({ error: "News title and story cannot be empty." });
    const { data, error } = await supabase.from("news").update(updates).eq("id", req.params.id).select().single();
    if (error || !data) return res.status(404).json({ error: "News article not found or could not be updated." });
    return res.json({ article: data, message: "News article updated." });
  }
  if (!["published", "rejected"].includes(status)) return res.status(400).json({ error: "Invalid news review status" });
  const { data, error } = await supabase.from("news").update({ status, published_at: status === "published" ? new Date().toISOString() : null }).eq("id", req.params.id).eq("status", "pending").select().single();
  if (error || !data) return res.status(404).json({ error: "Pending news article not found" });
  res.json({ article: data });
});


app.delete("/api/admin/news/:id", auth, newsModerator, async (req, res) => {
  try {
    // Remove discussion entries first so deletion also works where the
    // database does not cascade news-comment foreign keys.
    const { error: commentsError } = await supabase.from("news_comments").delete().eq("news_id", String(req.params.id));
    if (commentsError) throw commentsError;
    const { data, error } = await supabase.from("news").delete().eq("id", req.params.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "News article not found." });
    res.json({ deleted: true, id: data.id });
  } catch (error) {
    console.error("News deletion failed:", error);
    res.status(500).json({ error: "Could not delete news article." });
  }
});

// ADMIN: CREATE NEWS
app.post("/api/admin/news", auth, admin, async (req, res) => {
  const { title, content, category, image_url } = req.body;

  if (!title || !content) {
    return res.status(400).json({
      error: "Title and content are required"
    });
  }

  const { data, error } = await supabase
    .from("news")
    .insert({
      title: String(title).slice(0, 200),
      content: String(content).slice(0, 10000),
      category: category || "music",
      image_url: image_url || null,
      status: "published",
      author_id: req.user.id,
      published_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    console.error("News publishing database error:", error);
    return res.status(500).json({
      error: "News publishing failed"
    });
  }

  res.status(201).json({ message: "News published successfully.", article: data });
});

// ADMIN: UPLOAD NEWS PICTURE
app.post(
  "/api/admin/news/image",
  auth,
  admin,
  imageUpload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "Please choose an image"
        });
      }

      const extension =
        req.file.mimetype === "image/png"
          ? "png"
          : req.file.mimetype === "image/webp"
          ? "webp"
          : "jpg";

      const filename =
        `news/${req.user.id}-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(filename, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage
        .from(IMAGE_BUCKET)
        .getPublicUrl(filename);

      res.json({
        image_url: publicData.publicUrl
      });
    } catch (error) {
      console.error("News image upload error:", error);
      res.status(500).json({
        error: "News image upload failed"
      });
    }
  }
);

// TRACK WEBSITE EVENTS

// TRACK WEBSITE EVENTS
app.post("/api/events", async (req, res) => {
  try {
    const { event_type, song_id, visitor_key } = req.body;

    if (!["visit", "play", "download"].includes(event_type)) {
      return res.status(400).json({ error: "Invalid event" });
    }

    const { error } = await supabase.from("website_events").insert({
      event_type,
      song_id: song_id || null,
      visitor_key: String(visitor_key || "").slice(0, 100)
    });

    if (error) throw error;
    res.json({ recorded: true });
  } catch (error) {
    console.error("Event recording error:", error);
    res.status(500).json({ error: "Event recording failed" });
  }
});

// OWNER: CHANGE USER ROLE
app.patch("/api/owner/users/:id/role", auth, owner, async (req, res) => {
  try {
    const { role } = req.body;

    if (!["artist", "admin", "superadmin"].includes(role)) {
      return res.status(400).json({ error: "Choose artist, admin or superadmin" });
    }

    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({
        error: "You cannot change your own role"
      });
    }

    const { data, error } = await supabase
      .from("users")
      .update({ role })
      .eq("id", req.params.id)
      .neq("role", "owner")
      .select("id, name, email, role")
      .single();

    if (error || !data) {
      return res.status(404).json({
        error: "User not found or cannot be changed"
      });
    }

    res.json({ user: data });
  } catch (error) {
    res.status(500).json({ error: "Role update failed" });
  }
});

// MANAGEMENT: CLASSIFY MEMBER ACCOUNT TYPES WITHOUT CHANGING ADMIN ROLES
app.patch("/api/owner/users/:id/account-type", auth, managementViewer, async (req, res) => {
  try {
    const accountType = String(req.body.account_type || "").trim().toLowerCase();
    if (!["artist", "listener", "dj", "artist_dj", "unclassified"].includes(accountType)) {
      return res.status(400).json({ error: "Choose a valid account type." });
    }
    const { data, error } = await supabase.from("users")
      .update({ account_type: accountType })
      .eq("id", req.params.id)
      .neq("role", "owner")
      .select("id, name, email, role, account_type")
      .single();
    if (error || !data) return res.status(404).json({ error: "User not found or cannot be changed." });
    res.json({ user: data });
  } catch (error) {
    console.error("Account type update error:", error);
    res.status(500).json({ error: "Could not update account type." });
  }
});

// OWNER: VIEW USERS
app.get("/api/owner/stats", auth, managementViewer, async (req, res) => {
  try {
    const [users, artists, listeners, djs, artistDjs, unclassified, songs, news, ads] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("users").select("id", { count: "exact", head: true }).eq("account_type", "artist"),
      supabase.from("users").select("id", { count: "exact", head: true }).eq("account_type", "listener"),
      supabase.from("users").select("id", { count: "exact", head: true }).eq("account_type", "dj"),
      supabase.from("users").select("id", { count: "exact", head: true }).eq("account_type", "artist_dj"),
      supabase.from("users").select("id", { count: "exact", head: true }).eq("account_type", "unclassified"),
      supabase.from("songs").select("id", { count: "exact", head: true }),
      supabase.from("news").select("id", { count: "exact", head: true }).eq("status", "published"),
      supabase.from("ads").select("id", { count: "exact", head: true }).eq("status", "approved")
    ]);
    for (const result of [users, artists, listeners, djs, artistDjs, unclassified, songs, news, ads]) {
      if (result.error) throw result.error;
    }
    const visitorKeys = new Set();
    let totalVisits = 0;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from("website_events")
        .select("visitor_key").eq("event_type", "visit")
        .range(offset, offset + 999);
      if (error) throw error;
      totalVisits += (data || []).length;
      for (const row of data || []) if (row.visitor_key) visitorKeys.add(String(row.visitor_key));
      if (!data || data.length < 1000) break;
    }
    const uniqueVisitors = visitorKeys.size;
    res.json({
      registered_accounts: users.count || 0,
      artists: artists.count || 0,
      listeners: listeners.count || 0,
      djs: djs.count || 0,
      artist_djs: artistDjs.count || 0,
      unclassified: unclassified.count || 0,
      songs: songs.count || 0,
      published_news: news.count || 0,
      active_adverts: ads.count || 0,
      unique_visitors: uniqueVisitors,
      total_visits: totalVisits
    });
  } catch (error) {
    console.error("Owner stats error:", error);
    res.status(500).json({ error: "Could not load platform statistics." });
  }
});

app.get("/api/owner/users", auth, managementViewer, async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("id, name, email, role, account_type, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ error: "Could not load users" });
  }

  res.json({ users: data || [] });
});

// OWNER: EDIT ANY SONG IN THE CATALOGUE
app.get("/api/owner/songs", auth, managementViewer, async (req, res) => {
  try {
    let songs = [];
    const pageSize = 10;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from("songs")
        .select("id, title, artist, status, uploader_id, created_at")
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = data || [];
      songs.push(...page);
      if (page.length < pageSize) break;
    }
    res.json({ songs });
  } catch (error) {
    console.error("Owner catalogue load failed:", error);
    res.status(500).json({ error: "Could not load catalogue" });
  }
});

app.patch("/api/owner/songs/:id", auth, songCatalogueEditor, async (req, res) => {
  try {
    const { title, artist, country } = req.body || {};
    if (typeof title !== "string" || !title.trim() || typeof artist !== "string" || !artist.trim()) {
      return res.status(400).json({ error: "Song title and artist are required" });
    }
    const { data, error } = await supabase.from("songs")
      .update({ title: title.trim().slice(0, 120), artist: artist.trim().slice(0, 120), ...(typeof country === "string" ? { country: country.trim().slice(0, 80) } : {}) })
      .eq("id", req.params.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Song not found" });
    res.json({ song: data });
  } catch (error) {
    console.error("Owner song edit failed:", error);
    res.status(500).json({ error: "Could not update song" });
  }
});

// OWNER: CHANGE A REGISTERED ARTIST'S PROFILE NAME
app.patch("/api/owner/users/:id/name", auth, operationalAdmin, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: "Artist name is required" });
    const { data, error } = await supabase.from("users")
      .update({ name })
      .eq("id", req.params.id)
      .neq("role", "owner")
      .select("id, name, email, role")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "User not found or protected" });
    res.json({ user: data });
  } catch (error) {
    console.error("Owner artist name update failed:", error);
    res.status(500).json({ error: "Could not update artist name" });
  }
});

// ADMIN: ANALYTICS
app.get("/api/admin/analytics", auth, admin, async (req, res) => {
  try {
    const [visits, plays, downloads, songs, users] = await Promise.all([
      supabase.from("website_events")
        .select("*", { count: "exact", head: true })
        .eq("event_type", "visit"),

      supabase.from("website_events")
        .select("*", { count: "exact", head: true })
        .eq("event_type", "play"),

      supabase.from("website_events")
        .select("*", { count: "exact", head: true })
        .eq("event_type", "download"),

      supabase.from("songs")
        .select("*", { count: "exact", head: true }),

      supabase.from("users")
        .select("*", { count: "exact", head: true })
    ]);

    res.json({
      visits: visits.count || 0,
      plays: plays.count || 0,
      downloads: downloads.count || 0,
      songs: songs.count || 0,
      accounts: users.count || 0
    });
  } catch (error) {
    res.status(500).json({ error: "Analytics unavailable" });
  }
});

// START SERVER
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Paya Music UG running on port ${PORT}`);
});
  
