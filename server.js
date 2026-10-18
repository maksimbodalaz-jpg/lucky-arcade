import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const DEV_MODE = process.env.DEV_MODE === 'true';

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'lucky-arcade.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '👑',
  points INTEGER NOT NULL DEFAULT 120,
  best_score INTEGER NOT NULL DEFAULT 120,
  rounds INTEGER NOT NULL DEFAULT 0,
  last_bonus TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  game TEXT NOT NULL,
  reward INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);
CREATE INDEX IF NOT EXISTS rounds_user_idx ON rounds(telegram_id);
`);

function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN) throw new Error('Telegram bot is not configured');
  if (!initData || typeof initData !== 'string') throw new Error('Missing Telegram initData');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('Missing Telegram hash');
  params.delete('hash');
  params.delete('signature');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const a = Buffer.from(calculated, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Invalid Telegram signature');
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || Math.floor(Date.now()/1000) - authDate > 86400 || authDate > Math.floor(Date.now()/1000) + 60) {
    throw new Error('Telegram login expired; reopen the Mini App');
  }
  const userRaw = params.get('user');
  if (!userRaw) throw new Error('Telegram user is missing');
  const user = JSON.parse(userRaw);
  if (!user.id) throw new Error('Telegram user ID is missing');
  return user;
}

function getIdentity(req) {
  if (DEV_MODE && req.get('x-demo-user')) {
    const id = String(req.get('x-demo-user')).slice(0, 64);
    return { id, name: 'Demo Player', avatar: '👑' };
  }
  const user = verifyTelegramInitData(req.get('x-telegram-init-data'));
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').slice(0, 80) || 'Игрок';
  return { id: String(user.id), name, avatar: '👑' };
}
function todayUTC() { return new Date().toISOString().slice(0, 10); }
function publicUser(user) {
  return { id: user.telegram_id, name: user.username, avatar: user.avatar, points: user.points, bestScore: user.best_score, rounds: user.rounds, lastBonus: user.last_bonus };
}
function ensureUser(identity) {
  const existing = db.prepare('SELECT * FROM users WHERE telegram_id=?').get(identity.id);
  if (existing) {
    db.prepare('UPDATE users SET username=?, updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?').run(identity.name, identity.id);
    return db.prepare('SELECT * FROM users WHERE telegram_id=?').get(identity.id);
  }
  db.prepare('INSERT INTO users (telegram_id, username, avatar, points, best_score) VALUES (?, ?, ?, 120, 120)')
    .run(identity.id, identity.name, identity.avatar);
  return db.prepare('SELECT * FROM users WHERE telegram_id=?').get(identity.id);
}
function apiAuth(req, res, next) {
  try { req.identity = getIdentity(req); next(); }
  catch (e) { res.status(401).json({ error: e.message || 'Authentication failed' }); }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'Lucky Arcade VIP' }));
app.get('/api/me', apiAuth, (req, res) => {
  try {
    const user = ensureUser(req.identity);
    const claimed = user.last_bonus === todayUTC();
    res.json({ user: publicUser(user), bonusAvailable: !claimed });
  } catch (e) { res.status(500).json({ error: 'Could not load profile' }); }
});

app.post('/api/bonus', apiAuth, (req, res) => {
  const tx = db.transaction(() => {
    const user = ensureUser(req.identity);
    if (user.last_bonus === todayUTC()) return { ok: false, user: publicUser(user), error: 'Ежедневный бонус уже получен' };
    db.prepare(`UPDATE users SET points=points+50, best_score=MAX(best_score, points+50), last_bonus=?, updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?`)
      .run(todayUTC(), req.identity.id);
    return { ok: true, user: publicUser(db.prepare('SELECT * FROM users WHERE telegram_id=?').get(req.identity.id)), reward: 50 };
  });
  try { const result = tx(); res.status(result.ok ? 200 : 409).json(result); }
  catch { res.status(500).json({ error: 'Не удалось выдать бонус' }); }
});

const rewards = { slots: [4, 4, 4, 4, 12, 12, 30], wheel: [5, 8, 10, 12, 15, 20] };
app.post('/api/play', apiAuth, (req, res) => {
  const game = req.body?.game;
  if (!Object.hasOwn(rewards, game)) return res.status(400).json({ error: 'Неизвестная игра' });
  // The server chooses the reward; the client cannot submit a reward amount.
  const choices = rewards[game];
  const reward = choices[crypto.randomInt(choices.length)];
  const tx = db.transaction(() => {
    ensureUser(req.identity);
    db.prepare('UPDATE users SET points=points+?, best_score=MAX(best_score, points+?), rounds=rounds+1, updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?')
      .run(reward, reward, req.identity.id);
    db.prepare('INSERT INTO rounds (telegram_id, game, reward) VALUES (?, ?, ?)').run(req.identity.id, game, reward);
    return db.prepare('SELECT * FROM users WHERE telegram_id=?').get(req.identity.id);
  });
  try {
    const user = tx();
    res.json({ reward, user: publicUser(user) });
  } catch { res.status(500).json({ error: 'Не удалось завершить раунд' }); }
});

app.get('/api/leaderboard', apiAuth, (_req, res) => {
  const rows = db.prepare(`SELECT telegram_id AS id, username AS name, best_score AS score, rounds
    FROM users ORDER BY best_score DESC, rounds DESC, updated_at ASC LIMIT 20`).all();
  res.json({ leaderboard: rows });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.listen(PORT, () => console.log(`Lucky Arcade VIP listening on http://localhost:${PORT}`));
