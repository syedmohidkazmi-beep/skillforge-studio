import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import db, { initDb, SQLiteSessionStore } from './db.js';

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: false }, serveClient: true });
const PORT = Number(process.env.PORT || 3000);
const active = new Map();
const sessionMiddleware = session({
  store: new SQLiteSessionStore(),
  secret: process.env.SESSION_SECRET || 'local-development-only-change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 43200000 }
});
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(sessionMiddleware);
app.use(express.static('public', { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
io.engine.use(sessionMiddleware);

const loginLimit = rateLimit({ windowMs: 900000, limit: 10, standardHeaders: true, legacyHeaders: false });
const messageLimit = rateLimit({ windowMs: 3600000, limit: 5, standardHeaders: true, legacyHeaders: false });
const admin = (req, res, next) => req.session.adminId ? next() : res.status(401).json({ error: 'Unauthorized' });
const clean = (value, max = 3000) => String(value ?? '').trim().slice(0, max);

app.get('/api/health', (_req, res) => {
  try { db.prepare('SELECT 1').get(); res.json({ ok: true, database: 'ready' }); }
  catch { res.status(503).json({ ok: false, database: 'unavailable' }); }
});
app.post('/api/track', (req, res) => {
  let visitorId = req.cookies.sf_visitor;
  if (!visitorId || !/^[0-9a-f-]{36}$/i.test(visitorId)) {
    visitorId = crypto.randomUUID();
    res.cookie('sf_visitor', visitorId, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 31536000000 });
  }
  const page = clean(req.body?.path || '/', 300);
  db.prepare('INSERT INTO page_views(visitor_id,path) VALUES(?,?)').run(visitorId, page);
  res.json({ ok: true });
});
app.get('/api/public/posts', (_req, res) => res.json(db.prepare('SELECT id,type,title,slug,excerpt,body,tags,featured,created_at FROM posts WHERE published=1 ORDER BY featured DESC,created_at DESC').all()));
app.get('/api/public/resources', (_req, res) => res.json(db.prepare('SELECT id,type,title,description,url,source,tags,featured,created_at FROM resources ORDER BY featured DESC,created_at DESC').all()));
app.post('/api/messages', messageLimit, (req, res) => {
  const { name, email, subject, message } = req.body || {};
  if (![name, email, subject, message].every(v => clean(v))) return res.status(400).json({ error: 'All fields are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(email, 254))) return res.status(400).json({ error: 'Enter a valid email address.' });
  db.prepare('INSERT INTO messages(name,email,subject,message) VALUES(?,?,?,?)').run(clean(name,120),clean(email,254),clean(subject,200),clean(message,5000));
  res.status(201).json({ ok: true });
});
app.post('/api/admin/login', loginLimit, (req, res) => {
  const { email, password } = req.body || {};
  const account = db.prepare('SELECT * FROM admins WHERE email=?').get(clean(email,254).toLowerCase());
  if (!account || !bcrypt.compareSync(String(password || ''), account.password_hash)) return res.status(401).json({ error: 'Invalid email or password.' });
  req.session.regenerate(error => {
    if (error) return res.status(500).json({ error: 'Could not start a secure session.' });
    req.session.adminId = account.id;
    db.prepare('UPDATE admins SET last_login_at=CURRENT_TIMESTAMP WHERE id=?').run(account.id);
    req.session.save(err => err ? res.status(500).json({ error: 'Could not save session.' }) : res.json({ ok: true }));
  });
});
app.post('/api/admin/logout', admin, (req, res) => req.session.destroy(() => { res.clearCookie('connect.sid'); res.json({ ok: true }); }));
app.get('/api/admin/me', admin, (req, res) => res.json({ ok: true }));
app.get('/api/admin/dashboard', admin, (_req, res) => {
  const metrics = {
    todayViews: db.prepare("SELECT count(*) c FROM page_views WHERE date(created_at)=date('now')").get().c,
    totalViews: db.prepare('SELECT count(*) c FROM page_views').get().c,
    uniqueVisitors: db.prepare('SELECT count(distinct visitor_id) c FROM page_views').get().c,
    unread: db.prepare('SELECT count(*) c FROM messages WHERE read_at IS NULL').get().c,
    posts: db.prepare('SELECT count(*) c FROM posts').get().c,
    resources: db.prepare('SELECT count(*) c FROM resources').get().c
  };
  res.json({ metrics, active: [...active.values()], topPages: db.prepare('SELECT path,count(*) views FROM page_views GROUP BY path ORDER BY views DESC LIMIT 8').all(), messages: db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT 30').all() });
});
app.get('/api/admin/posts', admin, (_req, res) => res.json(db.prepare('SELECT * FROM posts ORDER BY created_at DESC').all()));
app.post('/api/admin/posts', admin, (req, res) => {
  const p = req.body || {};
  if (!clean(p.title,180) || !clean(p.body,10000)) return res.status(400).json({ error: 'Title and content are required.' });
  const slug = clean(p.slug || p.title,180).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  try { const result = db.prepare('INSERT INTO posts(type,title,slug,excerpt,body,tags,featured,published) VALUES(?,?,?,?,?,?,?,?)').run(clean(p.type || 'article',30),clean(p.title,180),slug,clean(p.excerpt,500),clean(p.body,10000),clean(p.tags,500),p.featured ? 1 : 0,p.published === false ? 0 : 1); res.status(201).json({ id: result.lastInsertRowid }); }
  catch { res.status(409).json({ error: 'A guide with that title or URL already exists.' }); }
});
app.delete('/api/admin/posts/:id', admin, (req,res) => { db.prepare('DELETE FROM posts WHERE id=?').run(Number(req.params.id)); res.json({ok:true}); });
app.get('/api/admin/resources', admin, (_req,res) => res.json(db.prepare('SELECT * FROM resources ORDER BY created_at DESC').all()));
app.post('/api/admin/resources', admin, (req,res) => {
  const r = req.body || {};
  if (![r.title,r.description,r.url].every(v => clean(v))) return res.status(400).json({error:'Title, description and URL are required.'});
  let url; try { url = new URL(clean(r.url,1000)); if (!['http:','https:'].includes(url.protocol)) throw Error(); } catch { return res.status(400).json({error:'Enter a valid http or https link.'}); }
  const result = db.prepare('INSERT INTO resources(type,title,description,url,source,tags,featured) VALUES(?,?,?,?,?,?,?)').run(clean(r.type || 'tool',30),clean(r.title,180),clean(r.description,1000),url.href,clean(r.source,180),clean(r.tags,500),r.featured ? 1 : 0);
  res.status(201).json({id:result.lastInsertRowid});
});
app.delete('/api/admin/resources/:id', admin, (req,res) => { db.prepare('DELETE FROM resources WHERE id=?').run(Number(req.params.id)); res.json({ok:true}); });
app.put('/api/admin/messages/:id/read', admin, (req,res) => { db.prepare('UPDATE messages SET read_at=CURRENT_TIMESTAMP WHERE id=?').run(Number(req.params.id)); res.json({ok:true}); });

io.on('connection', socket => {
  socket.on('presence:join', data => {
    const visitorId = clean(data?.visitorId,64) || 'visitor';
    active.set(socket.id,{visitorId,path:clean(data?.path || '/',300),lastSeenAt:new Date().toISOString()});
  });
  socket.on('presence:ping', data => { const current=active.get(socket.id); if(current){current.path=clean(data?.path || current.path,300);current.lastSeenAt=new Date().toISOString();} });
  socket.on('disconnect', () => active.delete(socket.id));
});
const start = async () => {
  initDb();
  await new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(PORT,'0.0.0.0',resolve);
  });
  console.log(`SkillForge listening on ${PORT}`);
};
start().catch(error => { console.error('Startup failed:',error); process.exit(1); });
