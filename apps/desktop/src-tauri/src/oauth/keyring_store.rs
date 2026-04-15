// OS keyring wrapper for Gmail refresh-token storage.
// service = "pharmacare-pro", account = "gmail:<shop_id>"

use keyring::Entry;

fn account_for(shop_id: &str) -> String {
    format!("gmail:{}", shop_id)
}

pub fn save_refresh(shop_id: &str, refresh_token: &str) -> Result<(), String> {
    let entry =
        Entry::new(super::SERVICE_NAME, &account_for(shop_id)).map_err(|e| e.to_string())?;
    entry.set_password(refresh_token).map_err(|e| e.to_string())
}

pub fn load_refresh(shop_id: &str) -> Result<Option<String>, String> {
    let entry =
        Entry::new(super::SERVICE_NAME, &account_for(shop_id)).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn has_refresh(shop_id: &str) -> Result<bool, String> {
    Ok(load_refresh(shop_id)?.is_some())
}

pub fn delete_refresh(shop_id: &str) -> Result<(), String> {
    let entry =
        Entry::new(super::SERVICE_NAME, &account_for(shop_id)).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
