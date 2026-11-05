require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error("Set JWT_SECRET in .env to a random value of at least 32 characters.");
  process.exit(1);
}

const DATA = path.join(__dirname, "data");
const UPLOADS = path.join(__dirname, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
const db = new Database(path.join(DATA, "paya.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'artist',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  image_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  placement TEXT NOT NULL DEFAULT 'homepage',
  starts_at TEXT,
  ends_at TEXT,
  submitted_by INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(submitted_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  genre TEXT DEFAULT '',
  description TEXT DEFAULT '',
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploader_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(uploader_id) REFERENCES users(id)
);
`);

const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "";
if (adminEmail && adminPassword) {
  const existing = db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail);
  if (!existing) {
    const hash = bcrypt.hashSync(adminPassword, 12);
    db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')")
      .run(process.env.ADMIN_NAME || "Paya Music UG", adminEmail, hash);
    console.log("Initial admin account created.");
  }
}

app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 180 }));
app.use("/api/auth/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 25 }));

function tokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET, { expiresIn: "7d" });
}
function auth(req, res, next) {
  const value = req.headers.authorization || "";
  const token = value.startsWith("Bearer ") ? value.slice(7) : "";
  try {
    req.user = jwt.verify(token, SECRET);
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
    id: row.id, title: row.title, artist: row.artist, genre: row.genre,
    description: row.description, created_at: row.created_at
  };
}

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || name.trim().length < 2 || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !password || password.length < 10) {
    return res.status(400).json({ error: "Enter a name, valid email and password of at least 10 characters." });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)")
      .run(name.trim().slice(0, 80), email.trim().toLowerCase(), hash);
    const user = { id: result.lastInsertRowid, name: name.trim(), role: "artist" };
    res.status(201).json({ token: tokenFor(user), user });
  } catch {
    res.status(409).json({ error: "That email may already be registered." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(String(email || "").trim().toLowerCase());
  if (!user || !await bcrypt.compare(String(password || ""), user.password_hash)) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  res.json({ token: tokenFor(user), user: { id: user.id, name: user.name, role: user.role } });
});

const maxBytes = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 25)) * 1024 * 1024;
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase())
});
const upload = multer({
  storage, limits: { fileSize: maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".mp3" || !["audio/mpeg", "audio/mp3", "audio/x-mpeg"].includes(file.mimetype)) {
      return cb(new Error("Only MP3 audio files are accepted."));
    }
    cb(null, true);
  }
});

app.post("/api/songs", auth, (req, res) => {
  upload.single("audio")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed." });
    if (!req.file) return res.status(400).json({ error: "Choose an MP3 file." });
    const { title, artist, genre = "", description = "" } = req.body;
    if (!title || !artist || title.trim().length > 120 || artist.trim().length > 120) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Song title and artist are required (maximum 120 characters each)." });
    }
    const result = db.prepare(`INSERT INTO songs
      (title,artist,genre,description,filename,original_name,mime_type,size,uploader_id,status)
      VALUES(?,?,?,?,?,?,?,?,?,'pending')`)
      .run(title.trim(), artist.trim(), String(genre).slice(0,60), String(description).slice(0,500),
        req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.id);
    res.status(201).json({ message: "Song submitted for admin review.", id: result.lastInsertRowid });
  });
});

app.get("/api/songs", (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 80);
  const rows = q
    ? db.prepare(`SELECT * FROM songs WHERE status='approved' AND (title LIKE ? OR artist LIKE ? OR genre LIKE ?) ORDER BY id DESC LIMIT 100`)
        .all(`%${q}%`, `%${q}%`, `%${q}%`)
    : db.prepare("SELECT * FROM songs WHERE status='approved' ORDER BY id DESC LIMIT 100").all();
  res.json(rows.map(safeSong));
});
app.get("/api/songs/mine", auth, (req, res) => {
  const rows = db.prepare("SELECT * FROM songs WHERE uploader_id=? ORDER BY id DESC").all(req.user.id);
  res.json(rows.map(row => ({ ...safeSong(row), status: row.status })));
});
app.get("/api/admin/songs", auth, admin, (_req, res) => {
  const rows = db.prepare(`SELECT songs.*, users.name AS uploader FROM songs JOIN users ON users.id=songs.uploader_id
    WHERE songs.status='pending' ORDER BY songs.id ASC`).all();
  res.json(rows.map(row => ({ ...safeSong(row), status: row.status, uploader: row.uploader })));
});
app.post("/api/admin/songs/:id/:action", auth, admin, (req, res) => {
  const { id, action } = req.params;
  if (!["approve", "reject"].includes(action)) return res.status(400).json({ error: "Invalid action." });
  const song = db.prepare("SELECT * FROM songs WHERE id=?").get(id);
  if (!song) return res.status(404).json({ error: "Song not found." });
  if (action === "approve") db.prepare("UPDATE songs SET status='approved' WHERE id=?").run(id);
  else {
    db.prepare("UPDATE songs SET status='rejected' WHERE id=?").run(id);
    const file = path.join(UPLOADS, song.filename);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  res.json({ message: `Song ${action}d.` });
});

function deliverSong(req, res, mode) {
  const song = db.prepare("SELECT * FROM songs WHERE id=? AND status='approved'").get(req.params.id);
  if (!song) return res.status(404).json({ error: "Song not found." });
  const file = path.join(UPLOADS, path.basename(song.filename));
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Audio file unavailable." });
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Length", song.size);
  res.setHeader("Content-Disposition", `${mode === "download" ? "attachment" : "inline"}; filename="${encodeURIComponent(song.title)}.mp3"`);
  fs.createReadStream(file).pipe(res);
}
app.get("/api/songs/:id/stream", (req, res) => deliverSong(req, res, "stream"));
app.get("/api/songs/:id/download", (req, res) => deliverSong(req, res, "download"));


// Advertising marketplace: all logged-in members may submit campaigns;
// only administrators can approve or reject them.
function safeAd(row) {
  return {
    id: row.id, business_name: row.business_name, title: row.title,
    description: row.description, image_url: row.image_url,
    target_url: row.target_url, placement: row.placement,
    starts_at: row.starts_at, ends_at: row.ends_at, created_at: row.created_at
  };
}
app.post("/api/ads", auth, (req, res) => {
  const { business_name, title, description = "", image_url, target_url,
          placement = "homepage", starts_at = "", ends_at = "" } = req.body || {};
  const allowedPlacements = ["homepage", "music", "sidebar", "sponsored"];
  let image, target;
  try { image = new URL(String(image_url)); target = new URL(String(target_url)); }
  catch { return res.status(400).json({ error: "Enter valid image and destination URLs." }); }
  if (!["https:", "http:"].includes(image.protocol) || !["https:", "http:"].includes(target.protocol))
    return res.status(400).json({ error: "Only HTTP or HTTPS advert links are accepted." });
  if (!business_name || !title || !image_url || !target_url ||
      String(business_name).length > 120 || String(title).length > 120 ||
      String(description).length > 500 || !allowedPlacements.includes(placement)) {
    return res.status(400).json({ error: "Complete the required advert details and choose a valid placement." });
  }
  if (starts_at && ends_at && new Date(ends_at) <= new Date(starts_at))
    return res.status(400).json({ error: "Campaign end date must be after its start date." });
  const result = db.prepare(`INSERT INTO ads
    (business_name,title,description,image_url,target_url,placement,starts_at,ends_at,submitted_by,status)
    VALUES(?,?,?,?,?,?,?,?,?,'pending')`)
    .run(String(business_name).trim(), String(title).trim(), String(description).trim(),
      image.href, target.href, placement, starts_at || null, ends_at || null, req.user.id);
  res.status(201).json({ message: "Advert submitted for Paya Music UG approval.", id: result.lastInsertRowid });
});
app.get("/api/ads", (req, res) => {
  const placement = String(req.query.placement || "homepage");
  const rows = db.prepare(`SELECT * FROM ads WHERE status='approved'
    AND placement=? AND (starts_at IS NULL OR starts_at<=date('now'))
    AND (ends_at IS NULL OR ends_at>=date('now'))
    ORDER BY id DESC LIMIT 12`).all(placement);
  res.json(rows.map(safeAd));
});
app.get("/api/ads/mine", auth, (req, res) => {
  const rows = db.prepare("SELECT * FROM ads WHERE submitted_by=? ORDER BY id DESC").all(req.user.id);
  res.json(rows.map(row => ({ ...safeAd(row), status: row.status })));
});
app.get("/api/admin/ads", auth, admin, (_req, res) => {
  const rows = db.prepare(`SELECT ads.*, users.name AS submitter FROM ads
    JOIN users ON users.id=ads.submitted_by WHERE ads.status='pending' ORDER BY ads.id ASC`).all();
  res.json(rows.map(row => ({ ...safeAd(row), status: row.status, submitter: row.submitter })));
});
app.post("/api/admin/ads/:id/:action", auth, admin, (req, res) => {
  const { id, action } = req.params;
  if (!["approve", "reject"].includes(action)) return res.status(400).json({ error: "Invalid action." });
  const ad = db.prepare("SELECT id FROM ads WHERE id=?").get(id);
  if (!ad) return res.status(404).json({ error: "Advert not found." });
  db.prepare("UPDATE ads SET status=? WHERE id=?").run(action === "approve" ? "approved" : "rejected", id);
  res.json({ message: `Advert ${action}d.` });
});

app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(400).json({ error: err.message || "Something went wrong." });
});
app.listen(PORT, () => console.log(`Paya Music UG is running at http://localhost:${PORT}`));
