-- Explicit demo marker so the UI can label seeded data and never confuse it with real business data.
ALTER TABLE tenants ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
