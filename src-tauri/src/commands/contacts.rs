use crate::state::AppState;
use pebble_core::{
    Contact, ContactInput, ContactSuggestion, KnownContact, PebbleError, VcardImportResult,
};
use pebble_store::Store;
use tauri::State;

fn validated_contact_id(contact_id: &str) -> std::result::Result<&str, PebbleError> {
    let contact_id = contact_id.trim();
    if contact_id.is_empty() {
        return Err(PebbleError::Validation(
            "Contact id must not be empty".to_string(),
        ));
    }
    Ok(contact_id)
}

fn get_contact_with_store(
    store: &Store,
    contact_id: &str,
) -> std::result::Result<Option<Contact>, PebbleError> {
    store.get_contact(validated_contact_id(contact_id)?)
}

fn save_contact_with_store(
    store: &Store,
    input: &ContactInput,
) -> std::result::Result<Contact, PebbleError> {
    store.save_contact(input)
}

#[tauri::command]
pub async fn list_contacts(
    state: State<'_, AppState>,
    query: Option<String>,
    favorite_only: Option<bool>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> std::result::Result<Vec<Contact>, PebbleError> {
    state.store.list_contacts(
        query.as_deref(),
        favorite_only.unwrap_or(false),
        limit.unwrap_or(50),
        offset.unwrap_or(0),
    )
}

#[tauri::command]
pub async fn get_contact(
    state: State<'_, AppState>,
    contact_id: String,
) -> std::result::Result<Option<Contact>, PebbleError> {
    get_contact_with_store(&state.store, &contact_id)
}

#[tauri::command]
pub async fn save_contact(
    state: State<'_, AppState>,
    input: ContactInput,
) -> std::result::Result<Contact, PebbleError> {
    save_contact_with_store(&state.store, &input)
}

#[tauri::command]
pub async fn delete_contact(
    state: State<'_, AppState>,
    contact_id: String,
    suppress_addresses: Option<bool>,
) -> std::result::Result<(), PebbleError> {
    state.store.delete_contact(
        validated_contact_id(&contact_id)?,
        suppress_addresses.unwrap_or(false),
    )
}

#[tauri::command]
pub async fn set_contact_favorite(
    state: State<'_, AppState>,
    contact_id: String,
    is_favorite: bool,
) -> std::result::Result<(), PebbleError> {
    state
        .store
        .set_contact_favorite(validated_contact_id(&contact_id)?, is_favorite)
}

#[tauri::command]
pub async fn search_contact_suggestions(
    state: State<'_, AppState>,
    account_id: String,
    query: String,
    limit: Option<i64>,
) -> std::result::Result<Vec<ContactSuggestion>, PebbleError> {
    state
        .store
        .search_contact_suggestions(&account_id, &query, limit.unwrap_or(20))
}

#[tauri::command]
pub async fn suppress_contact_suggestion(
    state: State<'_, AppState>,
    address: String,
) -> std::result::Result<(), PebbleError> {
    state.store.suppress_contact_suggestion(&address)
}

#[tauri::command]
pub async fn import_contacts_vcard(
    state: State<'_, AppState>,
    data: String,
) -> std::result::Result<VcardImportResult, PebbleError> {
    state.store.import_contacts_vcard(&data)
}

#[tauri::command]
pub async fn export_contacts_vcard(
    state: State<'_, AppState>,
) -> std::result::Result<String, PebbleError> {
    state.store.export_contacts_vcard()
}

#[tauri::command]
pub async fn search_contacts(
    state: State<'_, AppState>,
    account_id: String,
    query: String,
    limit: Option<i64>,
) -> std::result::Result<Vec<KnownContact>, PebbleError> {
    let limit = limit.unwrap_or(20);
    state.store.list_known_contacts(&account_id, &query, limit)
}

#[cfg(test)]
mod tests {
    use super::{get_contact_with_store, save_contact_with_store};
    use pebble_core::{ContactEmailInput, ContactEmailLabel, ContactInput, PebbleError};
    use pebble_store::Store;

    fn input(address: &str) -> ContactInput {
        ContactInput {
            id: None,
            display_name: "Alice".to_string(),
            notes: String::new(),
            is_favorite: false,
            emails: vec![ContactEmailInput {
                id: None,
                address: address.to_string(),
                label: ContactEmailLabel::Other,
                is_primary: true,
            }],
        }
    }

    #[test]
    fn contact_command_rejects_empty_contact_id_as_validation() {
        let store = Store::open_in_memory().unwrap();

        assert!(matches!(
            get_contact_with_store(&store, "  "),
            Err(PebbleError::Validation(_))
        ));
    }

    #[test]
    fn contact_command_maps_invalid_email_to_validation() {
        let store = Store::open_in_memory().unwrap();

        assert!(matches!(
            save_contact_with_store(&store, &input("not-an-address")),
            Err(PebbleError::Validation(_))
        ));
    }

    #[test]
    fn contact_command_maps_duplicate_email_to_validation() {
        let store = Store::open_in_memory().unwrap();
        save_contact_with_store(&store, &input("Alice@example.com")).unwrap();

        assert!(matches!(
            save_contact_with_store(&store, &input("alice@EXAMPLE.COM")),
            Err(PebbleError::Validation(_))
        ));
    }
}
