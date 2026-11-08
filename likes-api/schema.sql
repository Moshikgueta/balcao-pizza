-- Banco D1 da API de curtidas. Cole no "Console" do banco no painel da Cloudflare e clique em Execute.
CREATE TABLE IF NOT EXISTS likes (
  site       TEXT NOT NULL,
  item       TEXT NOT NULL,
  uid        TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (site, item, uid)
);
CREATE INDEX IF NOT EXISTS likes_site_item ON likes (site, item);
CREATE INDEX IF NOT EXISTS likes_uid ON likes (uid, created_at);
