# PR #89 Review Fixes Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolve all actionable Important and Minor findings on PR #89, verify the full repository, and merge the PR into `master`.

**Architecture:** Keep the existing SQLite/contact model, but enforce transaction and error boundaries in Rust, move blocking IPC work off Tokio workers, use exact cached participant lookups, virtualize the contact list, and harden the vCard state machine. Preserve local-wins vCard merge semantics and browser-default Tab navigation, documenting and testing both.

**Tech Stack:** Rust, rusqlite, Tokio/Tauri, React 19, TypeScript, TanStack React Query/Virtual, Vitest, Testing Library.

---

### Task 1: Encode contact-store validation and storage-error boundaries

**Files:**
- Modify: `crates/pebble-store/src/contacts.rs`
- Test: `crates/pebble-store/src/contacts.rs`
- Test: `crates/pebble-store/src/vcard.rs`

**Steps:**
1. Add failing tests for display names over 512 characters, exact case-insensitive email lookup, operational email-insert failures returning `Storage`, fatal vCard rollback, and replacement validation occurring before deletion.
2. Run `cargo test -p pebble-store contacts::tests` and the targeted vCard test; confirm failures describe missing validation/lookup or wrong error classes.
3. Add a shared display-name limit, exact lookup, selective SQLite constraint mapping, prevalidation of the complete restore payload, and a `&Transaction` replacement signature.
4. Re-run the targeted tests and then `cargo test -p pebble-store`.

### Task 2: Harden vCard parsing

**Files:**
- Modify: `crates/pebble-store/src/vcard.rs`

**Steps:**
1. Add failing tests for missing VERSION, nested cards not importing inner fragments, quoted custom parameters containing colon/equal/semicolon, and oversized names becoming partial validation errors.
2. Run the four targeted tests and confirm each fails for the expected parser behavior.
3. Implement quote-aware delimiter helpers, strict VERSION validation, nested-card depth tracking, and parse-time name limits.
4. Run all `pebble-store` tests.

### Task 3: Make backup reads stable and recent searches consistent

**Files:**
- Modify: `crates/pebble-store/src/contacts.rs`
- Modify: `crates/pebble-store/src/cloud_sync.rs`

**Steps:**
1. Add failing coverage for the new transaction-only backup contact loader and Cc/Bcc results in `list_known_contacts`.
2. Extract a connection-level contact-list helper and load all backup pages through a read transaction.
3. Add SQL-side history predicates for suggestion queries and search To/Cc/Bcc uniformly in the legacy query.
4. Run `cargo test -p pebble-store`.

### Task 4: Move contact IPC work off Tokio workers

**Files:**
- Modify: `src-tauri/src/commands/contacts.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/api.ts`

**Steps:**
1. Add a failing async test proving the store adapter runs on a different thread.
2. Add a generic `spawn_blocking` store adapter and route all contact commands through it.
3. Add the exact-email command/API and remove the unused get-by-ID IPC wrapper and registration.
4. Run the targeted Tauri command tests and `cargo check -p pebble`.

### Task 5: Cache participant lookups and deduplicate participants

**Files:**
- Modify: `src/hooks/queries/useContactsQuery.ts`
- Modify: `src/components/ContactAddressAction.tsx`
- Modify: `src/components/MessageDetail.tsx`
- Modify: `src/components/ThreadMessageBubble.tsx`
- Create: `src/components/contact-participants.ts`
- Modify: `tests/components/ContactAddressAction.test.tsx`
- Modify: `tests/components/MessageDetail.selection.test.tsx`
- Modify: `tests/components/ThreadMessageBubble.test.tsx`
- Create: `tests/components/contact-participants.test.ts`

**Steps:**
1. Add failing tests showing two identical actions issue one lookup and duplicate From/To/Cc addresses collapse case-insensitively.
2. Add a normalized-address React Query key/hook backed by the exact IPC command.
3. Replace local effect state in `ContactAddressAction`, update cache after save, and share a participant-deduplication helper between both message views.
4. Run the affected frontend tests.

### Task 6: Virtualize ContactsView and complete localization/styles

**Files:**
- Modify: `src/features/contacts/ContactsView.tsx`
- Modify: `src/styles/index.css`
- Modify: `tests/features/contacts/ContactsView.test.tsx`
- Create: `tests/features/contacts/ContactListItem.test.tsx`

**Steps:**
1. Add failing tests that a large contact collection does not mount every row, the count label uses translation, import error text renders, and ContactListItem covers fallback/favorite/selection behavior.
2. Add `useVirtualizer` with a stable scroll container, estimated row size, overscan, and semantic list/listitem wrappers.
3. Use `t("contacts.count", { count })`, consolidate danger selectors, and replace hardcoded red values with `var(--color-danger)`.
4. Run contact-view tests.

### Task 7: Complete editor-dialog accessibility and validation coverage

**Files:**
- Modify: `src/features/contacts/ContactEditorDialog.tsx`
- Modify: `src/locales/en.json`
- Modify: `src/locales/zh.json`
- Modify: `tests/features/contacts/ContactEditorDialog.test.tsx`

**Steps:**
1. Add failing tests for focus wrap/restore, duplicate email, zero/multiple primaries, name/notes limits, add/remove email, favorite toggle, and field-specific ARIA associations.
2. Add dialog focus capture/trap/restore and saving-aware Escape handling.
3. Return structured validation errors, set `aria-invalid`/`aria-describedby`, and align name/notes max lengths with Rust.
4. Run editor and locale parity tests.

### Task 8: Preserve and document intended autocomplete/import behavior

**Files:**
- Modify: `src/components/ContactAutocomplete.tsx`
- Modify: `tests/components/ContactAutocomplete.test.tsx`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Steps:**
1. Strengthen the Tab regression test to assert the event remains uncancelled and document why focus proceeds to the recent-suggestion removal action.
2. Add a concise code comment without changing the default Tab behavior.
3. Document that vCard re-import adds new addresses but preserves non-empty local fields and favorite state.
4. Run the autocomplete tests.

### Task 9: Full verification, review, and integration

**Files:**
- Verify all modified files.

**Steps:**
1. Run `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `pnpm test -- --reporter=dot`, `pnpm build:frontend`, `cargo test --workspace --exclude pebble-oauth`, and `git diff --check`.
2. Inspect the final diff and confirm the PR worktree contains no unrelated changes.
3. Commit with `QingJ01 <qingj1314@163.com>`, push `codex/issue-81-contacts`, and wait for PR checks.
4. Merge PR #89 into `master`, verify the PR reports merged, and report the resulting commit.
