import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import fs from 'node:fs';
import path from 'node:path';

const filename = process.env.DB_PATH || 'site.db';
fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
const db = new Database(filename);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb() {
  if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET)) {
    throw new Error('Production requires ADMIN_EMAIL, ADMIN_PASSWORD, and SESSION_SECRET.');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,last_login_at TEXT);
    CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY,type TEXT NOT NULL,title TEXT NOT NULL,slug TEXT UNIQUE NOT NULL,excerpt TEXT NOT NULL,body TEXT NOT NULL,tags TEXT DEFAULT '',featured INTEGER DEFAULT 0,published INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS resources(id INTEGER PRIMARY KEY,type TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,url TEXT NOT NULL,source TEXT DEFAULT '',tags TEXT DEFAULT '',featured INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS page_views(id INTEGER PRIMARY KEY,visitor_id TEXT NOT NULL,path TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS page_views_created_at ON page_views(created_at);
    CREATE INDEX IF NOT EXISTS page_views_visitor_id ON page_views(visitor_id);
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,subject TEXT NOT NULL,message TEXT NOT NULL,read_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY,session TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
  `);
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMeNow!123';
  const existing = db.prepare('SELECT id FROM admins WHERE email=?').get(email);
  if (existing) db.prepare('UPDATE admins SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 12), existing.id);
  else db.prepare('INSERT INTO admins(email,password_hash) VALUES(?,?)').run(email, bcrypt.hashSync(password, 12));
  if (!db.prepare('SELECT id FROM posts LIMIT 1').get()) {
    const p = db.prepare('INSERT INTO posts(type,title,slug,excerpt,body,tags,featured) VALUES(?,?,?,?,?,?,?)');
    p.run('article','Study Smarter','study-smarter','A practical system for active recall, spaced review and mistake logs.','Define outcomes, work in short blocks, recall without notes, review over several days, and keep a mistake log.','study,learning',1);
    p.run('article','Build a Better Job Search','job-search','Organize CVs, applications and interview preparation.','Keep a master CV, focused variants, an application tracker, and evidence stories for interviews.','career,jobs',0);
    p.run('tip','The 10-Minute Restart Rule','restart-rule','Start with the smallest possible next action.','Open the document, write the heading, or solve one question. Momentum comes after starting.','productivity',0);
  }
  if (!db.prepare('SELECT id FROM resources LIMIT 1').get()) {
    const r = db.prepare('INSERT INTO resources(type,title,description,url,source,featured) VALUES(?,?,?,?,?,?)');
    r.run('image','Unsplash','Free photography for projects and inspiration.','https://unsplash.com/','Unsplash',1);
    r.run('image','Pexels','Free stock photos and videos.','https://www.pexels.com/','Pexels',1);
    r.run('video','Mixkit','Free stock video clips and creative assets.','https://mixkit.co/free-stock-video/','Mixkit',0);
    r.run('tool','Photopea','Browser image editor.','https://www.photopea.com/','Photopea',1);
    r.run('tool','Canva','Design presentations, CVs and graphics.','https://www.canva.com/','Canva',0);
  }
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}
export class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    try { const row = db.prepare('SELECT session,expires_at FROM sessions WHERE sid=?').get(sid); if (!row || row.expires_at < Date.now()) { this.destroy(sid, () => {}); return callback(null, null); } callback(null, JSON.parse(row.session)); } catch (error) { callback(error); }
  }
  set(sid, value, callback = () => {}) {
    try { const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 43200000; db.prepare('INSERT INTO sessions(sid,session,expires_at) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET session=excluded.session,expires_at=excluded.expires_at').run(sid, JSON.stringify(value), expires); callback(null); } catch (error) { callback(error); }
  }
  destroy(sid, callback = () => {}) { try { db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); callback(null); } catch (error) { callback(error); } }
  touch(sid, value, callback = () => {}) { this.set(sid, value, callback); }
}
export default db;