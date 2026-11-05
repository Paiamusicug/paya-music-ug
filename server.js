require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters.");
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const BUCKET = "music";

app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
app.use(express.json({ limit: "100kb" }));
app.use(express.static(require("path").join(__dirname, "public")));
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 180 }));
app.use("/api/auth/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 25 }));

function tokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET, { expiresIn: "7d" });
}
function auth(req, res, next) {
  const value = req.headers.authorization || "";
  try {
    if (!value.startsWith("Bearer ")) throw new Error("No token");
    req.user = jwt.verify(value.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Please sign in to continue." });
  }
}
function admin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required." });
  next();
}
function safeSong(row) {
  return {
    id: row.id, title: row.title, artist: row.artist, genre: row.genre || "",
    description: row.description || "", created_at: row.created_at
  };
}
function safeAd(row) {
  return {
    id: row.id, business_name: row.business_name, title: row.title,
    description: row.description || "", image_url: row.image_url,
    target_url: row.target_url, placement: row.placement,
    starts_at: row.starts_at, ends_at: row.ends_at, created_at: row.created_at
  };
}
async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!email || !password) return;
  const { data: existing, error: lookupError } = await supabase.from("users").select("id").eq("email", email).maybeSingle();
  if (lookupError) throw lookupError;
  if (!existing) {
    const password_hash = await bcrypt.hash(password, 12);
    const { error } = await supabase.from("users").insert({
      name: process.env.ADMIN_NAME || "Paya Music UG", email, password_hash, role: "admin"
    });
    if (error) throw error;
    console.log("Initial admin account created.");
  }
}

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || name.trim().length < 2 || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !password || password.length < 10) {
    return res.status(400).json({ error: "Enter a name, valid email and password of at least 10 characters." });
  }
  try {
    const password_hash = await bcrypt.hash(password, 12);
    const { data, error } = await supabase.from("users").insert({
      name: name.trim().slice(0, 80), email: email.trim().toLowerCase(), password_hash, role: "artist"
    }).select("id,name,role").single();
    if (error) throw error;
    const user = data;
    res.status(201).json({ token: tokenFor(user), user });
  } catch (e) {
    res.status(409).json({ error: "That email may already be registered." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String((req.body || {}).email || "").trim().toLowerCase();
    const password = String((req.body || {}).password || "");
    const { data: user, error } = await supabase.from("users").select("*").eq("email", email).maybeSingle();
    if (error) throw error;
    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    res.json({ token: tokenFor(user), user: { id: user.id, name: user.name, role: user.role } });
  } catch {
    res.status(500).json({ error: "Unable to sign in right now." });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith(".mp3") || file.mimetype !== "audio/mpeg") {
      return cb(new Error("Only MP3 audio files are accepted."));
    }
    cb(null, true);
  }
});

app.post("/api/songs", auth, (req, res) => {
  upload.single("audio")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed." });
    if (!req.file) return res.status(400).json({ error: "Choose an MP3 file." });
    const { title, artist, genre = "", description = "" } = req.body || {};
    if (!title || !artist || title.trim().length > 120 || artist.trim().length > 120) {
      return res.status(400).json({ error: "Song title and artist are required (maximum 120 characters each)." });
    }
    const path = `${req.user.id}/${crypto.randomUUID()}.mp3`;
    try {
      const { error: storageError } = await supabase.storage.from(BUCKET).upload(path, req.file.buffer, {
        contentType: "audio/mpeg", upsert: false
      });
      if (storageError) throw storageError;
      const { data, error } = await supabase.from("songs").insert({
        title: title.trim(), artist: artist.trim(), genre: String(genre).slice(0, 60),
        description: String(description).slice(0, 500), filename: path,
        original_name: req.file.originalname, mime_type: "audio/mpeg",
        size: req.file.size, uploader_id: req.user.id, status: "pending"
      }).select("id").single();
      if (error) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw error;
      }
      res.status(201).json({ message: "Song submitted for admin review.", id: data.id });
    } catch (e) {
      console.error("Song upload failed:", e.message);
      res.status(500).json({ error: "Song upload failed. Check the music storage bucket and try again." });
    }
  });
});

app.get("/api/songs", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 80);
    let query = supabase.from("songs").select("*").eq("status", "approved").order("id", { ascending: false }).limit(100);
    if (q) query = query.or(`title.ilike.%${q}%,artist.ilike.%${q}%,genre.ilike.%${q}%`);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data.map(safeSong));
  } catch {
    res.status(500).json({ error: "Could not load songs." });
  }
});

app.get("/api/songs/mine", auth, async (req, res) => {
  const { data, error } = await supabase.from("songs").select("*").eq("uploader_id", req.user.id).order("id", { ascending: false });
  if (error) return res.status(500).json({ error: "Could not load your submissions." });
  res.json(data.map(row => ({ ...safeSong(row), status: row.status })));
});

app.get("/api/admin/songs", auth, admin, async (_req, res) => {
  const { data, error } = await supabase.from("songs").select("*,users!songs_uploader_id_fkey(name)").eq("status", "pending").order("id");
  if (error) return res.status(500).json({ error: "Could not load pending songs." });
  res.json(data.map(row => ({ ...safeSong(row), status: row.status, uploader: row.users?.name || "Member" })));
});

app.post("/api/admin/songs/:id/:action", auth, admin, async (req, res) => {
  const { id, action } = req.params;
  if (!["approve", "reject"].includes(action)) return res.status(400).json({ error: "Invalid action." });
  const { data: song, error: findError } = await supabase.from("songs").select("*").eq("id", id).maybeSingle();
  if (findError) return res.status(500).json({ error: "Could not find song." });
  if (!song) return res.status(404).json({ error: "Song not found." });
  const { error } = await supabase.from("songs").update({ status: action === "approve" ? "approved" : "rejected" }).eq("id", id);
  if (error) return res.status(500).json({ error: "Could not update song." });
  if (action === "reject") await supabase.storage.from(BUCKET).remove([song.filename]);
  res.json({ message: `Song ${action}d.` });
});

async function deliverSong(req, res, mode) {
  try {
    const { data: song, error } = await supabase.from("songs").select("*").eq("id", req.params.id).eq("status", "approved").maybeSingle();
    if (error || !song) return res.status(404).json({ error: "Song not found." });
    const { data: file, error: fileError } = await supabase.storage.from(BUCKET).download(song.filename);
    if (fileError || !file) return res.status(404).json({ error: "Audio file unavailable." });
    const buffer = Buffer.from(await file.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Content-Disposition", `${mode === "download" ? "attachment" : "inline"}; filename="${encodeURIComponent(song.title)}.mp3"`);
    res.send(buffer);
  } catch {
    res.status(500).json({ error: "Unable to deliver this audio file." });
  }
}
app.get("/api/songs/:id/stream", (req, res) => deliverSong(req, res, "stream"));
app.get("/api/songs/:id/download", (req, res) => deliverSong(req, res, "download"));

app.post("/api/ads", auth, async (req, res) => {
  const { business_name, title, description = "", image_url, target_url,
    placement = "homepage", starts_at = null, ends_at = null } = req.body || {};
  const allowed = ["homepage", "music", "sidebar", "sponsored"];
  let image, target;
  try { image = new URL(String(image_url)); target = new URL(String(target_url)); }
  catch { return res.status(400).json({ error: "Enter valid image and destination URLs." }); }
  if (!["https:", "http:"].includes(image.protocol) || !["https:", "http:"].includes(target.protocol) ||
      !business_name || !title || String(business_name).length > 120 || String(title).length > 120 ||
      String(description).length > 500 || !allowed.includes(placement)) {
    return res.status(400).json({ error: "Complete the required advert details and choose valid URLs and placement." });
  }
  if (starts_at && ends_at && new Date(ends_at) <= new Date(starts_at)) {
    return res.status(400).json({ error: "Campaign end date must be after its start date." });
  }
  const { data, error } = await supabase.from("ads").insert({
    business_name: String(business_name).trim(), title: String(title).trim(),
    description: String(description).trim(), image_url: image.href, target_url: target.href,
    placement, starts_at: starts_at || null, ends_at: ends_at || null,
    submitted_by: req.user.id, status: "pending"
  }).select("id").single();
  if (error) return res.status(500).json({ error: "Could not submit advert." });
  res.status(201).json({ message: "Advert submitted for Paya Music UG approval.", id: data.id });
});

app.get("/api/ads", async (req, res) => {
  const now = new Date().toISOString();
  const placement = String(req.query.placement || "homepage");
  const { data, error } = await supabase.from("ads").select("*").eq("status", "approved")
    .eq("placement", placement).or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`).order("id", { ascending: false }).limit(12);
  if (error) return res.status(500).json({ error: "Could not load adverts." });
  res.json(data.map(safeAd));
});

app.get("/api/ads/mine", auth, async (req, res) => {
  const { data, error } = await supabase.from("ads").select("*").eq("submitted_by", req.user.id).order("id", { ascending: false });
  if (error) return res.status(500).json({ error: "Could not load your adverts." });
  res.json(data.map(row => ({ ...safeAd(row), status: row.status })));
});

app.get("/api/admin/ads", auth, admin, async (_req, res) => {
  const { data, error } = await supabase.from("ads").select("*,users!ads_submitted_by_fkey(name)").eq("status", "pending").order("id");
  if (error) return res.status(500).json({ error: "Could not load pending adverts." });
  res.json(data.map(row => ({ ...safeAd(row), status: row.status, submitter: row.users?.name || "Member" })));
});

app.post("/api/admin/ads/:id/:action", auth, admin, async (req, res) => {
  const { id, action } = req.params;
  if (!["approve", "reject"].includes(action)) return res.status(400).json({ error: "Invalid action." });
  const { data: ad, error: findError } = await supabase.from("ads").select("id").eq("id", id).maybeSingle();
  if (findError || !ad) return res.status(404).json({ error: "Advert not found." });
  const { error } = await supabase.from("ads").update({ status: action === "approve" ? "approved" : "rejected" }).eq("id", id);
  if (error) return res.status(500).json({ error: "Could not update advert." });
  res.json({ message: `Advert ${action}d.` });
});

app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(400).json({ error: err.message || "Something went wrong." });
});

seedAdmin().then(() => {
  app.listen(PORT, () => console.log(`Paya Music UG listening on port ${PORT}`));
}).catch(err => {
  console.error("Startup failed:", err.message);
  process.exit(1);
});
  
