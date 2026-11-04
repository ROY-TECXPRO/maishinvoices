# Maish Invoice & Quotation Manager

Maish Mattress Center and Textile Industry, Narok. React + strict TypeScript + Vite + Tailwind.

## Run

```bash
npm install          # install dependencies
npm run dev          # http://localhost:5173
npm test             # 94 tests
npm run typecheck    # TypeScript strict check
npm run build        # production build to dist/
npm run preview      # local preview of production build
```

## Configuration

Copy `.env.example` to `.env.local` and fill in the values:

```
VITE_SUPABASE_URL=https://bixuqaihfofrniuvwpfn.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key from Supabase Project Settings > API>
```

### Data mode selection (explicit, never silent)

| `VITE_DATA_MODE` | Result |
|---|---|
| unset + Supabase configured | **Supabase repository** (production path) |
| `mock` + dev/test build | Mock repository (localStorage, browser only) |
| unset + no Supabase config | App refuses to start ("Configuration needed" screen) |

The application **never silently falls back to mock storage**. Without Supabase configuration and without `VITE_DATA_MODE=mock`, the app shows a configuration screen. Never put service-role/secret keys in `.env.local` or any frontend file.

## Supabase database

Project: `bixuqaihfofrniuvwpfn` (`https://bixuqaihfofrniuvwpfn.supabase.co`)

Version-controlled migrations live in `supabase/migrations/`:

1. `20261019000001_schema.sql` — profiles, customers, documents, document_items, document_number_sequences, document_number_allocations, document_versions, audit_entries, company_settings, triggers
2. `20261019000002_rls.sql` — Row Level Security policies, privilege grants, Realtime publication
3. `20261019000003_functions.sql` — atomic server-side functions (`save_document`, `duplicate_document`, `convert_to_invoice`, `set_document_status`, `restore_document_version`, `purge_document`, `save_customer`, `get_company_settings`, `save_company_settings`, `admin_set_profile`, `update_my_profile`, `next_document_number`)

4. `20261019000004_auth_confirmation_token.sql` — keeps `auth.users.confirmation_token` non-null via a `BEFORE INSERT OR UPDATE` trigger (`handle_auth_user_confirmation_token`), so admin-created accounts without email confirmation can still sign in
5. `20261019000005_harden_auth_confirmation_token_permissions.sql` — revokes `EXECUTE` on the confirmation-token trigger function and column-level `SELECT` on `auth.users.confirmation_token` from `public`, `anon`, `authenticated`, and `service_role`
6. `20261019151435_promote-first-admin-roysanga127.sql` — one-off bootstrap that promotes the first administrator; a safe no-op when no matching account exists or an administrator already exists
7. `20261020000006_harden_auth_token_columns.sql` — widens the token guard to every `auth.users` token column (`confirmation_token`, `email_change`, `email_change_token_current`, `email_change_token_new`, `phone_change`, `phone_change_token`, `reauthentication_token`, `recovery_token`), because a NULL in **any** of them breaks sign-in the same way

8. `20261028000007_customer_trash_passcode_orderno.sql` — customer trash (`deleted_at`, `delete_customer`, `restore_customer`), the server-side dashboard passcode (`verify_figures_passcode`, `set_figures_passcode`; stored salted and hashed, never readable by any API role, 5 wrong tries per 10 minutes then locked), and order number = document number on duplicate and convert

9. `20261031000008_payments.sql` — fixes validation errors that crashed with "malformed array literal" inside `save_document`, adds the `payments` table (RLS, read-only for clients), `document_total_cents` (same rounding as the app), `record_payment` (invoices only, never above the balance) and `delete_payment`

10. `20261031000009_history_trash.sql` — "Delete all history" moves audit entries and version snapshots to the Trash (`clear_history`, `list_trashed_history`, `restore_history`; trashed rows are hidden from every client query by RLS), administrator-only permanent deletion (`purge_history`, `purge_customer`)

The migration versions in `supabase_migrations.schema_migrations` match these filenames exactly, so `supabase migration list` reports no drift and no migration is re-applied.

### Why the auth token columns are guarded

GoTrue scans the token columns of `auth.users` into non-nullable Go strings, so a single `NULL` makes the sign-in query fail with `Database error querying schema` (HTTP 500) and locks the account out. Accounts created without an email confirmation (admin `createUser`, or signup with email confirmation disabled) are the ones that end up with NULL tokens.

The `BEFORE INSERT OR UPDATE` trigger on `auth.users` normalizes all eight token columns to `''`, and the migration backfills the existing rows.

The trigger function is `SECURITY DEFINER` and mutates `auth.users`, so it must never be reachable through the PostgREST API. Trigger functions are invoked by the trigger rather than by the caller, so revoking `EXECUTE` does not stop the trigger from firing — it is checked when the trigger is created, not on each invocation. The confirmation token is a credential, so no API role may read it.

Apply migrations through the Supabase Dashboard (SQL Editor) or the Supabase CLI. Do not apply destructive migrations; all DDL uses `IF NOT EXISTS` / `CREATE OR REPLACE` where practical.

### Row Level Security

Every exposed table has RLS enabled. The rule is simple:

- **Authenticated + ACTIVE employee** = read/write access to all company documents, customers, versions, audit history.
- **Inactive or unsigned account** = no access to any business data (RLS denies everything).
- **Anon role** = no privileges at all.

Clients never write `documents`, `document_items`, `document_versions`, `audit_entries`, or numbering tables directly. All document writes go through the security-definer `save_document()` PostgreSQL function, which enforces validation, optimistic locking, numbering reservation, version snapshots, and audit entries in a single transaction.

## Authentication & employee access

Supabase Auth provides individual employee accounts. Each new account creates a `profiles` row (via the `handle_new_user` trigger) starting **inactive**. An administrator must activate the account before it can access business data.

### First administrator (bootstrap)

There is no public sign-up. To create the first administrator:

1. Set the `ADMIN_BOOTSTRAP_SECRET` environment variable in your Supabase Edge Function settings (server-side only, never in frontend code).
2. Call the `admin-users` Edge Function with `operation: "bootstrap_admin"`, providing `email`, `password`, `full_name`, and `bootstrap_secret`.
3. The created profile is active with role `admin`. Subsequent employees are created the same way (inactive), then activated via the Users screen or the Edge Function.

### Adding employees

Administrators open **Users → Add user**, enter name, email, password (min. 8 characters) and role. The account is created **active** by the `admin-users` Edge Function; the person signs in straight away and has the whole software. Removing a user (bin icon) deletes the login; documents they created stay. Deploy once: `supabase functions deploy admin-users`.

### Protected figures

Money and counts are hidden behind one passcode on the **Dashboard, Documents, Trash, Reports, Outstanding** pages and in the **AI assistant** (the assistant's server re-checks the passcode before it mentions any amount). Use the eye button; the passcode is checked **on the server** and is not in the app code. Figures hide again after 2 minutes, when the tab is hidden, or on sign-out. Administrators change the passcode under Settings. The invoice editor itself always shows its own amounts (it is the working surface), and an employee with technical skill can still read data the database lets every active employee read: this lock protects against casual viewing, not against a determined insider.

### Trash

Everything deleted lands in the Trash, labelled by kind: **Documents**, **Customers** and **History** (cleared audit and version history). Every row has a **Restore** button. **Delete permanently** appears for administrators only and asks for confirmation. History is cleared with Administrator → History → Delete all history; it is restorable from the Trash.

### WhatsApp

The WhatsApp button (saved documents) shares the PDF. On a phone the share sheet attaches the PDF and you pick who receives it. On a computer the PDF downloads and WhatsApp opens to the customer's chat, or to the business number in Settings (default 0799921036) when the customer has no phone saved; press the paperclip and send. WhatsApp does not allow any website to send a file by itself.

### Payments and money owed

Open a saved invoice to record payments (cash, M-Pesa, bank, cheque). Status is Unpaid, Part paid or Paid, shown on the Documents list. **Outstanding** lists every unpaid or part-paid invoice, oldest first, with days outstanding, overdue flags (default 30 days, change in Settings) and a WhatsApp reminder button. The Dashboard shows money still owed and the overdue count.

### Other conveniences

WhatsApp share of the PDF from the editor (phones attach it directly; computers download it and open the chat), recent items with their last price while typing a line, customer name autofill, company logo upload (Settings; used on every PDF and in the menu), dark mode, and shortcuts: Alt+Q new quotation, Alt+I new invoice, Alt+D dashboard, Alt+L documents, Ctrl+S save.

### Role rules (enforced server-side)

- A normal employee cannot change their own role, activate their own account, or promote another user to administrator.
- Only administrators can manage users and company settings.
- The `protect_last_admin` trigger guarantees at least one active administrator always remains.


## Features

- **Dashboard**: monthly/year-to-date invoicing summaries, quotation counts, recent documents, activity by day. Invoiced totals are issued invoices — not payments received.
- **Documents**: search, type/date/customer filters, duplicate, quotation-to-invoice conversion, trash/restore.
- **Customers**: shared directory with search and editing.
- **History**: per-document version history with restore, plus company-wide audit log.
- **Trash**: recoverable soft-delete; permanent purge is administrator-only and audited.
- **Settings**: company identity, bank details, default terms/notes. Administrator-only.
- **Users**: employee accounts, roles, activation. Administrator-only.
- **Reports**: daily, monthly, annual, custom range, per-customer, and searchable invoice/quotation registers. PDF and CSV exports.
- **AI assistant**: a Claude-powered assistant at `/assistant` that carries out commands (see below). Requires the `AI_API_KEY` secret in the Edge Function settings.

## AI assistant (Claude)

The assistant runs on the **Claude API** (Anthropic) inside the Supabase Edge Function `supabase/functions/ai-assistant`. It uses Claude's tool calling: Claude chooses an allowlisted tool, the server validates the arguments (`supabase/functions/_shared/validate.ts`), runs the action **as the signed-in employee** (anon key + that person's JWT, so row level security always applies), and gives Claude the result. One command can chain several steps (for example find an invoice, then record a payment).

What it can do: search, show, create, edit, convert, duplicate, trash and restore quotations and invoices; create, edit, find, trash and restore customers; record payments; list money still owed; run reports; explain how the app works. It cannot touch users, settings, passcodes or permanent deletion.

Safety rules enforced on the server: moving a document or customer to the Trash always asks the user to press **Confirm** in the app (re-validated server-side); amounts are only returned when the server accepts the dashboard passcode sent with the request (otherwise they appear as `••••`).

The API key lives **only** as an Edge Function secret. It is never in the website, the browser, the repository or this zip. Set it with:

```bash
supabase secrets set AI_API_KEY=<your Claude API key> AI_MODEL=claude-sonnet-5-5
supabase functions deploy ai-assistant
```

`AI_MODEL` is optional (default `claude-sonnet-5-5`). Administrators see a **Test AI connection** button on the assistant page: it shows the model, whether the key is set, and Claude's real error message (key removed) if something is wrong. A pasted key should be revoked and replaced in the Anthropic console if it was ever shared in chat or email.

## Document rules (preserved)

- Quotations: `QT-YYYY-NNNN`, start at `QT-2026-3999`, never show a grand total.
- Invoices: `INV-YYYY-NNNN`, start at `INV-2026-3999`, show line amounts and grand total.
- Number sequences are independent, continue across years, follow the issue year, never repeat and are never released.
- Money: integer cents internally. Quantities up to 3 decimals.
- Discounts/taxes: invoices only, explicit and optional.
- PDF preserves the Maish layout from `src/config/company.ts` with multi-page rendering, repeated headers and KSh/cents alignment.

## Backups & recovery

An administrator can download a full JSON backup from the Settings screen (`exportBundle`): customers, documents, line items, version snapshots and audit entries.

This is a **manual export**. Automated point-in-time backups depend on your Supabase plan — verify what your plan includes under Project Settings → Database before relying on it. Restoration: apply the migration SQL to a new project, then re-import the JSON backup through a custom restore script or manual entry. Test recovery before depending on the application.

## PWA & Netlify

- PWA shell: `public/manifest.json`, `public/sw.js` (static asset cache only — authenticated responses are never cached).
- Netlify: `netlify.toml` with SPA redirects, build command `npm run build`, publish directory `dist`. Environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) must be set in Netlify site settings.

## Tests

- 94 tests covering money, calculation, numbering, print model, document editor, reports, AI action validation, and mock repository operations.
- Run with `npm test`.

## Acceptance checklist

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Editor and PDF/print | IMPLEMENTED | `src/components/DocumentEditor.tsx`, `src/pdf/*`, 47 original tests pass |
| 2 | Supabase connection & migrations | IMPLEMENTED | `supabase/migrations/0001-0003`, `src/data/supabase/client.ts`, `src/data/supabaseRepository.ts` |
| 3 | Login/logout/protected routes | IMPLEMENTED | `src/auth/AuthContext.tsx`, `src/auth/LoginPage.tsx`, `src/App.tsx` |
| 4 | Shared multi-user + RLS | IMPLEMENTED | `supabase/migrations/0002_rls.sql`, active-only policies on all tables |
| 5 | Numbering, atomic saves, versions, audit | IMPLEMENTED | `save_document()` transaction in `0003_functions.sql`, versions + audit on every save |
| 6 | Customers + document management | IMPLEMENTED | `CustomersPage`, `TrashPage`, `HistoryPage`, duplicate/convert/trash/restore |
| 7 | Dashboard & reports | IMPLEMENTED | `DashboardPage`, `ReportsPage`, `src/domain/reports.ts` |
| 8 | AI assistant | IMPLEMENTED (needs secrets + deploy) | `supabase/functions/ai-assistant`, `src/pages/AiAssistantPage.tsx`; verified with a mocked end-to-end run, not against a live provider |
| 9 | Exports/backups/recovery | PARTIALLY IMPLEMENTED | JSON backup export (Settings); automated backups depend on Supabase plan |
| 10 | PWA & Netlify | IMPLEMENTED | `public/manifest.json`, `public/sw.js`, `netlify.toml` |
| 11 | Tests & build | IMPLEMENTED | 94 tests pass, `npm run build` succeeds |

Items marked PARTIALLY IMPLEMENTED require external configuration (AI provider key, Supabase plan for automated backups) before they are fully operational.

## License

Proprietary — Maish Mattress Center and Textile Industry, Narok.

