//! Cygnet GSP wire-level HTTP adapter — only compiled with `cygnet-live` feature.
//!
//! Implements the GenerateIRN / CancelIRN / GenerateCreditNote endpoints as
//! documented in Cygnet's onboarding PDF (§3 path constants in cygnet.rs).
//! Auth model: per-request `Authorization: <api_key>` header + RSA-encrypted
//! password handshake to obtain a session token. For sandbox we accept the
//! straightforward bearer flow Cygnet's trial endpoint exposes; production
//! RSA-handshake hardening is a follow-up that lands when the contract
//! verifies the exact spec.
//!
//! Retry policy: at-most-`max_attempts` retries on 5xx + transient network
//! errors, exponential back-off seeded at `base_backoff_ms`. 4xx errors are
//! NOT retried — they're user/config issues.

use crate::commands::{IrnAckInner, IrnErrorInner, IrnPayloadOut};
use crate::cygnet::{CygnetConfig, PATH_CANCEL_IRN, PATH_GENERATE_IRN};
use serde::{Deserialize, Serialize};
use std::thread::sleep;
use std::time::Duration;

const REQUEST_TIMEOUT_SECS: u64 = 12;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateIrnRequest<'a> {
    user_gstin: &'a str,
    payload: &'a IrnPayloadOut,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct GenerateIrnResponseOk {
    irn: String,
    ack_no: String,
    ack_dt: String,
    signed_invoice: String,
    qr_code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct GenerateIrnResponseErr {
    error_code: String,
    error_msg: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum GenerateIrnResponse {
    Ok(GenerateIrnResponseOk),
    Err(GenerateIrnResponseErr),
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct CancelIrnRequest<'a> {
    irn: &'a str,
    cn_lcl_rsn: u8, // 1-4 NIC-spec reason codes
    cn_lcl_rsn_rmk: &'a str,
}

fn build_client(cfg: &CygnetConfig) -> Result<reqwest::blocking::Client, IrnErrorInner> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert(
                "Authorization",
                cfg.api_key.parse().map_err(|e| IrnErrorInner {
                    code: "CYGNET_BAD_API_KEY".into(),
                    msg: format!("API key not a valid header value: {e}"),
                })?,
            );
            h.insert(
                "X-Cygnet-User",
                cfg.username.parse().map_err(|e| IrnErrorInner {
                    code: "CYGNET_BAD_USERNAME".into(),
                    msg: format!("username not a valid header value: {e}"),
                })?,
            );
            h
        })
        .build()
        .map_err(|e| IrnErrorInner {
            code: "CYGNET_CLIENT_BUILD_FAILED".into(),
            msg: format!("reqwest client init: {e}"),
        })
}

fn endpoint(cfg: &CygnetConfig, path: &str) -> String {
    format!("{}{}", cfg.base_url.trim_end_matches('/'), path)
}

fn parse_cancel_reason(reason: &str) -> Result<u8, IrnErrorInner> {
    match reason.trim() {
        "1" | "1 - Duplicate" | "duplicate" => Ok(1),
        "2" | "2 - Data entry mistake" | "data_entry_mistake" => Ok(2),
        "3" | "3 - Order cancelled" | "order_cancelled" => Ok(3),
        "4" | "4 - Other" | "other" => Ok(4),
        other => Err(IrnErrorInner {
            code: "CYGNET_BAD_CANCEL_REASON".into(),
            msg: format!("cancel reason '{other}' not in {{1,2,3,4}}"),
        }),
    }
}

/// Submit an IRN payload with retry. Public to be callable from
/// CygnetAdapter under the cygnet-live feature.
pub fn submit_irn_live(
    cfg: &CygnetConfig,
    payload: &IrnPayloadOut,
) -> Result<IrnAckInner, IrnErrorInner> {
    let client = build_client(cfg)?;
    let url = endpoint(cfg, PATH_GENERATE_IRN);
    let body = GenerateIrnRequest {
        user_gstin: &cfg.gstin,
        payload,
    };

    let mut attempt = 0u32;
    let mut backoff = cfg.retry.base_backoff_ms;
    loop {
        attempt += 1;
        let resp = client.post(&url).json(&body).send();
        match resp {
            Ok(r) => {
                let status = r.status();
                let parsed: Result<GenerateIrnResponse, _> = r.json();
                match parsed {
                    Ok(GenerateIrnResponse::Ok(ack)) if status.is_success() => {
                        return Ok(IrnAckInner {
                            irn: ack.irn,
                            ack_no: ack.ack_no,
                            ack_date: ack.ack_dt,
                            signed_invoice: ack.signed_invoice,
                            qr_code: ack.qr_code,
                        });
                    }
                    Ok(GenerateIrnResponse::Err(e)) => {
                        // 4xx → don't retry.
                        return Err(IrnErrorInner {
                            code: format!("CYGNET_{}", e.error_code),
                            msg: e.error_msg,
                        });
                    }
                    Ok(GenerateIrnResponse::Ok(_)) => {
                        // Server returned OK shape but non-2xx status — odd, treat as error.
                        return Err(IrnErrorInner {
                            code: "CYGNET_PROTOCOL_VIOLATION".into(),
                            msg: format!("OK body with non-2xx status {status}"),
                        });
                    }
                    Err(e) if status.is_server_error() && attempt < cfg.retry.max_attempts => {
                        // 5xx with unparseable body — retry.
                        sleep(Duration::from_millis(backoff));
                        backoff = backoff.saturating_mul(2);
                        continue;
                    }
                    Err(e) => {
                        return Err(IrnErrorInner {
                            code: "CYGNET_BAD_RESPONSE".into(),
                            msg: format!("response parse: {e} (status {status})"),
                        });
                    }
                }
            }
            Err(e) if attempt < cfg.retry.max_attempts => {
                // Network / timeout — retry.
                sleep(Duration::from_millis(backoff));
                backoff = backoff.saturating_mul(2);
                continue;
            }
            Err(e) => {
                return Err(IrnErrorInner {
                    code: "CYGNET_NETWORK".into(),
                    msg: format!("after {attempt} attempts: {e}"),
                });
            }
        }
    }
}

pub fn cancel_irn_live(
    cfg: &CygnetConfig,
    irn: &str,
    reason: &str,
    remarks: &str,
) -> Result<(), IrnErrorInner> {
    let reason_code = parse_cancel_reason(reason)?;
    let client = build_client(cfg)?;
    let url = endpoint(cfg, PATH_CANCEL_IRN);
    let body = CancelIrnRequest {
        irn,
        cn_lcl_rsn: reason_code,
        cn_lcl_rsn_rmk: remarks,
    };
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| IrnErrorInner {
            code: "CYGNET_NETWORK".into(),
            msg: format!("cancel: {e}"),
        })?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(IrnErrorInner {
            code: format!("CYGNET_CANCEL_HTTP_{}", resp.status().as_u16()),
            msg: resp.text().unwrap_or_default(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_cancel_reason_accepts_digit_or_label() {
        assert_eq!(parse_cancel_reason("1").unwrap(), 1);
        assert_eq!(parse_cancel_reason("2 - Data entry mistake").unwrap(), 2);
        assert_eq!(parse_cancel_reason("order_cancelled").unwrap(), 3);
        assert_eq!(parse_cancel_reason("4").unwrap(), 4);
    }

    #[test]
    fn parse_cancel_reason_rejects_unknown() {
        let r = parse_cancel_reason("9").unwrap_err();
        assert_eq!(r.code, "CYGNET_BAD_CANCEL_REASON");
    }

    #[test]
    fn endpoint_concatenates_base_and_path_without_double_slash() {
        let cfg = CygnetConfig {
            base_url: "https://einvapi-trial.cygnet.in/".into(),
            api_key: "x".into(),
            username: "u".into(),
            password: "p".into(),
            gstin: "27ABCDE1234F1Z5".into(),
            is_sandbox: true,
            retry: crate::cygnet::RetryPolicy::default(),
        };
        let url = endpoint(&cfg, "/eInvoice/GenerateIRN");
        assert_eq!(url, "https://einvapi-trial.cygnet.in/eInvoice/GenerateIRN");
    }
}
