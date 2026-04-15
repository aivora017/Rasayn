-- Migration 0002: FTS5 search index for products.
-- Playbook v2.4 — keyboard-first, <2s billing; search must be <50ms on 10k SKUs.

CREATE VIRTUAL TABLE products_fts USING fts5(
  id UNINDEXED,
  name,
  generic_name,
  manufacturer,
  tokenize = "unicode61 remove_diacritics 2"
);

-- Backfill (empty at migration time in a fresh install).
INSERT INTO products_fts (id, name, generic_name, manufacturer)
SELECT id, name, COALESCE(generic_name,''), manufacturer FROM products;

CREATE TRIGGER trg_products_fts_ins AFTER INSERT ON products BEGIN
  INSERT INTO products_fts (id, name, generic_name, manufacturer)
  VALUES (NEW.id, NEW.name, COALESCE(NEW.generic_name,''), NEW.manufacturer);
END;

CREATE TRIGGER trg_products_fts_del AFTER DELETE ON products BEGIN
  DELETE FROM products_fts WHERE id = OLD.id;
END;

CREATE TRIGGER trg_products_fts_upd AFTER UPDATE ON products BEGIN
  DELETE FROM products_fts WHERE id = OLD.id;
  INSERT INTO products_fts (id, name, generic_name, manufacturer)
  VALUES (NEW.id, NEW.name, COALESCE(NEW.generic_name,''), NEW.manufacturer);
END;
