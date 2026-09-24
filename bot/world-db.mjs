// Per-bot world memory: what this bot has actually seen, indexed by position (R-tree) and by text (FTS5).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS places(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, dim TEXT NOT NULL,
  x INTEGER NOT NULL, y INTEGER NOT NULL, z INTEGER NOT NULL, data TEXT,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 1, gone INTEGER NOT NULL DEFAULT 0,
  UNIQUE(dim, x, y, z, kind));
CREATE INDEX IF NOT EXISTS places_name ON places(name, dim, gone);
CREATE VIRTUAL TABLE IF NOT EXISTS places_rt USING rtree(id, x0, x1, y0, y1, z0, z1);
CREATE VIRTUAL TABLE IF NOT EXISTS notes USING fts5(kind, text, dim UNINDEXED, x UNINDEXED, y UNINDEXED, z UNINDEXED, at UNINDEXED, tokenize='trigram');
`;

const ftsQuery = (q) => String(q).split(/\s+/).filter((t) => t.length >= 3).map((t) => '"' + t.replaceAll('"', '""') + '"').join(' OR ');

export function openWorld(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const q = {
    find: db.prepare('SELECT id, name, gone FROM places WHERE dim=? AND x=? AND y=? AND z=? AND kind=?'),
    insert: db.prepare('INSERT INTO places(kind,name,dim,x,y,z,data,first_seen,last_seen) VALUES(?,?,?,?,?,?,?,?,?)'),
    insertRt: db.prepare('INSERT INTO places_rt VALUES(?,?,?,?,?,?,?)'),
    touch: db.prepare('UPDATE places SET name=?, data=COALESCE(?,data), last_seen=?, seen=seen+1, gone=0 WHERE id=?'),
    gone: db.prepare('UPDATE places SET gone=1, last_seen=? WHERE dim=? AND x=? AND y=? AND z=? AND gone=0'),
    note: db.prepare('INSERT INTO notes(kind,text,dim,x,y,z,at) VALUES(?,?,?,?,?,?,?)'),
  };
  const now = () => Date.now();
  const row = (r, from) => ({ ...r, data: r.data ? JSON.parse(r.data) : null, gone: !!r.gone, ...(from ? { distance: Math.round(Math.hypot(r.x - from.x, r.y - from.y, r.z - from.z) * 10) / 10 } : {}) });

  function record({ kind = 'block', name, dim, x, y, z, data = null }) {
    [x, y, z] = [x, y, z].map(Math.floor);
    const json = data == null ? null : JSON.stringify(data);
    const hit = q.find.get(dim, x, y, z, kind);
    if (hit) { q.touch.run(name, json, now(), hit.id); return hit.id; }
    const id = Number(q.insert.run(kind, name, dim, x, y, z, json, now(), now()).lastInsertRowid);
    q.insertRt.run(id, x, x, y, y, z, z);
    return id;
  }

  // Batch writes from a scan in one transaction; a scan can report hundreds of blocks.
  function recordMany(items) {
    db.exec('BEGIN');
    try { for (const item of items) record(item); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  const markGone = ({ dim, x, y, z }) => q.gone.run(now(), dim, Math.floor(x), Math.floor(y), Math.floor(z)).changes;

  // Nearest known places around a point. `name` accepts an exact name or a SQL LIKE pattern ("%_ore").
  function nearest({ dim, x, y, z, kind = null, name = null, radius = 128, limit = 5, includeGone = false }) {
    const where = ['p.dim = ?', 'rt.x0 >= ? AND rt.x1 <= ? AND rt.y0 >= ? AND rt.y1 <= ? AND rt.z0 >= ? AND rt.z1 <= ?'];
    const args = [dim, x - radius, x + radius, y - radius, y + radius, z - radius, z + radius];
    if (kind) { where.push('p.kind = ?'); args.push(kind); }
    if (name) { where.push(name.includes('%') ? 'p.name LIKE ?' : 'p.name = ?'); args.push(name); }
    if (!includeGone) where.push('p.gone = 0');
    const rows = db.prepare(`SELECT p.* FROM places_rt rt JOIN places p ON p.id = rt.id WHERE ${where.join(' AND ')}`).all(...args);
    return rows.map((r) => row(r, { x, y, z })).filter((r) => r.distance <= radius).sort((a, b) => a.distance - b.distance).slice(0, limit);
  }

  // Counts of known things near a point, for compact planner context.
  function summary({ dim, x, y, z, radius = 96 }) {
    const rows = db.prepare(`SELECT p.name, p.kind, COUNT(*) n, MIN((p.x-?)*(p.x-?)+(p.y-?)*(p.y-?)+(p.z-?)*(p.z-?)) d2 FROM places_rt rt JOIN places p ON p.id=rt.id
      WHERE p.dim=? AND p.gone=0 AND rt.x0>=? AND rt.x1<=? AND rt.y0>=? AND rt.y1<=? AND rt.z0>=? AND rt.z1<=? GROUP BY p.name, p.kind ORDER BY d2`)
      .all(x, x, y, y, z, z, dim, x - radius, x + radius, y - radius, y + radius, z - radius, z + radius);
    return rows.map((r) => ({ name: r.name, kind: r.kind, count: r.n, nearest: Math.round(Math.sqrt(r.d2)) }));
  }

  function note({ text, kind = 'note', dim = null, x = null, y = null, z = null }) {
    q.note.run(kind, String(text), dim, x == null ? null : Math.floor(x), y == null ? null : Math.floor(y), z == null ? null : Math.floor(z), now());
  }

  function searchNotes(query, { limit = 8, kind = null } = {}) {
    const match = ftsQuery(query);
    const filter = kind ? ' AND kind = ?' : '';
    const rows = match
      ? db.prepare(`SELECT kind, text, dim, x, y, z, at, bm25(notes) score FROM notes WHERE notes MATCH ?${filter} ORDER BY score LIMIT ?`).all(match, ...(kind ? [kind] : []), limit)
      : db.prepare(`SELECT kind, text, dim, x, y, z, at FROM notes WHERE text LIKE ?${filter} ORDER BY at DESC LIMIT ?`).all('%' + query + '%', ...(kind ? [kind] : []), limit);
    return rows.map(({ score, ...r }) => r);
  }

  const recentNotes = (limit = 10) => db.prepare('SELECT kind, text, dim, x, y, z, at FROM notes ORDER BY at DESC LIMIT ?').all(limit);
  const stats = () => ({ places: db.prepare('SELECT COUNT(*) n FROM places WHERE gone=0').get().n, gone: db.prepare('SELECT COUNT(*) n FROM places WHERE gone=1').get().n, notes: db.prepare('SELECT COUNT(*) n FROM notes').get().n });

  return { record, recordMany, markGone, nearest, summary, note, searchNotes, recentNotes, stats, close: () => db.close() };
}
