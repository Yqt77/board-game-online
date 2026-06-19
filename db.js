const { Pool } = require("pg");
const crypto = require("crypto");

const SEED_USERS = [
  { username: "yqt", password: "yqt123456" },
  { username: "szy", password: "szy123456" },
];

let pool = null;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = crypto.scryptSync(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [salt, key] = stored.split(":");
  const derived = crypto.scryptSync(password, salt, 64);
  return key === derived.toString("hex");
}

async function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.warn("[db] DATABASE_URL not set — using in-memory fallback");
    return null;
  }
  pool = new Pool({ connectionString });
  return pool;
}

async function initDatabase() {
  const p = await getPool();
  if (!p) {
    console.warn("[db] Skipping database init (no DATABASE_URL)");
    return false;
  }
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(200) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await p.query(`
      CREATE TABLE IF NOT EXISTS login_logs (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        success BOOLEAN NOT NULL,
        ip VARCHAR(45),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    for (const user of SEED_USERS) {
      const existing = await p.query("SELECT id FROM users WHERE username = $1", [user.username]);
      if (existing.rows.length === 0) {
        const hash = hashPassword(user.password);
        await p.query("INSERT INTO users (username, password_hash) VALUES ($1, $2)", [user.username, hash]);
        console.log(`[db] Seeded user: ${user.username}`);
      }
    }
    console.log("[db] Database initialized");
    return true;
  } catch (err) {
    console.error("[db] Init error:", err.message);
    return false;
  }
}

async function authenticateUser(username, password) {
  const p = await getPool();
  if (!p) return { ok: false, message: "数据库未连接" };
  try {
    const result = await p.query("SELECT password_hash FROM users WHERE username = $1", [username]);
    if (result.rows.length === 0) {
      return { ok: false, message: "用户名或密码错误" };
    }
    if (!verifyPassword(password, result.rows[0].password_hash)) {
      return { ok: false, message: "用户名或密码错误" };
    }
    return { ok: true, username };
  } catch (err) {
    return { ok: false, message: "数据库错误" };
  }
}

async function dbStatus() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return { connected: false, reason: "DATABASE_URL 未设置" };
  }
  const p = await getPool();
  if (!p) return { connected: false, reason: "无法创建连接池" };
  try {
    await p.query("SELECT 1");
    return { connected: true };
  } catch (err) {
    return { connected: false, reason: err.message };
  }
}

async function logLoginAttempt(username, success, ip) {
  const p = await getPool();
  if (!p) return;
  try {
    await p.query(
      "INSERT INTO login_logs (username, success, ip) VALUES ($1, $2, $3)",
      [username, success, ip || null]
    );
  } catch (err) {
    if (success) console.warn("[db] Failed to write login log:", err.message);
  }
}

async function getLoginLogs(limit = 50) {
  const p = await getPool();
  if (!p) return [];
  try {
    const result = await p.query(
      "SELECT username, success, ip, created_at FROM login_logs ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
    return result.rows;
  } catch (err) {
    return [];
  }
}

module.exports = { initDatabase, authenticateUser, dbStatus, logLoginAttempt, getLoginLogs };
