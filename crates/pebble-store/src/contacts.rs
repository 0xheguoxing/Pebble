use std::collections::HashSet;

use pebble_core::{
    Contact, ContactEmail, ContactEmailInput, ContactEmailLabel, ContactInput, KnownContact,
    PebbleError, Result,
};
use rusqlite::{params, Connection, OptionalExtension};

use crate::Store;

fn contact_label_to_str(label: &ContactEmailLabel) -> &'static str {
    match label {
        ContactEmailLabel::Work => "work",
        ContactEmailLabel::Personal => "personal",
        ContactEmailLabel::Other => "other",
    }
}

fn str_to_contact_label(label: &str) -> ContactEmailLabel {
    match label {
        "work" => ContactEmailLabel::Work,
        "personal" => ContactEmailLabel::Personal,
        _ => ContactEmailLabel::Other,
    }
}

fn prepare_email(input: &ContactEmailInput) -> Result<(String, String)> {
    let address = input.address.trim().to_string();
    if address.is_empty() || address.len() > 320 {
        return Err(PebbleError::Validation(
            "Email address is required and must not exceed 320 characters".to_string(),
        ));
    }
    if address.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(PebbleError::Validation(format!(
            "Invalid email address: {}",
            input.address
        )));
    }
    let Some((local, domain)) = address.split_once('@') else {
        return Err(PebbleError::Validation(format!(
            "Invalid email address: {}",
            input.address
        )));
    };
    if local.is_empty()
        || local.len() > 64
        || domain.is_empty()
        || domain.contains('@')
        || domain.starts_with('.')
        || domain.ends_with('.')
        || !domain.contains('.')
    {
        return Err(PebbleError::Validation(format!(
            "Invalid email address: {}",
            input.address
        )));
    }
    Ok((address.clone(), address.to_lowercase()))
}

fn validate_contact_input(input: &ContactInput) -> Result<Vec<(String, String)>> {
    if input.emails.is_empty() {
        return Err(PebbleError::Validation(
            "A contact must have at least one email address".to_string(),
        ));
    }
    if input.notes.chars().count() > 2000 {
        return Err(PebbleError::Validation(
            "Contact notes must not exceed 2000 characters".to_string(),
        ));
    }
    let primary_count = input.emails.iter().filter(|email| email.is_primary).count();
    if primary_count != 1 {
        return Err(PebbleError::Validation(
            "A contact must have exactly one primary email address".to_string(),
        ));
    }

    let mut seen = HashSet::new();
    let mut prepared = Vec::with_capacity(input.emails.len());
    for email in &input.emails {
        let values = prepare_email(email)?;
        if !seen.insert(values.1.clone()) {
            return Err(PebbleError::Validation(format!(
                "Duplicate email address: {}",
                email.address.trim()
            )));
        }
        prepared.push(values);
    }
    Ok(prepared)
}

fn load_contact_with_conn(conn: &Connection, contact_id: &str) -> Result<Option<Contact>> {
    let row = conn
        .query_row(
            "SELECT id, display_name, notes, is_favorite, created_at, updated_at
             FROM contacts WHERE id = ?1",
            params![contact_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            },
        )
        .optional()?;
    let Some((id, display_name, notes, is_favorite, created_at, updated_at)) = row else {
        return Ok(None);
    };

    let mut stmt = conn.prepare(
        "SELECT id, address, label, is_primary
         FROM contact_emails
         WHERE contact_id = ?1
         ORDER BY is_primary DESC, created_at ASC, id ASC",
    )?;
    let emails = stmt
        .query_map(params![id], |row| {
            Ok(ContactEmail {
                id: row.get(0)?,
                address: row.get(1)?,
                label: str_to_contact_label(&row.get::<_, String>(2)?),
                is_primary: row.get(3)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(Some(Contact {
        id,
        display_name,
        notes,
        is_favorite,
        emails,
        created_at,
        updated_at,
    }))
}

impl Store {
    pub fn save_contact(&self, input: &ContactInput) -> Result<Contact> {
        let prepared_emails = validate_contact_input(input)?;
        let display_name = input.display_name.trim().to_string();
        let notes = input.notes.trim().to_string();
        let now = pebble_core::now_timestamp();

        self.with_write(|conn| {
            let tx = conn.unchecked_transaction()?;
            let (contact_id, created_at, existing_email_ids) = if let Some(id) = &input.id {
                if id.trim().is_empty() {
                    return Err(PebbleError::Validation(
                        "Contact id must not be empty".to_string(),
                    ));
                }
                let created_at = tx
                    .query_row(
                        "SELECT created_at FROM contacts WHERE id = ?1",
                        params![id],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()?
                    .ok_or_else(|| PebbleError::Validation(format!("Contact not found: {id}")))?;
                let mut stmt = tx.prepare("SELECT id FROM contact_emails WHERE contact_id = ?1")?;
                let existing_ids = stmt
                    .query_map(params![id], |row| row.get::<_, String>(0))?
                    .collect::<std::result::Result<HashSet<_>, _>>()?;
                (id.clone(), created_at, existing_ids)
            } else {
                (pebble_core::new_id(), now, HashSet::new())
            };

            for (_, normalized) in &prepared_emails {
                let owner: Option<String> = tx
                    .query_row(
                        "SELECT contact_id FROM contact_emails
                         WHERE normalized_address = ?1 COLLATE NOCASE AND contact_id != ?2",
                        params![normalized, contact_id],
                        |row| row.get(0),
                    )
                    .optional()?;
                if owner.is_some() {
                    return Err(PebbleError::Validation(format!(
                        "Email address already belongs to another contact: {normalized}"
                    )));
                }
            }

            if input.id.is_some() {
                tx.execute(
                    "UPDATE contacts
                     SET display_name = ?1, notes = ?2, is_favorite = ?3, updated_at = ?4
                     WHERE id = ?5",
                    params![display_name, notes, input.is_favorite, now, contact_id],
                )?;
                tx.execute(
                    "DELETE FROM contact_emails WHERE contact_id = ?1",
                    params![contact_id],
                )?;
            } else {
                tx.execute(
                    "INSERT INTO contacts
                        (id, display_name, notes, is_favorite, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        contact_id,
                        display_name,
                        notes,
                        input.is_favorite,
                        created_at,
                        now
                    ],
                )?;
            }

            for (index, email) in input.emails.iter().enumerate() {
                let (address, normalized) = &prepared_emails[index];
                let email_id = email
                    .id
                    .as_ref()
                    .filter(|id| existing_email_ids.contains(*id))
                    .cloned()
                    .unwrap_or_else(pebble_core::new_id);
                tx.execute(
                    "INSERT INTO contact_emails
                        (id, contact_id, address, normalized_address, label, is_primary, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        email_id,
                        contact_id,
                        address,
                        normalized,
                        contact_label_to_str(&email.label),
                        email.is_primary,
                        now
                    ],
                )
                .map_err(|error| {
                    PebbleError::Validation(format!(
                        "Unable to save contact email {address}: {error}"
                    ))
                })?;
            }

            let contact = load_contact_with_conn(&tx, &contact_id)?.ok_or_else(|| {
                PebbleError::Internal("Saved contact could not be loaded".to_string())
            })?;
            tx.commit()?;
            Ok(contact)
        })
    }

    pub fn get_contact(&self, contact_id: &str) -> Result<Option<Contact>> {
        self.with_read(|conn| load_contact_with_conn(conn, contact_id))
    }

    pub fn list_contacts(
        &self,
        query: Option<&str>,
        favorite_only: bool,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Contact>> {
        let query = query.unwrap_or_default().trim();
        let escaped = query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pattern = format!("%{escaped}%");
        let limit = limit.clamp(1, 200);
        let offset = offset.max(0);

        self.with_read(|conn| {
            let mut stmt = conn.prepare(
                "SELECT c.id
                 FROM contacts c
                 WHERE (?1 = '' OR c.display_name LIKE ?2 ESCAPE '\\' COLLATE NOCASE
                        OR EXISTS (
                            SELECT 1 FROM contact_emails ce
                            WHERE ce.contact_id = c.id
                              AND ce.address LIKE ?2 ESCAPE '\\' COLLATE NOCASE
                        ))
                   AND (?3 = 0 OR c.is_favorite = 1)
                 ORDER BY LOWER(CASE
                     WHEN c.display_name = '' THEN COALESCE((
                         SELECT ce.address FROM contact_emails ce
                         WHERE ce.contact_id = c.id
                         ORDER BY ce.is_primary DESC, ce.created_at ASC LIMIT 1
                     ), '')
                     ELSE c.display_name
                 END) ASC, c.id ASC
                 LIMIT ?4 OFFSET ?5",
            )?;
            let ids = stmt
                .query_map(
                    params![query, pattern, favorite_only, limit, offset],
                    |row| row.get::<_, String>(0),
                )?
                .collect::<std::result::Result<Vec<_>, _>>()?;

            ids.into_iter()
                .map(|id| {
                    load_contact_with_conn(conn, &id)?.ok_or_else(|| {
                        PebbleError::Internal(format!("Contact disappeared while listing: {id}"))
                    })
                })
                .collect()
        })
    }

    pub fn delete_contact(&self, contact_id: &str, _suppress_addresses: bool) -> Result<()> {
        self.with_write(|conn| {
            let deleted =
                conn.execute("DELETE FROM contacts WHERE id = ?1", params![contact_id])?;
            if deleted == 0 {
                return Err(PebbleError::Validation(format!(
                    "Contact not found: {contact_id}"
                )));
            }
            Ok(())
        })
    }

    pub fn set_contact_favorite(&self, contact_id: &str, is_favorite: bool) -> Result<()> {
        self.with_write(|conn| {
            let updated = conn.execute(
                "UPDATE contacts SET is_favorite = ?1, updated_at = ?2 WHERE id = ?3",
                params![is_favorite, pebble_core::now_timestamp(), contact_id],
            )?;
            if updated == 0 {
                return Err(PebbleError::Validation(format!(
                    "Contact not found: {contact_id}"
                )));
            }
            Ok(())
        })
    }

    /// Query distinct contacts from the messages table matching a prefix.
    ///
    /// Searches `from_address`/`from_name` columns and also parses `to_list`
    /// JSON arrays to extract recipient contacts.  Results are deduplicated by
    /// email address (case-insensitive) and limited to `limit` rows.
    pub fn list_known_contacts(
        &self,
        account_id: &str,
        query: &str,
        limit: i64,
    ) -> Result<Vec<KnownContact>> {
        self.with_read(|conn| {
            let escaped = query
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_");
            let pattern = format!("%{}%", escaped);

            // First: collect contacts from from_address / from_name columns
            let mut stmt = conn.prepare(
                "SELECT DISTINCT from_name, from_address
                     FROM messages
                     WHERE account_id = ?1
                       AND is_deleted = 0
                       AND (from_address LIKE ?2 ESCAPE '\\' OR from_name LIKE ?2 ESCAPE '\\')
                     LIMIT ?3",
            )?;

            let from_rows = stmt.query_map(params![account_id, pattern, limit], |row| {
                let name: String = row.get(0)?;
                let address: String = row.get(1)?;
                Ok(KnownContact {
                    name: if name.is_empty() { None } else { Some(name) },
                    address,
                })
            })?;

            let mut seen = std::collections::HashSet::new();
            let mut contacts = Vec::new();

            for row in from_rows {
                let contact = row?;
                let key = contact.address.to_lowercase();
                if seen.insert(key) {
                    contacts.push(contact);
                }
            }

            // Second: search inside to_list JSON for matching recipients
            if (contacts.len() as i64) < limit {
                let remaining = limit - contacts.len() as i64;
                let mut stmt2 = conn.prepare(
                    "SELECT DISTINCT to_list
                         FROM messages
                         WHERE account_id = ?1
                           AND is_deleted = 0
                           AND to_list LIKE ?2 ESCAPE '\\'
                         LIMIT ?3",
                )?;

                let to_rows = stmt2
                    .query_map(params![account_id, pattern, remaining * 5], |row| {
                        row.get::<_, String>(0)
                    })?;

                for row in to_rows {
                    if contacts.len() as i64 >= limit {
                        break;
                    }
                    let json_str = row?;
                    if let Ok(addrs) =
                        serde_json::from_str::<Vec<pebble_core::EmailAddress>>(&json_str)
                    {
                        let lower_query = query.to_lowercase();
                        for addr in addrs {
                            if contacts.len() as i64 >= limit {
                                break;
                            }
                            let matches = addr.address.to_lowercase().contains(&lower_query)
                                || addr
                                    .name
                                    .as_ref()
                                    .map(|n| n.to_lowercase().contains(&lower_query))
                                    .unwrap_or(false);
                            if matches {
                                let key = addr.address.to_lowercase();
                                if seen.insert(key) {
                                    contacts.push(KnownContact {
                                        name: addr.name,
                                        address: addr.address,
                                    });
                                }
                            }
                        }
                    }
                }
            }

            Ok(contacts)
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::Store;
    use pebble_core::*;

    fn contact_input(name: &str, address: &str) -> ContactInput {
        ContactInput {
            id: None,
            display_name: name.to_string(),
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

    fn setup_store_with_contacts() -> (Store, String) {
        let store = Store::open_in_memory().unwrap();
        let now = now_timestamp();
        let account = Account {
            id: new_id(),
            email: "me@example.com".to_string(),
            display_name: "Me".to_string(),
            color: None,
            provider: ProviderType::Imap,
            created_at: now,
            updated_at: now,
        };
        store.insert_account(&account).unwrap();

        let folder = Folder {
            id: new_id(),
            account_id: account.id.clone(),
            remote_id: "INBOX".to_string(),
            name: "Inbox".to_string(),
            folder_type: FolderType::Folder,
            role: Some(FolderRole::Inbox),
            parent_id: None,
            color: None,
            is_system: true,
            sort_order: 0,
        };
        store.insert_folder(&folder).unwrap();

        // Message from alice
        let msg1 = Message {
            id: new_id(),
            account_id: account.id.clone(),
            remote_id: "1".to_string(),
            message_id_header: None,
            in_reply_to: None,
            references_header: None,
            thread_id: None,
            subject: "Hello".to_string(),
            snippet: "hi".to_string(),
            from_address: "alice@example.com".to_string(),
            from_name: "Alice Smith".to_string(),
            to_list: vec![EmailAddress {
                name: Some("Bob Jones".to_string()),
                address: "bob@example.com".to_string(),
            }],
            cc_list: vec![],
            bcc_list: vec![],
            body_text: "hi".to_string(),
            body_html_raw: "<p>hi</p>".to_string(),
            has_attachments: false,
            is_read: true,
            is_starred: false,
            is_draft: false,
            date: now,
            remote_version: None,
            is_deleted: false,
            deleted_at: None,
            created_at: now,
            updated_at: now,
        };
        store
            .insert_message(&msg1, std::slice::from_ref(&folder.id))
            .unwrap();

        // Message from charlie
        let msg2 = Message {
            id: new_id(),
            account_id: account.id.clone(),
            remote_id: "2".to_string(),
            message_id_header: None,
            in_reply_to: None,
            references_header: None,
            thread_id: None,
            subject: "Hey".to_string(),
            snippet: "hey".to_string(),
            from_address: "charlie@other.com".to_string(),
            from_name: "Charlie".to_string(),
            to_list: vec![EmailAddress {
                name: Some("Me".to_string()),
                address: "me@example.com".to_string(),
            }],
            cc_list: vec![],
            bcc_list: vec![],
            body_text: "hey".to_string(),
            body_html_raw: "<p>hey</p>".to_string(),
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
        };
        store
            .insert_message(&msg2, std::slice::from_ref(&folder.id))
            .unwrap();

        (store, account.id)
    }

    #[test]
    fn test_list_known_contacts_by_from_address() {
        let (store, account_id) = setup_store_with_contacts();
        let results = store.list_known_contacts(&account_id, "alice", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].address, "alice@example.com");
        assert_eq!(results[0].name.as_deref(), Some("Alice Smith"));
    }

    #[test]
    fn test_list_known_contacts_by_to_list() {
        let (store, account_id) = setup_store_with_contacts();
        let results = store.list_known_contacts(&account_id, "bob", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].address, "bob@example.com");
        assert_eq!(results[0].name.as_deref(), Some("Bob Jones"));
    }

    #[test]
    fn test_list_known_contacts_broad_query() {
        let (store, account_id) = setup_store_with_contacts();
        let results = store
            .list_known_contacts(&account_id, "example", 10)
            .unwrap();
        // alice@example.com from from_address, bob@example.com from to_list, me@example.com from to_list
        assert!(results.len() >= 2);
    }

    #[test]
    fn test_list_known_contacts_empty_query() {
        let (store, account_id) = setup_store_with_contacts();
        let results = store.list_known_contacts(&account_id, "", 10).unwrap();
        // Should return all known contacts
        assert!(results.len() >= 2);
    }

    #[test]
    fn test_list_known_contacts_respects_limit() {
        let (store, account_id) = setup_store_with_contacts();
        let results = store.list_known_contacts(&account_id, "", 1).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_list_known_contacts_no_match() {
        let (store, account_id) = setup_store_with_contacts();
        let results = store
            .list_known_contacts(&account_id, "zzzznotfound", 10)
            .unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn contact_crud_round_trips_multiple_emails() {
        let store = Store::open_in_memory().unwrap();
        let input = ContactInput {
            id: None,
            display_name: " Alice Smith ".to_string(),
            notes: "Met at RustConf".to_string(),
            is_favorite: true,
            emails: vec![
                ContactEmailInput {
                    id: None,
                    address: " Alice@Example.com ".to_string(),
                    label: ContactEmailLabel::Work,
                    is_primary: true,
                },
                ContactEmailInput {
                    id: None,
                    address: "alice@home.example".to_string(),
                    label: ContactEmailLabel::Personal,
                    is_primary: false,
                },
            ],
        };

        let saved = store.save_contact(&input).unwrap();
        assert_eq!(saved.display_name, "Alice Smith");
        assert_eq!(saved.emails.len(), 2);
        assert_eq!(saved.emails[0].address, "Alice@Example.com");
        assert!(saved.emails[0].is_primary);
        assert!(saved.is_favorite);

        let loaded = store.get_contact(&saved.id).unwrap().unwrap();
        assert_eq!(loaded, saved);
    }

    #[test]
    fn contact_save_requires_email() {
        let store = Store::open_in_memory().unwrap();
        let no_email = ContactInput {
            emails: vec![],
            ..contact_input("Nobody", "unused@example.com")
        };
        assert!(matches!(
            store.save_contact(&no_email),
            Err(PebbleError::Validation(_))
        ));
    }

    #[test]
    fn contact_save_rejects_invalid_email() {
        let store = Store::open_in_memory().unwrap();
        let invalid_email = contact_input("Invalid", "not-an-address");
        assert!(matches!(
            store.save_contact(&invalid_email),
            Err(PebbleError::Validation(_))
        ));
    }

    #[test]
    fn contact_save_requires_exactly_one_primary_email() {
        let store = Store::open_in_memory().unwrap();
        let multiple_primary = ContactInput {
            emails: vec![
                ContactEmailInput {
                    id: None,
                    address: "one@example.com".to_string(),
                    label: ContactEmailLabel::Work,
                    is_primary: true,
                },
                ContactEmailInput {
                    id: None,
                    address: "two@example.com".to_string(),
                    label: ContactEmailLabel::Personal,
                    is_primary: true,
                },
            ],
            ..contact_input("Two Primaries", "unused@example.com")
        };
        assert!(matches!(
            store.save_contact(&multiple_primary),
            Err(PebbleError::Validation(_))
        ));
    }

    #[test]
    fn contact_save_rejects_notes_over_limit() {
        let store = Store::open_in_memory().unwrap();
        let input = ContactInput {
            notes: "a".repeat(2001),
            ..contact_input("Verbose", "verbose@example.com")
        };

        assert!(matches!(
            store.save_contact(&input),
            Err(PebbleError::Validation(_))
        ));
    }

    #[test]
    fn contact_duplicate_email_is_case_insensitive_and_atomic() {
        let store = Store::open_in_memory().unwrap();
        let first = store
            .save_contact(&contact_input("Alice", "Alice@Example.com"))
            .unwrap();

        let duplicate = store.save_contact(&contact_input("Other Alice", "alice@example.COM"));
        assert!(matches!(duplicate, Err(PebbleError::Validation(_))));

        let contacts = store.list_contacts(None, false, 20, 0).unwrap();
        assert_eq!(contacts.len(), 1);
        assert_eq!(contacts[0].id, first.id);
    }

    #[test]
    fn contact_edit_replaces_emails_and_preserves_created_at() {
        let store = Store::open_in_memory().unwrap();
        let created = store
            .save_contact(&contact_input("Alice", "old@example.com"))
            .unwrap();
        let updated = store
            .save_contact(&ContactInput {
                id: Some(created.id.clone()),
                display_name: "Alice Updated".to_string(),
                notes: "New note".to_string(),
                is_favorite: true,
                emails: vec![ContactEmailInput {
                    id: None,
                    address: "new@example.com".to_string(),
                    label: ContactEmailLabel::Work,
                    is_primary: true,
                }],
            })
            .unwrap();

        assert_eq!(updated.id, created.id);
        assert_eq!(updated.created_at, created.created_at);
        assert!(updated.updated_at >= created.updated_at);
        assert_eq!(updated.emails.len(), 1);
        assert_eq!(updated.emails[0].address, "new@example.com");
    }

    #[test]
    fn contact_list_searches_filters_favorites_and_paginates() {
        let store = Store::open_in_memory().unwrap();
        let alice = store
            .save_contact(&contact_input("Alice", "alice@example.com"))
            .unwrap();
        let mut bob_input = contact_input("Bob", "bob@work.test");
        bob_input.is_favorite = true;
        let bob = store.save_contact(&bob_input).unwrap();
        store
            .save_contact(&contact_input("Charlie", "charlie@example.net"))
            .unwrap();

        let by_name = store.list_contacts(Some("ali"), false, 20, 0).unwrap();
        assert_eq!(
            by_name.iter().map(|c| &c.id).collect::<Vec<_>>(),
            vec![&alice.id]
        );

        let by_email = store
            .list_contacts(Some("work.test"), false, 20, 0)
            .unwrap();
        assert_eq!(
            by_email.iter().map(|c| &c.id).collect::<Vec<_>>(),
            vec![&bob.id]
        );

        let favorites = store.list_contacts(None, true, 20, 0).unwrap();
        assert_eq!(
            favorites.iter().map(|c| &c.id).collect::<Vec<_>>(),
            vec![&bob.id]
        );

        let page = store.list_contacts(None, false, 1, 1).unwrap();
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].display_name, "Bob");
    }

    #[test]
    fn contact_favorite_and_delete_update_persisted_contact() {
        let store = Store::open_in_memory().unwrap();
        let saved = store
            .save_contact(&contact_input("Alice", "alice@example.com"))
            .unwrap();

        store.set_contact_favorite(&saved.id, true).unwrap();
        assert!(store.get_contact(&saved.id).unwrap().unwrap().is_favorite);

        store.delete_contact(&saved.id, false).unwrap();
        assert!(store.get_contact(&saved.id).unwrap().is_none());
    }
}
