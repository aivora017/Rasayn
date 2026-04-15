// @pharmacare/gmail-inbox/repo — DB-backed CRUD for supplier_templates.
//
// Runs on the Node side (host tools, tests). The Tauri app mirrors this with
// rusqlite in commands.rs. Templates are stored as JSON text columns; we
// do zero schema validation here beyond shape — the UI editor is the source
// of truth for structure.

import type Database from "better-sqlite3";
import type {
  SupplierTemplate, UpsertSupplierTemplateInput,
} from "./index.js";

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function rowToTemplate(r: any): SupplierTemplate {
  return {
    id: r.id,
    supplierId: r.supplier_id,
    name: r.name,
    headerPatterns: JSON.parse(r.header_patterns),
    linePatterns: JSON.parse(r.line_patterns),
    columnMap: JSON.parse(r.column_map),
    dateFormat: r.date_format,
  };
}

export function upsertSupplierTemplate(
  db: Database.Database,
  input: UpsertSupplierTemplateInput,
): string {
  if (!input.name.trim()) throw new Error("template name required");
  if (!input.shopId.trim()) throw new Error("shopId required");
  if (!input.supplierId.trim()) throw new Error("supplierId required");

  const id = input.id ?? genId("stpl");
  const header = JSON.stringify(input.headerPatterns);
  const line = JSON.stringify(input.linePatterns);
  const cols = JSON.stringify(input.columnMap);
  const fmt = input.dateFormat ?? "DD/MM/YYYY";
  const active = input.isActive === false ? 0 : 1;

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO supplier_templates
      (id, shop_id, supplier_id, name, header_patterns, line_patterns, column_map, date_format, is_active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      header_patterns = excluded.header_patterns,
      line_patterns = excluded.line_patterns,
      column_map = excluded.column_map,
      date_format = excluded.date_format,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at
  `).run(id, input.shopId, input.supplierId, input.name, header, line, cols, fmt, active, now);
  return id;
}

export function listSupplierTemplates(
  db: Database.Database,
  shopId: string,
  supplierId?: string,
): readonly SupplierTemplate[] {
  const rows = supplierId
    ? db.prepare(`SELECT * FROM supplier_templates WHERE shop_id = ? AND supplier_id = ? ORDER BY name`).all(shopId, supplierId)
    : db.prepare(`SELECT * FROM supplier_templates WHERE shop_id = ? ORDER BY name`).all(shopId);
  return (rows as any[]).map(rowToTemplate);
}

export function getSupplierTemplate(db: Database.Database, id: string): SupplierTemplate | null {
  const r = db.prepare(`SELECT * FROM supplier_templates WHERE id = ?`).get(id) as any;
  return r ? rowToTemplate(r) : null;
}

export function deleteSupplierTemplate(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM supplier_templates WHERE id = ?`).run(id);
}

export function markTemplateTested(db: Database.Database, id: string, ok: boolean): void {
  db.prepare(`
    UPDATE supplier_templates SET last_tested_at = ?, last_test_ok = ? WHERE id = ?
  `).run(new Date().toISOString(), ok ? 1 : 0, id);
}
