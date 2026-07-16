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
- Annual leave accrues monthly.
- Sick/Family/Study/Religious deduct only current-year transactions and effectively reset on 1 January.

## Run Locally

1. `npm install`
2. Optional: set `DATABASE_URL`
3. `node server.js`
4. Open `http://localhost:3000`

## Branch

Primary development branch: `White-label`
