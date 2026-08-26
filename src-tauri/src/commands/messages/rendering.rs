use crate::state::AppState;
use pebble_core::{Message, PebbleError, PrivacyMode, RenderedHtml, TrustType};
use pebble_privacy::{normalize_cid, PrivacyGuard};
use pebble_store::Store;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::State;

#[tauri::command]
pub async fn get_rendered_html(
    state: State<'_, AppState>,
    message_id: String,
    privacy_mode: PrivacyMode,
) -> std::result::Result<RenderedHtml, PebbleError> {
    let store = state.store.clone();
    let attachments_dir = state.attachments_dir.clone();
    tokio::task::spawn_blocking(move || {
        let message = store
            .get_message(&message_id)?
            .ok_or_else(|| PebbleError::Internal(format!("Message not found: {message_id}")))?;

        let effective_mode = resolve_privacy_mode(&store, &message, privacy_mode)?;
        let cid_images = build_cid_image_map(&store, &attachments_dir, &message_id)?;
        let guard = PrivacyGuard::new();
        Ok(guard.render_message_html_with_cid_images(
            &message.body_html_raw,
            &message.body_text,
            &effective_mode,
            &cid_images,
        ))
    })
    .await
    .map_err(|e| PebbleError::Internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn get_message_with_html(
    state: State<'_, AppState>,
    message_id: String,
    privacy_mode: PrivacyMode,
) -> std::result::Result<Option<(Message, RenderedHtml)>, PebbleError> {
    let store = state.store.clone();
    let attachments_dir = state.attachments_dir.clone();
    tokio::task::spawn_blocking(move || {
        let message = match store.get_message(&message_id)? {
            Some(m) => m,
            None => return Ok(None),
        };

        let effective_mode = resolve_privacy_mode(&store, &message, privacy_mode)?;
        let cid_images = build_cid_image_map(&store, &attachments_dir, &message_id)?;
        let guard = PrivacyGuard::new();
        let rendered = guard.render_message_html_with_cid_images(
            &message.body_html_raw,
            &message.body_text,
            &effective_mode,
            &cid_images,
        );
        Ok(Some((message, rendered)))
    })
    .await
    .map_err(|e| PebbleError::Internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn is_trusted_sender(
    state: State<'_, AppState>,
    account_id: String,
    email: String,
) -> std::result::Result<bool, PebbleError> {
    let store = state.store.clone();
    tokio::task::spawn_blocking(move || Ok(store.is_trusted_sender(&account_id, &email)?.is_some()))
        .await
        .map_err(|e| PebbleError::Internal(format!("Task join error: {e}")))?
}

fn resolve_privacy_mode(
    store: &Store,
    message: &Message,
    privacy_mode: PrivacyMode,
) -> std::result::Result<PrivacyMode, PebbleError> {
    match privacy_mode {
        PrivacyMode::Strict | PrivacyMode::LoadOnce => {
            match store.is_trusted_sender(&message.account_id, &message.from_address)? {
                Some(TrustType::All | TrustType::Images) => Ok(PrivacyMode::LoadOnce),
                None => Ok(privacy_mode),
            }
        }
        PrivacyMode::TrustSender(sender)
            if sender.eq_ignore_ascii_case(message.from_address.trim()) =>
        {
            match store.is_trusted_sender(&message.account_id, &message.from_address)? {
                Some(TrustType::All | TrustType::Images) => Ok(PrivacyMode::LoadOnce),
                None => Ok(PrivacyMode::Strict),
            }
        }
        PrivacyMode::TrustSender(_) => Ok(PrivacyMode::Strict),
        PrivacyMode::Off => Ok(PrivacyMode::Off),
    }
}

/// Builds a map from normalized content id to a loadable asset URL for a
/// message's inline attachments. Attachment files may have been recorded under
/// an older profile directory, so their paths are re-rooted to the current
/// attachments directory before being turned into URLs.
fn build_cid_image_map(
    store: &Store,
    attachments_dir: &Path,
    message_id: &str,
) -> std::result::Result<HashMap<String, String>, PebbleError> {
    let mut map = HashMap::new();
    for attachment in store.list_attachments_by_message(message_id)? {
        if !attachment.is_inline {
            continue;
        }
        let Some(content_id) = attachment.content_id else {
            continue;
        };
        let Some(cid) = normalize_cid(&content_id) else {
            continue;
        };
        let Some(local_path) = attachment.local_path else {
            continue;
        };
        let resolved = resolve_attachment_path(attachments_dir, &attachment.message_id, &local_path);
        map.insert(cid, asset_url(&resolved));
    }
    Ok(map)
}

/// Re-roots an attachment path that was recorded under a previous profile
/// directory to the current attachments directory. The stored path is expected
/// to contain the message id as a path segment; everything from that segment on
/// is preserved.
fn resolve_attachment_path(attachments_dir: &Path, message_id: &str, local_path: &str) -> PathBuf {
    let local = Path::new(local_path);
    if local.starts_with(attachments_dir) {
        return local.to_path_buf();
    }

    let mut resolved = attachments_dir.to_path_buf();
    let mut found = false;
    for component in local.components() {
        if !found {
            if component.as_os_str() == std::ffi::OsStr::new(message_id) {
                found = true;
            } else {
                continue;
            }
        }
        resolved.push(component.as_os_str());
    }

    if found {
        resolved
    } else {
        local.to_path_buf()
    }
}

/// Builds the asset-protocol URL Tauri uses to serve a local file to the
/// WebView (mirrors `convertFileSrc` on Windows).
fn asset_url(path: &Path) -> String {
    format!(
        "http://asset.localhost/{}",
        encode_uri_component(&path.to_string_lossy())
    )
}

/// Percent-encodes a path the same way `encodeURIComponent` does, so Tauri's
/// asset protocol can decode it back to the original filesystem path.
fn encode_uri_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~'
            | b'*' | b'\'' | b'(' | b')' => out.push(byte as char),
            _ => {
                out.push('%');
                out.push_str(&format!("{byte:02X}"));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use pebble_core::{
        new_id, now_timestamp, Account, EmailAddress, Folder, FolderRole, FolderType, Message,
        ProviderType, TrustType, TrustedSender,
    };

    fn make_account(id: &str) -> Account {
        let now = now_timestamp();
        Account {
            id: id.to_string(),
            email: "me@example.com".to_string(),
            display_name: "Me".to_string(),
            color: None,
            provider: ProviderType::Imap,
            created_at: now,
            updated_at: now,
        }
    }

    fn make_message(account_id: &str, from_address: &str) -> Message {
        let now = now_timestamp();
        Message {
            id: new_id(),
            account_id: account_id.to_string(),
            remote_id: "remote-1".to_string(),
            message_id_header: None,
            in_reply_to: None,
            references_header: None,
            thread_id: Some("thread-1".to_string()),
            subject: "Subject".to_string(),
            snippet: "Snippet".to_string(),
            from_address: from_address.to_string(),
            from_name: "Trusted".to_string(),
            to_list: vec![EmailAddress {
                name: None,
                address: "me@example.com".to_string(),
            }],
            cc_list: vec![],
            bcc_list: vec![],
            body_text: "Body".to_string(),
            body_html_raw: "<p>Body</p>".to_string(),
            has_attachments: false,
            is_read: false,
            is_starred: false,
            is_draft: false,
            date: now,
            remote_version: None,
            is_deleted: false,
            deleted_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn make_folder(account_id: &str) -> Folder {
        Folder {
            id: new_id(),
            account_id: account_id.to_string(),
            remote_id: "INBOX".to_string(),
            name: "Inbox".to_string(),
            role: Some(FolderRole::Inbox),
            folder_type: FolderType::Folder,
            parent_id: None,
            color: None,
            is_system: true,
            sort_order: 0,
        }
    }

    fn store_with_trusted_sender(trust_type: TrustType) -> (Store, Message) {
        let store = Store::open_in_memory().unwrap();
        let account = make_account("account-1");
        store.insert_account(&account).unwrap();
        let folder = make_folder(&account.id);
        store.insert_folder(&folder).unwrap();
        let message = make_message(&account.id, "trusted@example.com");
        store.insert_message(&message, &[folder.id]).unwrap();
        store
            .trust_sender(&TrustedSender {
                account_id: account.id,
                email: "trusted@example.com".to_string(),
                trust_type,
                created_at: now_timestamp(),
            })
            .unwrap();
        (store, message)
    }

    #[test]
    fn persistent_all_trust_resolves_to_tracker_safe_image_loading() {
        let (store, message) = store_with_trusted_sender(TrustType::All);

        let mode = resolve_privacy_mode(&store, &message, PrivacyMode::LoadOnce).unwrap();

        assert!(matches!(mode, PrivacyMode::LoadOnce));
    }

    #[test]
    fn sender_override_with_persistent_all_trust_stays_tracker_safe() {
        let (store, message) = store_with_trusted_sender(TrustType::All);

        let mode = resolve_privacy_mode(
            &store,
            &message,
            PrivacyMode::TrustSender("trusted@example.com".to_string()),
        )
        .unwrap();

        assert!(matches!(mode, PrivacyMode::LoadOnce));
    }

    #[test]
    fn sender_override_cannot_be_reused_for_a_different_message_sender() {
        let (store, mut message) = store_with_trusted_sender(TrustType::All);
        message.from_address = "other@example.com".to_string();

        let mode = resolve_privacy_mode(
            &store,
            &message,
            PrivacyMode::TrustSender("trusted@example.com".to_string()),
        )
        .unwrap();

        assert!(matches!(mode, PrivacyMode::Strict));
    }

    #[test]
    fn matching_sender_override_is_rejected_without_persisted_trust() {
        let store = Store::open_in_memory().unwrap();
        let account = make_account("account-1");
        store.insert_account(&account).unwrap();
        let message = make_message(&account.id, "sender@example.com");

        let mode = resolve_privacy_mode(
            &store,
            &message,
            PrivacyMode::TrustSender("sender@example.com".to_string()),
        )
        .unwrap();

        assert!(matches!(mode, PrivacyMode::Strict));
    }

    #[test]
    fn images_only_trust_cannot_be_escalated_by_sender_override() {
        let (store, message) = store_with_trusted_sender(TrustType::Images);

        let mode = resolve_privacy_mode(
            &store,
            &message,
            PrivacyMode::TrustSender("trusted@example.com".to_string()),
        )
        .unwrap();

        assert!(matches!(mode, PrivacyMode::LoadOnce));
    }
}
