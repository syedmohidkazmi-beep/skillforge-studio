import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const db = new Database(process.env.DB_PATH || 'site.db');
db.pragma('journal_mode=WAL');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY,email TEXT UNIQUE,password_hash TEXT,last_login_at TEXT);
    CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY,type TEXT,title TEXT,slug TEXT UNIQUE,excerpt TEXT,body TEXT,tags TEXT,featured INTEGER DEFAULT 0,published INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS resources(id INTEGER PRIMARY KEY,type TEXT,title TEXT,description TEXT,url TEXT,source TEXT,tags TEXT,featured INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS page_views(id INTEGER PRIMARY KEY,visitor_id TEXT,path TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,name TEXT,email TEXT,subject TEXT,message TEXT,read_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);

  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  if (!db.prepare('SELECT id FROM admins WHERE email=?').get(email)) {
    db.prepare('INSERT INTO admins(email,password_hash) VALUES(?,?)')
      .run(email, bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'ChangeMeNow!123', 12));
  }

  if (!db.prepare('SELECT id FROM posts LIMIT 1').get()) {
    const p = db.prepare('INSERT INTO posts(type,title,slug,excerpt,body,tags,featured) VALUES(?,?,?,?,?,?,?)');
    p.run('article','Study Smarter','study-smarter','A practical system for active recall, spaced review and mistake logs.','Define outcomes, work in short blocks, recall without notes, review over several days and keep a mistake log.','study,learning',1);
    p.run('article','Build a Better Job Search','job-search','Organize CVs, applications and interview preparation.','Keep a master CV, focused variants, an application tracker and evidence stories for interviews.','career,jobs',0);
    p.run('tip','The 10-Minute Restart Rule','restart-rule','Start with the smallest possible next action.','Open the document, write the heading or solve one question. Momentum comes after starting.','productivity',0);
  }

  if (!db.prepare('SELECT id FROM resources LIMIT 1').get()) {
    const r = db.prepare('INSERT INTO resources(type,title,description,url,source,featured) VALUES(?,?,?,?,?,?)');
    r.run('image','Unsplash','Free photography for projects and inspiration.','https://unsplash.com/','Unsplash',1);
    r.run('image','Pexels','Free stock photos and videos.','https://www.pexels.com/','Pexels',1);
    r.run('video','Mixkit','Free stock video clips and creative assets.','https://mixkit.co/free-stock-video/','Mixkit',0);
    r.run('tool','Photopea','Browser image editor.','https://www.photopea.com/','Photopea',1);
    r.run('tool','Canva','Design presentations, CVs and graphics.','https://www.canva.com/','Canva',0);
  }
}

export default db;
