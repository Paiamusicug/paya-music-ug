
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");
const { Readable } = require("stream");

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

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(express.json({ limit: "2mb" }));
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
      .select("id, name, email, role, bio, avatar_url")
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
  if (!["admin", "owner"].includes(req.user.role)) {
    return res.status(403).json({
      error: "Admin access required"
    });
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
        bio: ""
      })
      .select("id, name, email, role, bio, avatar_url")
      .single();

    if (error) throw error;

    res.status(201).json({
      token: makeToken(user),
      user
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
    const { name, bio, avatar_url } = req.body;
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
    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", req.user.id)
      .select("id, name, email, role, bio, avatar_url")
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

// UPLOAD SONG
app.post("/api/songs", auth, upload.fields([{ name: "audio", maxCount: 1 }, { name: "cover_image", maxCount: 1 }]), async (req, res) => {
  try {
    const file = req.files?.audio?.[0] || null;
    const coverFile = req.files?.cover_image?.[0] || null;
    const { title, artist, genre, description } = req.body;

    if (
      !file ||
      !file.originalname.toLowerCase().endsWith(".mp3") ||
      file.mimetype !== "audio/mpeg"
    ) {
      return res.status(400).json({
        error: "Please upload an MP3 file"
      });
    }

    if (!title || !artist) {
      return res.status(400).json({
        error: "Song title and artist are required"
      });
    }

    const filename = `${Date.now()}-${req.user.id}.mp3`;
    let cover_url = null;
    let coverFilename = null;
    const { error: storageError } = await supabase.storage.from(MUSIC_BUCKET).upload(filename, file.buffer, { contentType: "audio/mpeg", upsert: false });
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
        title: title.slice(0, 120),
        cover_url,
        artist: artist.slice(0, 120),
        genre: (genre || "").slice(0, 60),
        description: (description || "").slice(0, 500),
        filename,
        original_name: file.originalname,
        mime_type: "audio/mpeg",
        size: file.size,
        uploader_id: req.user.id,
        status: "pending"
      })
      .select()
      .single();

    if (error) {
      await supabase.storage.from(MUSIC_BUCKET).remove([filename]);
      if (coverFilename) await supabase.storage.from(IMAGE_BUCKET).remove([coverFilename]);
      throw error;
    }

    res.status(201).json({
      message: "Song submitted for review",
      song: data
    });
  } catch (error) {
    console.error("Song upload error:", error);
    res.status(500).json({
      error: "Song upload failed"
    });
  }
});

// PUBLIC APPROVED SONGS
app.get("/api/songs", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim().slice(0, 100);
    let request = supabase
      .from("songs")
      .select("id, title, artist, genre, description, cover_url, created_at, uploader_id")
      .eq("status", "approved");
    if (query) {
      const safeQuery = query.replace(/[,%()]/g, " ").trim();
      if (safeQuery) request = request.or(`title.ilike.%${safeQuery}%,artist.ilike.%${safeQuery}%,genre.ilike.%${safeQuery}%`);
    }
    const { data, error } = await request.order("created_at", { ascending: false });

    if (error) throw error;

    let songs = data || [];
    const sort = String(req.query.sort || "newest");
    if (sort === "played" && songs.length) {
      const ids = songs.map((song) => song.id);
      const { data: plays, error: playsError } = await supabase
        .from("song_plays")
        .select("song_id")
        .in("song_id", ids);
      if (playsError) throw playsError;
      const counts = new Map();
      for (const play of plays || []) counts.set(play.song_id, (counts.get(play.song_id) || 0) + 1);
      songs = songs.map((song) => ({ ...song, play_count: counts.get(song.id) || 0 }))
        .sort((a, b) => b.play_count - a.play_count || new Date(b.created_at) - new Date(a.created_at));
    }
    if (songs.length) {
      const ids = songs.map((song) => song.id);
      const { data: likes, error: likesError } = await supabase.from("song_likes").select("song_id").in("song_id", ids);
      if (likesError) throw likesError;
      const counts = new Map();
      for (const like of likes || []) counts.set(like.song_id, (counts.get(like.song_id) || 0) + 1);
      songs = songs.map((song) => ({ ...song, likes: counts.get(song.id) || 0 }));
      if (sort === "liked") songs.sort((a, b) => b.likes - a.likes || new Date(b.created_at) - new Date(a.created_at));
    }
    res.json({ songs });
  } catch (error) {
    res.status(500).json({
      error: "Could not load songs"
    });
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

    res.json({ songs: data || [] });
  } catch (error) {
    res.status(500).json({
      error: "Could not load your songs"
    });
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
      .select("filename, original_name, mime_type, title, artist")
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
      .createSignedUrl(song.filename, 300, {
        download: action === "download"
          ? (String(song.title || "Song") + " - " + String(song.artist || "Artist") + " - Paya Music UG.mp3").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim()
          : false
      });

    if (storageError || !data?.signedUrl) {
      return res.status(500).json({
        error: "Could not access audio file"
      });
    }

    if (action === "download") {
      return res.redirect(data.signedUrl);
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

    if (existing) {
      const { error } = await supabase
        .from("song_likes")
        .delete()
        .eq("id", existing.id);

      if (error) throw error;
    } else {
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
      liked: !existing,
      likes: count || 0
    });
  } catch (error) {
    console.error("Like action error:", error);
    res.status(500).json({
      error: "Like action failed"
    });
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
        status: "pending"
      })
      .select("id, business_name, title, status")
      .single();

    if (error) throw error;

    res.status(201).json({
      message: "Advert submitted for review",
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
    .select("id, title, content, category, image_url, published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false });

  if (error) {
    return res.status(500).json({
      error: "Could not load news"
    });
  }

  res.json({ news: data || [] });
});

// ADMIN: PENDING NEWS REVIEW
app.get("/api/admin/news", auth, admin, async (req, res) => {
  const { data, error } = await supabase.from("news").select("*").eq("status", "pending").order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: "Could not load pending news" });
  res.json({ news: data || [] });
});

app.patch("/api/admin/news/:id", auth, admin, async (req, res) => {
  const status = req.body.status;
  if (!["published", "rejected"].includes(status)) return res.status(400).json({ error: "Invalid news review status" });
  const { data, error } = await supabase.from("news").update({ status, published_at: status === "published" ? new Date().toISOString() : null }).eq("id", req.params.id).eq("status", "pending").select().single();
  if (error || !data) return res.status(404).json({ error: "Pending news article not found" });
  res.json({ article: data });
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
      status: "pending",
      author_id: req.user.id,
      published_at: null
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({
      error: "News publishing failed"
    });
  }

  res.status(201).json({ message: "News submitted for approval.", article: data });
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

    if (!["artist", "admin"].includes(role)) {
      return res.status(400).json({ error: "Choose artist or admin" });
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

// OWNER: VIEW USERS
app.get("/api/owner/users", auth, owner, async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("id, name, email, role, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ error: "Could not load users" });
  }

  res.json({ users: data || [] });
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
  
