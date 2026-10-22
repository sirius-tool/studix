CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  subscription TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  tasks TEXT NOT NULL DEFAULT '[]',
  schedules TEXT NOT NULL DEFAULT '[]',
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sent_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  notification_key TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  UNIQUE(device_id, notification_key),
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sent_device ON sent_notifications(device_id);
