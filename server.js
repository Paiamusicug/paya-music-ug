
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is missing");
}

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

function makeToken(user) {
  return jwt.sign(
    { id: user.id },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

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
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

function admin(req, res, next) {
  if (!["admin", "owner"].includes(req.user.role)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

function owner(req, res, next) {
  if (req.user.role !== "owner") {
    return res.status(403).json({ error: "Owner access required" });
  }
  next();
}

// REGISTER
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password || password.length < 10) {
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
      return res.status(409).json({ error: "Email already registered" });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const { data: user, error } = await supabase
      .from("users")
      .insert({
        name: name.trim(),
        email: normalizedEmail,
        password_hash,
        role: "artist"
      })
      .select("id, name, email, role, bio, avatar_url")
      .single();

    if (error) throw error;

    res.status(201).json({
      token: makeToken(user),
      user
    });
  } catch (error) {
    res.status(500).json({ error: "Registration failed" });
  }
});

// LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (error || !user ||
        !(await bcrypt.compare(req.body.password || "", user.password_hash))) {
      return res.status(401).json({ error: "Incorrect email or password" });
    }

    delete user.password_hash;

    res.json({
      token: makeToken(user),
      user
    });
  } catch (error) {
    res.status(500).json({ error: "Login failed" });
  }
});

// CURRENT ACCOUNT
app.get("/api/me", auth, (req, res) => {
  res.json({ user: req.user });
});

// UPDATE ARTIST PROFILE
app.patch("/api/profile", auth, async (req, res) => {
  try {
    const { name, bio, avatar_url } = req.body;

    const updates = {};

    if (typeof name === "string") updates.name = name.trim().slice(0, 120);
    if (typeof bio === "string") updates.bio = bio.slice(0, 1000);

    if (typeof avatar_url === "string") {
      if (avatar_url && !/^https:\/\//i.test(avatar_url)) {
        return res.status(400).json({ error: "Avatar must use HTTPS" });
      }
      updates.avatar_url = avatar_url;
    }

    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", req.user.id)
      .select("id, name, email, role, bio, avatar_url")
      .single();

    if (error) throw error;
    res.json({ user: data });
  } catch (error) {
    res.status(500).json({ error: "Profile update failed" });
  }
});

// UPLOAD SONG
app.post("/api/songs", auth, upload.single("audio"), async (req, res) => {
  try {
    const file = req.file;
    const { title, artist, genre, description } = req.body;

    if (!file || !file.originalname.toLowerCase().endsWith(".mp3") ||
        file.mimetype !== "audio/mpeg") {
      return res.status(400).json({ error: "Please upload an MP3 file" });
    }

    if (!title || !artist) {
      return res.status(400).json({ error: "Song title and artist are required" });
    }

    const filename = `${Date.now()}-${req.user.id}.mp3`;

    const { error: storageError } = await supabase.storage
      .from("music")
      .upload(filename, file.buffer, {
        contentType: "audio/mpeg",
        upsert: false
      });

    if (storageError) throw storageError;

    const { data, error } = await supabase
      .from("songs")
      .insert({
        title: title.slice(0, 120),
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
      await supabase.storage.from("music").remove([filename]);
      throw error;
    }

    res.status(201).json({
      message: "Song submitted for review",
      song: data
    });
  } catch (error) {
    res.status(500).json({ error: "Song upload failed" });
  }
});

// PUBLIC APPROVED SONGS
app.get("/api/songs", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("songs")
      .select("id, title, artist, genre, description, created_at, uploader_id")
      .eq("status", "approved")
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ songs: data || [] });
  } catch (error) {
    res.status(500).json({ error: "Could not load songs" });
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
    res.status(500).json({ error: "Could not load your songs" });
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
    res.status(500).json({ error: "Could not load pending songs" });
  }
});

// APPROVE OR REJECT SONG
app.patch("/api/admin/songs/:id", auth, admin, async (req, res) => {
  try {
    const { status } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid song status" });
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
    res.status(500).json({ error: "Song review failed" });
  }
});

// STREAM OR DOWNLOAD SONG
app.get("/api/songs/:id/:action", async (req, res) => {
  try {
    const { id, action } = req.params;

    if (!["stream", "download"].includes(action)) {
      return res.status(400).json({ error: "Invalid action" });
    }

    const { data: song, error } = await supabase
      .from("songs")
      .select("filename, original_name, mime_type")
      .eq("id", id)
      .eq("status", "approved")
      .single();

    if (error || !song) {
      return res.status(404).json({ error: "Song not found" });
    }

    const { data, error: storageError } = await supabase.storage
      .from("music")
      .createSignedUrl(song.filename, 300, {
        download: action === "download"
      });

    if (storageError || !data?.signedUrl) {
      return res.status(500).json({ error: "Could not access audio file" });
    }

    // Keep the existing download behavior
    if (action === "download") {
      return res.redirect(data.signedUrl);
    }

    // Fetch audio for browser playback
    const headers = {};

    if (req.headers.range) {
      headers.Range = req.headers.range;
    }

    const audioResponse = await fetch(data.signedUrl, { headers });

    if (!audioResponse.ok && audioResponse.status !== 206) {
      return res.status(502).json({ error: "Audio file could not be streamed" });
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

    const { Readable } = require("stream");

    Readable.fromWeb(audioResponse.body).pipe(res);

  } catch (error) {
    console.error("Song streaming error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Song unavailable" });
    }
  }
});
app.get("/api/songs/:id/:action", async (req, res) => {
  try {
    const { id, action } = req.params;

    if (!["stream", "download"].includes(action)) {
      return res.status(400).json({ error: "Invalid action" });
    }

    const { data: song, error } = await supabase
      .from("songs")
      .select("filename, original_name, mime_type")
      .eq("id", id)
      .eq("status", "approved")
      .single();

    if (error || !song) {
      return res.status(404).json({ error: "Song not found" });
    }

    const { data, error: storageError } = await supabase.storage
      .from("music")
      .createSignedUrl(song.filename, 300, {
        download: action === "download"
      });

    if (storageError) throw storageError;
    res.redirect(data.signedUrl);
  } catch (error) {
    res.status(500).json({ error: "Song unavailable" });
  }
});
// PUBLIC SONG LIKES
app.post("/api/songs/:id/like", async (req, res) => {
  try {
    const songId = Number(req.params.id);
    const visitorKey = String(req.body.visitor_key || "");

    if (!Number.isInteger(songId) || visitorKey.length < 10 || visitorKey.length > 100) {
      return res.status(400).json({ error: "Invalid like request" });
    }

    const { data: song } = await supabase
      .from("songs")
      .select("id")
      .eq("id", songId)
      .eq("status", "approved")
      .maybeSingle();

    if (!song) return res.status(404).json({ error: "Song not found" });

    const { data: existing } = await supabase
      .from("song_likes")
      .select("id")
      .eq("song_id", songId)
      .eq("visitor_key", visitorKey)
      .maybeSingle();

    if (existing) {
      await supabase.from("song_likes").delete().eq("id", existing.id);
    } else {
      const { error } = await supabase.from("song_likes").insert({
        song_id: songId,
        visitor_key: visitorKey
      });
      if (error) throw error;
    }

    const { count } = await supabase
      .from("song_likes")
      .select("*", { count: "exact", head: true })
      .eq("song_id", songId);

    res.json({ liked: !existing, likes: count || 0 });
  } catch (error) {
    res.status(500).json({ error: "Like action failed" });
  }
});

// PUBLIC ADVERT SUBMISSION
app.post("/api/ads", async (req, res) => {
  try {
    const {
      business_name, title, description, image_url,
      target_url, placement, contact_email, contact_whatsapp
    } = req.body;

    if (!business_name || !title || !image_url || !target_url || !contact_email) {
      return res.status(400).json({ error: "Complete the required advert details" });
    }

    if (![image_url, target_url].every(value => {
      try { return new URL(value).protocol === "https:"; }
      catch { return false; }
    })) {
      return res.status(400).json({ error: "Links must use HTTPS" });
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
    res.status(201).json({ message: "Advert submitted for review", advert: data });
  } catch (error) {
    res.status(500).json({ error: "Advert submission failed" });
  }
});

// PUBLIC APPROVED ADVERTS
app.get("/api/ads", async (req, res) => {
  const { data, error } = await supabase
    .from("ads")
    .select("id, business_name, title, description, image_url, target_url, placement")
    .eq("status", "approved");

  if (error) return res.status(500).json({ error: "Could not load adverts" });
  res.json({ ads: data || [] });
});

// ADMIN: PENDING ADVERTS
app.get("/api/admin/ads", auth, admin, async (req, res) => {
  const { data, error } = await supabase
    .from("ads")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: "Could not load adverts" });
  res.json({ ads: data || [] });
});

// ADMIN: REVIEW ADVERT
app.patch("/api/admin/ads/:id", auth, admin, async (req, res) => {
  const { status } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid advert status" });
  }

  const { data, error } = await supabase
    .from("ads")
    .update({ status })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: "Advert review failed" });
  res.json({ advert: data });
});

// PUBLIC NEWS
app.get("/api/news", async (req, res) => {
  const { data, error } = await supabase
    .from("news")
    .select("id, title, content, category, image_url, published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false });

  if (error) return res.status(500).json({ error: "Could not load news" });
  res.json({ news: data || [] });
});

// ADMIN: CREATE NEWS
app.post("/api/admin/news", auth, admin, async (req, res) => {
  const { title, content, category, image_url } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: "Title and content are required" });
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

  if (error) return res.status(500).json({ error: "News publishing failed" });
  res.status(201).json({ article: data });
});

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
      return res.status(400).json({ error: "You cannot change your own role" });
    }

    const { data, error } = await supabase
      .from("users")
      .update({ role })
      .eq("id", req.params.id)
      .neq("role", "owner")
      .select("id, name, email, role")
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "User not found or cannot be changed" });
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

  if (error) return res.status(500).json({ error: "Could not load users" });
  res.json({ users: data || [] });
});

// ADMIN: ANALYTICS
app.get("/api/admin/analytics", auth, admin, async (req, res) => {
  try {
    const [visits, plays, downloads, songs, users] = await Promise.all([
      supabase.from("website_events").select("*", { count: "exact", head: true }).eq("event_type", "visit"),
      supabase.from("website_events").select("*", { count: "exact", head: true }).eq("event_type", "play"),
      supabase.from("website_events").select("*", { count: "exact", head: true }).eq("event_type", "download"),
      supabase.from("songs").select("*", { count: "exact", head: true }),
      supabase.from("users").select("*", { count: "exact", head: true })
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
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`Paya Music UG running on port ${PORT}`);
});

                          
