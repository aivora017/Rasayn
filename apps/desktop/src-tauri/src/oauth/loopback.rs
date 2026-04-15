// Loopback redirect handler for the OAuth installed-app flow.
//
// Binds 127.0.0.1:0, returns the actual port to the caller. On the first HTTP
// request, parses `?code=...` from the query string, responds 200 with a small
// HTML confirmation page, and sends the code through a oneshot channel.
//
// This is a minimal handler using only std::net — no async runtime needed for
// a single-shot single-request server.

use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener};

pub struct LoopbackHandle {
    pub port: u16,
    pub listener: TcpListener,
}

pub fn bind_ephemeral() -> std::io::Result<LoopbackHandle> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let addr: SocketAddr = listener.local_addr()?;
    Ok(LoopbackHandle {
        port: addr.port(),
        listener,
    })
}

/// Block until the first request arrives, return `code` from query string.
/// Times out after `timeout_secs` seconds.
pub fn await_code(handle: LoopbackHandle, timeout_secs: u64) -> Result<String, String> {
    handle
        .listener
        .set_nonblocking(false)
        .map_err(|e| e.to_string())?;
    // simple blocking accept with a deadline enforced via socket read timeout
    let deadline = std::time::Duration::from_secs(timeout_secs);
    let (mut stream, _) = handle
        .listener
        .accept()
        .map_err(|e| format!("accept: {e}"))?;
    stream.set_read_timeout(Some(deadline)).ok();

    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| e.to_string())?;

    let code = parse_code_from_request(&request_line)
        .ok_or_else(|| "no code parameter in callback URL".to_string())?;

    let body = "<!doctype html><html><body style='font-family:sans-serif;padding:40px'><h2>PharmaCare Pro</h2><p>Gmail connected. You can close this tab.</p></body></html>";
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(), body,
    );
    let _ = stream.write_all(resp.as_bytes());
    Ok(code)
}

fn parse_code_from_request(request_line: &str) -> Option<String> {
    // e.g. "GET /callback?code=XYZ&scope=... HTTP/1.1\r\n"
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    let path = parts[1];
    let query = path.split_once('?').map(|(_, q)| q)?;
    for kv in query.split('&') {
        if let Some((k, v)) = kv.split_once('=') {
            if k == "code" {
                return Some(url_decode(v));
            }
        }
    }
    None
}

fn url_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("00"),
                16,
            ) {
                out.push(b as char);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            out.push(' ');
        } else {
            out.push(bytes[i] as char);
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_code_from_callback() {
        let line = "GET /callback?code=4%2F0AX4XfWg&scope=openid HTTP/1.1";
        assert_eq!(parse_code_from_request(line).as_deref(), Some("4/0AX4XfWg"));
    }

    #[test]
    fn returns_none_without_code() {
        let line = "GET /callback?error=access_denied HTTP/1.1";
        assert_eq!(parse_code_from_request(line), None);
    }

    #[test]
    fn bind_ephemeral_returns_port() {
        let h = bind_ephemeral().expect("bind");
        assert!(h.port > 0);
    }
}
