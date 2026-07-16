# Leave Manager (White-label)

A white-label leave management web app that can be customized per client without changing the Axon production codebase.

This project was branched from the Axon Leave Manager production baseline and intentionally has no client branding hard-coded.

## Isolation from Axon production

- Axon production remains in `romeopestana/axon-leave` on the `production` tag.
- This repository is independent and safe for multi-client customization and upgrades.

## Brand customization

Edit `config/brand.json`:

```json
{
  "productName": "Leave Manager",
  "companyName": "Your Company",
  "pageTitle": "Leave Manager",
  "logoPath": "",
  "websiteUrl": "",
  "accentColor": "#0066b3",
  "accentHover": "#004d8c"
}
```

- Leave `logoPath` empty to show the product name as text.
- Put logos under `assets/` and set `logoPath` to e.g. `assets/logo.png`.

## Current Status

- Browser thick client (`leave.html` + `leave.js`) calculates balances.
- Node/Express server (`server.js`) serves UI, logs, backups, and optional Postgres persistence.
- Falls back to browser `localStorage` when Postgres is unavailable.

## Leave Rules

- Leave types: `annual`, `sick`, `family`, `study`, `religious`.
- Baseline year: `2026`.
- Annual leave:
  - Accrues on the **last day of each month**.
  - Unused annual leave carries into the next year up to each employee’s **max carry-over** days; excess is forfeited on 1 January.
- Sick/Family/Study/Religious:
  - Reset on **1 January** every year (only current-year usage is deducted).
  - Carry month-to-month within the same year.

## Run Locally

1. `npm install`
2. Optional: set `DATABASE_URL`
3. `node server.js`
4. Open `http://localhost:3001`

## Auth (Phase 1)

- Login page: `/login.html`
- Roles: Admin, Employee, Exco
- Temporary local password login (Google Workspace OAuth next)
- Leave requests require Exco approval (Admin requests included)
- Notifications currently queued to `data/email-outbox.jsonl`
- Setup guide: `docs/AUTH-SETUP.md`
