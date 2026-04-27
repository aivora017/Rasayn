//! ClearTax GSP wire-level HTTP adapter — only compiled with `cleartax-live` feature.
//!
//! Auth: OAuth2 bearer token (vs Cygnet's API key + RSA password).
//! Endpoint paths from cleartax::PATH_*. Same retry shape as cygnet_wire.

use crate::cleartax::{
    ClearTaxConfig, PATH_CANCEL_IRN, PATH_GENERATE_IRN,
};
use crate::commands::{IrnAckInner, IrnErrorInner, IrnPayloadOut};
use serde::{Deserialize, Serialize};
use std::thread::sleep;
use std::time::Duration;

const REQUEST_TIMEOUT_SECS: u64 = 12;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateIrnRequest<'a> {
    owner_id: &'a str,
    user_gstin: &'a str,
    payload: &'a IrnPayloadOut,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClearTaxAck {
    irn: String,
    ack_no: String,
    ack_date: String,
    #[serde(default)]
    signed_invoice: String,
    #[serde(default)]
    qr_code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClearTaxErr {
    error_code: String,
    error_msg: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ClearTaxResp {
    Ok(ClearTaxAck),
    Err(ClearTaxErr),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CancelIrnRequest<'a> {
    irn: &'a str,
    reason_code: u8,
    remarks: &'a str,
}

fn build_client(cfg: &ClearTaxConfig) -> Result<reqwest::blocking::Client, IrnErrorInner> {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert(
        reqwest::header::AUTHORIZATION,
        format!("Bearer {}", cfg.auth_token).parse().map_err(|e| IrnErrorInner {
            code: "CLEARTAX_BAD_AUTH_TOKEN".into(),
            msg: format!("token not a valid header value: {e}"),
        })?,
    );
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .default_headers(h)
        .build()
        .map_err(|e| IrnErrorInner {
            code: "CLEARTAX_CLIENT_BUILD_FAILED".into(),
            msg: format!("reqwest client init: {e}"),
        })
}

fn endpoint(cfg: &ClearTaxConfig, path: &str) -> String {
    format!("{}{}", cfg.base_url.trim_end_matches('/'), path)
}

fn parse_cancel_reason(reason: &str) -> Result<u8, IrnErrorInner> {
    match reason.trim() {
        "1" | "duplicate" => Ok(1),
        "2" | "data_entry_mistake" => Ok(2),
        "3" | "order_cancelled" => Ok(3),
        "4" | "other" => Ok(4),
        other => Err(IrnErrorInner {
            code: "CLEARTAX_BAD_CANCEL_REASON".into(),
            msg: format!("cancel reason '{other}' not in {{1,2,3,4}}"),
        }),
    }
}

pub fn submit_irn_live(
    cfg: &ClearTaxConfig,
    payload: &IrnPayloadOut,
) -> Result<IrnAckInner, IrnErrorInner> {
    let client = build_client(cfg)?;
    let url = endpoint(cfg, PATH_GENERATE_IRN);
    let body = GenerateIrnRequest {
        owner_id: &cfg.owner_id,
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
                let parsed: Result<ClearTaxResp, _> = r.json();
                match parsed {
                    Ok(ClearTaxResp::Ok(ack)) if status.is_success() => {
                        return Ok(IrnAckInner {
                            irn: ack.irn,
                            ack_no: ack.ack_no,
                            ack_date: ack.ack_date,
                            signed_invoice: ack.signed_invoice,
                            qr_code: ack.qr_code,
                        });
                    }
                    Ok(ClearTaxResp::Err(e)) => {
                        return Err(IrnErrorInner {
                            code: format!("CLEARTAX_{}", e.error_code),
                            msg: e.error_msg,
                        });
                    }
                    Ok(ClearTaxResp::Ok(_)) => {
                        return Err(IrnErrorInner {
                            code: "CLEARTAX_PROTOCOL_VIOLATION".into(),
                            msg: format!("OK body with non-2xx {status}"),
                        });
                    }
                    Err(e) if status.is_server_error() && attempt < cfg.retry.max_attempts => {
                        sleep(Duration::from_millis(backoff));
                        backoff = backoff.saturating_mul(2);
                        continue;
                    }
                    Err(e) => {
                        return Err(IrnErrorInner {
                            code: "CLEARTAX_BAD_RESPONSE".into(),
                            msg: format!("response parse: {e} (status {status})"),
                        });
                    }
                }
            }
            Err(e) if attempt < cfg.retry.max_attempts => {
                sleep(Duration::from_millis(backoff));
                backoff = backoff.saturating_mul(2);
                continue;
            }
            Err(e) => {
                return Err(IrnErrorInner {
                    code: "CLEARTAX_NETWORK".into(),
                    msg: format!("after {attempt} attempts: {e}"),
                });
            }
        }
    }
}

pub fn cancel_irn_live(
    cfg: &ClearTaxConfig,
    irn: &str,
    reason: &str,
    remarks: &str,
) -> Result<(), IrnErrorInner> {
    let reason_code = parse_cancel_reason(reason)?;
    let client = build_client(cfg)?;
    let url = endpoint(cfg, PATH_CANCEL_IRN);
    let body = CancelIrnRequest {
        irn,
        reason_code,
        remarks,
    };
    let resp = client.post(&url).json(&body).send().map_err(|e| IrnErrorInner {
        code: "CLEARTAX_NETWORK".into(),
        msg: format!("cancel: {e}"),
    })?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(IrnErrorInner {
            code: format!("CLEARTAX_CANCEL_HTTP_{}", resp.status().as_u16()),
            msg: resp.text().unwrap_or_default(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_cancel_reason_digit_or_snake_label() {
        assert_eq!(parse_cancel_reason("1").unwrap(), 1);
        assert_eq!(parse_cancel_reason("data_entry_mistake").unwrap(), 2);
        assert_eq!(parse_cancel_reason("order_cancelled").unwrap(), 3);
        assert!(parse_cancel_reason("badcode").is_err());
    }

    #[test]
    fn endpoint_normalizes_trailing_slash() {
        let cfg = ClearTaxConfig {
            base_url: "https://einvapi-sandbox.cleartax.in/".into(),
            auth_token: "x".into(),
            owner_id: "o".into(),
            gstin: "27ABCDE1234F1Z5".into(),
            is_sandbox: true,
            retry: crate::cleartax::RetryPolicy::default(),
        };
        assert_eq!(
            endpoint(&cfg, "/v2/eInvoice"),
            "https://einvapi-sandbox.cleartax.in/v2/eInvoice"
        );
    }
}
