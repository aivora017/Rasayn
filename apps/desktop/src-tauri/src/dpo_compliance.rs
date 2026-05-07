// dpo_compliance.rs — DPDP §10 DPO + grievance officer contact + billing-purpose
// consent gate (S26.I, Section 8.3 of the brutal-review compliance audit).
//
// DPDP Act 2023 §10 obliges every Data Fiduciary to publish a Data
// Protection Officer (or contact) and a grievance officer. The founder is
// personally on the line for the first Data Subject Request (DSR), so the
// shop record MUST carry these five fields and they MUST appear on every
// printed bill (see packages/invoice-print/src/index.ts footer).
//
// `dpdp_check_billing_consent` is the gate save_bill calls before persisting
// any customer PII (phone, GSTIN, address). It returns true when the
// customer has an active "billing"-purpose row in `dpdp_consents`. This
// closes the DPDP consent split-brain: the legacy `customers.consent_*`
// flags and the canonical `dpdp_consents` table no longer have to agree
// because save_bill now consults the canonical table directly.
//
// Migration 0048 adds the seven shop columns these commands read/write.

use crate::db::DbState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

/// Input payload for `shops_set_dpo` — all five §10 fields are mandatory in
/// the wire schema; a missing field surfaces as a per-field validation
/// error so the onboarding wizard can highlight the empty input.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DpoContactInput {
    pub dpo_name: String,
    pub dpo_email: String,
    pub dpo_phone: String,
    pub grievance_officer_name: String,
    pub grievance_officer_email: String,
    /// Cross-border transfer (DPDP §16) — optional. NULL columns are the
    /// "not yet" state until the founder has filed a legal opinion.
    pub cross_border_opinion_at: Option<String>,
    pub cross_border_jurisdiction: Option<String>,
}

/// Read-out shape; `None` is returned by `shops_get_dpo` when the shop
/// exists but the DPO fields have never been set (e.g. just after first
/// install, before onboarding completes).
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DpoContact {
    pub dpo_name: String,
    pub dpo_email: String,
    pub dpo_phone: String,
    pub grievance_officer_name: String,
    pub grievance_officer_email: String,
    pub cross_border_opinion_at: Option<String>,
    pub cross_border_jurisdiction: Option<String>,
}

/// Trim + check email contains an `@` and at least one `.` after the `@`.
/// Cheap; avoids dragging in a regex crate just for one field.
fn looks_like_email(s: &str) -> bool {
    let s = s.trim();
    let Some(at) = s.find('@') else { return false };
    let (local, rest) = s.split_at(at);
    if local.is_empty() {
        return false;
    }
    // rest starts with '@'
    let domain = &rest[1..];
    domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
}

#[tauri::command]
pub fn shops_set_dpo(
    state: State<'_, DbState>,
    shop_id: String,
    dpo: DpoContactInput,
) -> Result<(), String> {
    if dpo.dpo_name.trim().is_empty() {
        return Err("DPO_NAME_REQUIRED".into());
    }
    if !looks_like_email(&dpo.dpo_email) {
        return Err("DPO_EMAIL_INVALID".into());
    }
    if dpo.dpo_phone.trim().is_empty() {
        return Err("DPO_PHONE_REQUIRED".into());
    }
    if dpo.grievance_officer_name.trim().is_empty() {
        return Err("GRIEVANCE_NAME_REQUIRED".into());
    }
    if !looks_like_email(&dpo.grievance_officer_email) {
        return Err("GRIEVANCE_EMAIL_INVALID".into());
    }

    let c = state.0.lock().map_err(|e| e.to_string())?;
    let rows = c
        .execute(
            "UPDATE shops SET
                dpo_name = ?2,
                dpo_email = ?3,
                dpo_phone = ?4,
                grievance_officer_name = ?5,
                grievance_officer_email = ?6,
                cross_border_opinion_at = ?7,
                cross_border_jurisdiction = ?8
             WHERE id = ?1",
            params![
                shop_id,
                dpo.dpo_name.trim(),
                dpo.dpo_email.trim(),
                dpo.dpo_phone.trim(),
                dpo.grievance_officer_name.trim(),
                dpo.grievance_officer_email.trim(),
                dpo.cross_border_opinion_at,
                dpo.cross_border_jurisdiction,
            ],
        )
        .map_err(|e| e.to_string())?;
    if rows == 0 {
        return Err(format!("SHOP_NOT_FOUND:{shop_id}"));
    }

    // Audit-log the write so the DPDP DSR auditor can prove who set what
    // when. Best-effort: a missing audit row never blocks the write.
    let _ = c.execute(
        "INSERT INTO audit_log (actor_id, entity, entity_id, action, payload)
         VALUES ('system', 'shop', ?1, 'set_dpo', ?2)",
        params![
            shop_id,
            format!(
                r#"{{"dpoEmail":{},"grievanceEmail":{}}}"#,
                serde_json::Value::String(dpo.dpo_email.trim().to_string()),
                serde_json::Value::String(dpo.grievance_officer_email.trim().to_string()),
            ),
        ],
    );
    Ok(())
}

#[tauri::command]
pub fn shops_get_dpo(
    state: State<'_, DbState>,
    shop_id: String,
) -> Result<Option<DpoContact>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let row: Option<(
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = c
        .query_row(
            "SELECT dpo_name, dpo_email, dpo_phone,
                    grievance_officer_name, grievance_officer_email,
                    cross_border_opinion_at, cross_border_jurisdiction
             FROM shops WHERE id = ?1",
            params![shop_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(row) = row else {
        return Ok(None);
    };
    // If the five mandatory §10 fields are unset, treat as "not yet
    // configured". The frontend uses this to push the onboarding step.
    let (
        dpo_name,
        dpo_email,
        dpo_phone,
        grievance_officer_name,
        grievance_officer_email,
        cross_border_opinion_at,
        cross_border_jurisdiction,
    ) = row;
    match (
        dpo_name,
        dpo_email,
        dpo_phone,
        grievance_officer_name,
        grievance_officer_email,
    ) {
        (Some(a), Some(b), Some(c_), Some(d), Some(e)) => Ok(Some(DpoContact {
            dpo_name: a,
            dpo_email: b,
            dpo_phone: c_,
            grievance_officer_name: d,
            grievance_officer_email: e,
            cross_border_opinion_at,
            cross_border_jurisdiction,
        })),
        _ => Ok(None),
    }
}

/// True iff the customer has an active "billing"-purpose consent row
/// (granted=1, withdrawn_at IS NULL). save_bill consults this before
/// persisting any customer-linked bill.
#[tauri::command]
pub fn dpdp_check_billing_consent(
    state: State<'_, DbState>,
    customer_id: String,
) -> Result<bool, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    check_billing_consent_inner(&c, &customer_id)
}

/// Shared inner helper so save_bill can call it while it already holds
/// the connection lock. Public-in-crate to keep the test surface narrow.
pub(crate) fn check_billing_consent_inner(
    conn: &rusqlite::Connection,
    customer_id: &str,
) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM dpdp_consents
              WHERE customer_id = ?1
                AND purpose = 'billing'
                AND granted = 1
                AND withdrawn_at IS NULL",
            params![customer_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}
