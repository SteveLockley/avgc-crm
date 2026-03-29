-- Website content tables for public site
-- Migration 011: Website Content Management

-- Website pages (static content)
CREATE TABLE IF NOT EXISTS website_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,           -- 'course', 'visitors', etc.
  title TEXT NOT NULL,
  meta_description TEXT,
  content TEXT NOT NULL,               -- HTML/Markdown content
  hero_image TEXT,                     -- Image URL
  published INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT
);

-- News articles
CREATE TABLE IF NOT EXISTS website_news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT NOT NULL,
  image TEXT,
  published INTEGER DEFAULT 0,
  publish_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT
);

-- FAQ entries
CREATE TABLE IF NOT EXISTS website_faq (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,              -- 'visitors', 'members', 'general'
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  keywords TEXT,                       -- For bot matching (comma-separated)
  sort_order INTEGER DEFAULT 0,
  published INTEGER DEFAULT 1
);

-- Gallery images
CREATE TABLE IF NOT EXISTS website_gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT,                       -- 'course', 'clubhouse', 'events'
  title TEXT,
  description TEXT,
  image_url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  published INTEGER DEFAULT 1
);

-- Member magic link tokens
CREATE TABLE IF NOT EXISTS member_login_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

-- Member sessions (year-long)
CREATE TABLE IF NOT EXISTS member_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  session_token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  last_used TEXT,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_website_pages_slug ON website_pages(slug);
CREATE INDEX IF NOT EXISTS idx_website_pages_published ON website_pages(published);
CREATE INDEX IF NOT EXISTS idx_website_news_slug ON website_news(slug);
CREATE INDEX IF NOT EXISTS idx_website_news_published ON website_news(published);
CREATE INDEX IF NOT EXISTS idx_website_news_publish_date ON website_news(publish_date);
CREATE INDEX IF NOT EXISTS idx_website_faq_category ON website_faq(category);
CREATE INDEX IF NOT EXISTS idx_website_faq_published ON website_faq(published);
CREATE INDEX IF NOT EXISTS idx_website_gallery_category ON website_gallery(category);
CREATE INDEX IF NOT EXISTS idx_website_gallery_published ON website_gallery(published);
CREATE INDEX IF NOT EXISTS idx_member_login_tokens_token ON member_login_tokens(token);
CREATE INDEX IF NOT EXISTS idx_member_login_tokens_member ON member_login_tokens(member_id);
CREATE INDEX IF NOT EXISTS idx_member_sessions_token ON member_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_member_sessions_member ON member_sessions(member_id);

-- Seed initial page content
INSERT OR IGNORE INTO website_pages (slug, title, meta_description, content) VALUES
('course', 'The Course', 'Discover our stunning links course at Alnmouth Village Golf Club - 18 holes with breathtaking views of the Northumberland coast.', ''),
('visitors', 'Visitors', 'Plan your visit to Alnmouth Village Golf Club. View green fees, booking information, and everything you need for a great round.', ''),
('membership', 'Membership', 'Join Alnmouth Village Golf Club. Explore our membership options, benefits, and how to become part of our welcoming community.', ''),
('clubhouse', 'Clubhouse', 'Our clubhouse offers excellent facilities including bar, catering, and function rooms with panoramic views.', ''),
('contact', 'Contact Us', 'Get in touch with Alnmouth Village Golf Club. Find directions, opening hours, and contact details.', '');

-- Seed initial FAQ entries
INSERT OR IGNORE INTO website_faq (category, question, answer, keywords, sort_order) VALUES
('visitors', 'What are the green fees?', 'Please visit our visitors page for current green fee rates. Fees vary by season and day of the week.', 'green fee,price,cost,rate,visitor,pay', 1),
('visitors', 'Do I need to book a tee time?', 'Yes, we recommend booking your tee time in advance through our online booking system (BRS Golf) or by calling the pro shop.', 'book,tee time,reservation,booking', 2),
('visitors', 'Is there a dress code?', 'Yes, smart casual golf attire is required. Denim jeans, tracksuits, and collarless shirts are not permitted on the course.', 'dress,code,attire,clothing,jeans,wear', 3),
('visitors', 'Do you hire golf clubs?', 'Yes, we have a limited number of hire sets available. Please contact the pro shop to arrange club hire.', 'hire,rent,clubs,equipment,borrow', 4),
('members', 'How do I check my handicap?', 'Your World Handicap System (WHS) index can be viewed on the England Golf website or WHS app. Log in with your CDH number.', 'handicap,whs,index,cdh', 1),
('members', 'How do I book competitions?', 'Competition entries can be made through BRS Golf using your member login. Most competitions open for booking 7 days in advance.', 'competition,enter,book,brs,tournament', 2),
('members', 'Where can I view competition results?', 'Competition results are posted on the notice board in the clubhouse and on the members area of the website.', 'results,scores,competition,leaderboard', 3),
('general', 'Where is the club located?', 'Alnmouth Village Golf Club is located at Marine Road, Alnmouth, Northumberland NE66 2RZ. We are approximately 4 miles from Alnwick.', 'location,address,where,directions,find', 1),
('general', 'What are your opening hours?', 'The clubhouse is generally open from 8am to dusk. Opening times may vary seasonally - please call ahead or check our website.', 'hours,open,times,when,closed', 2),
('general', 'Is there parking available?', 'Yes, we have a large free car park for members and visitors.', 'parking,car,park,vehicle', 3),
('general', 'Do you cater for functions?', 'Yes, our clubhouse is available for private functions, meetings, and celebrations. Please contact us for availability and pricing.', 'function,event,party,wedding,meeting,hire,room', 4);
