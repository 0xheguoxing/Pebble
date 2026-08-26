use crate::commands::indexing::apply_rule_action;
use crate::commands::messages::refresh_search_documents_with_store;
use crate::state::AppState;
use pebble_core::{new_id, now_timestamp, PebbleError, Rule};
use pebble_rules::RuleEngine;
use pebble_search::TantivySearch;
use pebble_store::Store;
use tauri::State;

#[tauri::command]
pub async fn create_rule(
    state: State<'_, AppState>,
    name: String,
    priority: i32,
    conditions: String,
    actions: String,
) -> std::result::Result<Rule, PebbleError> {
    let now = now_timestamp();
    let rule = Rule {
        id: new_id(),
        name,
        priority,
        conditions,
        actions,
        is_enabled: true,
        created_at: now,
        updated_at: now,
    };
    state.store.insert_rule(&rule)?;
    Ok(rule)
}

#[tauri::command]
pub async fn list_rules(state: State<'_, AppState>) -> std::result::Result<Vec<Rule>, PebbleError> {
    state.store.list_rules()
}

#[tauri::command]
pub async fn update_rule(
    state: State<'_, AppState>,
    rule: Rule,
) -> std::result::Result<(), PebbleError> {
    state.store.update_rule(&rule)
}

#[tauri::command]
pub async fn delete_rule(
    state: State<'_, AppState>,
    rule_id: String,
) -> std::result::Result<(), PebbleError> {
    state.store.delete_rule(&rule_id)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RunRulesResult {
    pub rules_loaded: usize,
    pub messages_scanned: usize,
    pub messages_matched: usize,
    pub actions_applied: usize,
}

/// Run all enabled rules against every already-stored message, applying the
/// matched actions (move to folder, archive, mark read, add label, kanban).
/// Useful for organizing mail that was received before a rule was created.
#[tauri::command]
pub async fn run_rules_now(
    state: State<'_, AppState>,
) -> std::result::Result<RunRulesResult, PebbleError> {
    let store = state.store.clone();
    let search = state.search.clone();
    tokio::task::spawn_blocking(move || run_rules_on_existing_messages(&store, &search))
        .await
        .map_err(|e| PebbleError::Internal(format!("Task join error: {e}")))?
}

fn run_rules_on_existing_messages(
    store: &Store,
    search: &TantivySearch,
) -> std::result::Result<RunRulesResult, PebbleError> {
    let rules = store.list_rules()?;
    let engine = RuleEngine::new(&rules);
    let rules_loaded = engine.rule_count();
    if rules_loaded == 0 {
        return Ok(RunRulesResult {
            rules_loaded: 0,
            messages_scanned: 0,
            messages_matched: 0,
            actions_applied: 0,
        });
    }

    let accounts = store.list_accounts()?;
    let mut messages_scanned = 0usize;
    let mut messages_matched = 0usize;
    let mut actions_applied = 0usize;
    let mut affected_message_ids: Vec<String> = Vec::new();

    const BATCH_SIZE: usize = 200;
    for account in &accounts {
        let mut offset = 0usize;
        loop {
            let messages = store.list_full_messages_by_account(
                &account.id,
                BATCH_SIZE as u32,
                offset as u32,
            )?;
            if messages.is_empty() {
                break;
            }

            for message in &messages {
                messages_scanned += 1;
                let actions = engine.evaluate(message);
                if actions.is_empty() {
                    continue;
                }
                messages_matched += 1;
                for action in &actions {
                    match apply_rule_action(store, &account.id, &message.id, action) {
                        Ok(()) => actions_applied += 1,
                        Err(e) => {
                            tracing::warn!(
                                "Rule action failed for message {}: {e}",
                                message.id
                            );
                        }
                    }
                }
                affected_message_ids.push(message.id.clone());
            }

            offset += messages.len();
            if messages.len() < BATCH_SIZE {
                break;
            }
        }
    }

    if let Err(e) =
        refresh_search_documents_with_store(store, search, &affected_message_ids)
    {
        tracing::warn!("Failed to refresh search documents after running rules: {e}");
    }

    Ok(RunRulesResult {
        rules_loaded,
        messages_scanned,
        messages_matched,
        actions_applied,
    })
}
