# PR #89 Review Fixes Design

## Scope and decisions

This change set resolves every actionable finding from the second review of PR #89 without changing behavior that was incorrectly reported as broken. The recipient autocomplete keeps the browser's default Tab behavior when a recent-suggestion removal action is present; a regression test will make the non-cancelled event explicit. vCard re-import continues to preserve non-empty local names, notes, and favorite state while adding new addresses, because overwriting local edits is a more destructive default. That policy will be documented in both READMEs.

The implementation takes a targeted-refactor approach. A minimal patch would leave repeated IPC lookups, weak transaction preconditions, and parser duplication in place. A broader redesign with a new recent-recipient materialized table and infinite contact pagination would add a migration and significantly expand PR scope. The selected middle approach fixes current correctness, accessibility, and 10,000-contact scaling risks using existing SQLite, React Query, and `@tanstack/react-virtual` infrastructure.

## Backend architecture

All Tauri contact commands will use one generic `spawn_blocking` adapter around the shared `Arc<Store>`. This follows the pattern already used by message, thread, search, and folder commands and prevents synchronous SQLite, vCard parsing, and serialization from occupying Tokio worker threads. A new exact normalized-email lookup will replace substring `list_contacts` calls made by every message participant.

Contact-email insert errors will classify only SQLite UNIQUE/PRIMARY KEY conflicts as validation failures. Other SQLite failures, including trigger, I/O, full-disk, busy, and corruption errors, will propagate as storage failures so vCard import aborts and rolls back. Backup replacement will prevalidate all IDs, names, notes, email structure, and cross-contact uniqueness before deletion, and its API will require `&Transaction` to encode the caller-managed transaction precondition.

Backup contact pagination will run inside one read transaction. The regular contact-list query will gain a connection-level helper so both normal queries and backup snapshots share the same SQL. Recent suggestion history will add SQL-side query predicates before JSON parsing, while the legacy known-contact query will include To, Cc, and Bcc consistently.

## vCard behavior

The parser will require `VERSION:3.0`, enforce a 512-character display-name cap, and locate property delimiters outside quoted parameter values. Header parameters will be split on unquoted semicolons and assignment delimiters, preserving custom values such as `X-FOO="a:b=c;d"`.

Nested cards will be treated as one malformed outer structure. A depth-aware state keeps the outer parse state until its matching `END:VCARD`, records one clean error, and does not import the nested fragment as a separate valid contact. Operational save failures remain fatal to the whole transaction; only malformed individual cards and genuine validation conflicts remain partial import failures.

## Frontend data flow and accessibility

`ContactAddressAction` will use a React Query hook keyed by normalized email. Identical participants therefore share one exact lookup and one cache entry, and contact mutations invalidate the same `contacts` root. From/To/Cc participants will be normalized and deduplicated before rendering in both message views.

The Contacts view will keep its existing data query but virtualize list rows with the list pane as the scroll element, so at most the visible window plus overscan is mounted. The translated `contacts.count` key will supply the count label.

The editor dialog will reuse the focus-management pattern from `ConfirmDialog`: capture and restore previous focus, trap forward and reverse Tab, keep Escape disabled while saving, and associate validation errors with the failing name, email group, or notes field. Name and notes DOM limits will match backend validation. Danger styles will use theme variables and remove conflicting declarations.

## Verification

Every behavior change starts with a failing unit or component test. Rust coverage will include storage-error classification, pre-delete validation, exact email lookup, strict/nested/quoted vCards, name limits, snapshot page loading, and Cc/Bcc legacy search. Frontend coverage will include cached participant lookup, participant deduplication, virtualization, dialog focus/error behavior, all editor validation paths, localized count rendering, ContactListItem behavior, and import error details. Final verification will run formatting, frontend tests/build, Rust tests/clippy excluding only the disclosed pre-existing OAuth failure where necessary, and `git diff --check` before commit, push, and merge.
