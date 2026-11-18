-- WeChat mini program sign-in (functions/api/wxlogin.js). A WeChat user (openid, from wx.login + jscode2session) is
-- bound to one runner the first time they enter the shared passcode; after that wx.login alone gives a session token.
-- Only the token's SHA-256 is stored. Unbind someone: DELETE FROM wx_users WHERE person='…' (and their wx_sessions).
CREATE TABLE IF NOT EXISTS wx_users (
  openid     TEXT PRIMARY KEY,
  person     TEXT NOT NULL,      -- TJH / WGW / SJH: the tab the mini program opens on
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wx_sessions (
  token_hash TEXT PRIMARY KEY,   -- hex SHA-256 of the bearer token
  openid     TEXT NOT NULL,
  expires_at TEXT NOT NULL       -- ISO time; 30 days after sign-in
);
CREATE INDEX IF NOT EXISTS wx_sessions_openid ON wx_sessions (openid);
