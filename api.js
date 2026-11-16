// Feather Sitter API: a shared roster for bird-sitting in the flock.
// SQLite storage for sitter profiles and sitting jobs.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dir = path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'sitter.db'));
db.pragma('journal_mode = WAL');

db.exec(`CREATE TABLE IF NOT EXISTS sitters (
  bird TEXT PRIMARY KEY,
  blurb TEXT DEFAULT '',
  skills TEXT DEFAULT '',
  rating REAL DEFAULT 0,
  jobs INTEGER DEFAULT 0,
  updated TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  sitter TEXT DEFAULT '',
  pet TEXT NOT NULL,
  when_from TEXT DEFAULT '',
  when_to TEXT DEFAULT '',
  note TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  created TEXT DEFAULT '',
  updated TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL,
  by_bird TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS job_status ON jobs(status, created);`);

const now = () => new Date().toISOString();
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const STATUSES = ['open', 'accepted', 'done', 'cancelled'];
const nextStatus = { open: 'accepted', accepted: 'done', done: null, cancelled: null };

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 100000) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); } });
  });
}
function jobRow(r) {
  const events = db.prepare('SELECT * FROM events WHERE job_id = ? ORDER BY created ASC').all(r.id);
  return {
    id: r.id, owner: r.owner, sitter: r.sitter, pet: r.pet,
    when_from: r.when_from, when_to: r.when_to, note: r.note,
    status: r.status, created: r.created, updated: r.updated,
    next: nextStatus[r.status] || null,
    events: events.map(e => ({ status: e.status, by_bird: e.by_bird, note: e.note, created: e.created }))
  };
}
function bumpRating(bird, delta) {
  const s = db.prepare('SELECT * FROM sitters WHERE bird = ?').get(bird);
  if (!s) return;
  const jobs = s.jobs + 1;
  const rating = Math.max(0, Math.min(5, Number(((s.rating * s.jobs + delta) / jobs).toFixed(2))));
  db.prepare('UPDATE sitters SET rating = ?, jobs = ?, updated = ? WHERE bird = ?').run(rating, jobs, now(), bird);
}

module.exports = function handler(req, res, route) {
  route = Array.isArray(route) ? route.join('/') : String(route || '');
  const seg = route.split('/').filter(Boolean);

  if (req.method === 'GET' && route === 'sitters') {
    const rows = db.prepare('SELECT * FROM sitters ORDER BY rating DESC, bird ASC').all();
    return json(res, 200, { sitters: rows });
  }

  if (req.method === 'GET' && (route === '' || route === 'jobs')) {
    const u = new URL(req.url, 'http://x');
    const q = (u.searchParams.get('q') || '').trim().toLowerCase();
    const status = (u.searchParams.get('status') || '').trim().toLowerCase();
    let rows = db.prepare('SELECT * FROM jobs ORDER BY created DESC').all();
    if (q) rows = rows.filter(r => [r.id, r.owner, r.sitter, r.pet, r.note].join(' ').toLowerCase().includes(q));
    if (status) rows = rows.filter(r => String(r.status).toLowerCase() === status);
    return json(res, 200, { count: rows.length, jobs: rows.map(jobRow), statuses: STATUSES });
  }

  if (req.method === 'GET' && seg[0] === 'job' && seg[1]) {
    const r = db.prepare('SELECT * FROM jobs WHERE id = ?').get(seg[1]);
    if (!r) return json(res, 404, { error: 'no such job' });
    return json(res, 200, { job: jobRow(r) });
  }

  if (req.method === 'GET' && route === 'stats') {
    const total = db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
    const open = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='open'").get().n;
    const accepted = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='accepted'").get().n;
    const done = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='done'").get().n;
    const sitters = db.prepare('SELECT COUNT(*) AS n FROM sitters').get().n;
    const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all();
    return json(res, 200, { total, open, accepted, done, sitters, byStatus });
  }

  if (req.method === 'POST' && route === 'sitter') {
    return readBody(req).then(b => {
      const bird = String(b.bird || '').trim().slice(0, 40);
      if (!bird) return json(res, 400, { error: 'a sitter needs a name' });
      const t = now();
      db.prepare(`INSERT INTO sitters (bird,blurb,skills,rating,jobs,updated) VALUES (?,?,?,0,0,?)
        ON CONFLICT(bird) DO UPDATE SET blurb=excluded.blurb, skills=excluded.skills, updated=excluded.updated`)
        .run(bird, String(b.blurb || '').slice(0, 300), String(b.skills || '').slice(0, 200), t);
      const s = db.prepare('SELECT * FROM sitters WHERE bird = ?').get(bird);
      return json(res, 200, { ok: true, sitter: s });
    });
  }

  if (req.method === 'POST' && route === 'job') {
    return readBody(req).then(b => {
      const owner = String(b.owner || '').trim().slice(0, 40);
      const pet = String(b.pet || '').trim().slice(0, 60);
      if (!owner || !pet) return json(res, 400, { error: 'a sitting needs an owner and a pet' });
      const id = 'FS-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      const t = now();
      db.prepare(`INSERT INTO jobs (id,owner,sitter,pet,when_from,when_to,note,status,created,updated)
        VALUES (?,?,'',?,?,?,?,'open',?,?)`)
        .run(id, owner, pet, String(b.when_from || '').slice(0, 40), String(b.when_to || '').slice(0, 40),
             String(b.note || '').slice(0, 300), t, t);
      db.prepare('INSERT INTO events (id,job_id,status,by_bird,note,created) VALUES (?,?,?,?,?,?)')
        .run(rid(), id, 'open', owner, 'sitting requested', t);
      return json(res, 200, { ok: true, job: jobRow(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)) });
    });
  }

  if (req.method === 'POST' && route === 'advance') {
    return readBody(req).then(b => {
      const id = String(b.id || '').trim().toUpperCase();
      const by = String(b.by_bird || '').trim().slice(0, 40);
      const o = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
      if (!o) return json(res, 404, { error: 'no such job' });
      let status = String(b.status || '').trim().toLowerCase();
      if (!status) status = nextStatus[o.status] || '';
      if (!STATUSES.includes(status)) return json(res, 400, { error: 'unknown status' });
      if (status === o.status) return json(res, 400, { error: 'it is already ' + status });
      if (status === 'accepted' && !by) return json(res, 400, { error: 'someone has to accept it' });
      const t = now();
      const sitter = status === 'accepted' ? by : o.sitter;
      db.prepare('UPDATE jobs SET status = ?, sitter = ?, updated = ? WHERE id = ?').run(status, sitter, t, id);
      db.prepare('INSERT INTO events (id,job_id,status,by_bird,note,created) VALUES (?,?,?,?,?,?)')
        .run(rid(), id, status, by, String(b.note || '').slice(0, 240), t);
      if (status === 'done' && sitter) bumpRating(sitter, 5);
      return json(res, 200, { ok: true, job: jobRow(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)) });
    });
  }

  return json(res, 404, { error: 'not found' });
};
