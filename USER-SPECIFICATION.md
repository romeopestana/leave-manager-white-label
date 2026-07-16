# Leave Manager - User Specification (White-label)

## 1) Purpose

Leave Manager is a local web application used to manage employee leave balances and leave transactions across five leave types:

- Annual
- Sick
- Family
- Study
- Religious

This white-label edition is designed to be rebranded and customized for each client deployment.

## 2) Intended Users

- HR administrators
- Office managers
- Team admins responsible for leave records

## 3) Branding Requirements

- Product name, company name, logo, website, and accent colors are configured in `config/brand.json`.
- No hard-coded client branding should be present in the base white-label build.
- Each client deployment customizes brand config (and optional logo assets) without changing core leave logic.

## 4) Functional Specification

### Employee Management

- Create, update, and delete employees.
- Required fields: name, start date (`MM/YY`), leave start balances, annual accrual/month.
- Numeric leave values must be zero or positive.

### Leave Transactions

- Apply leave by employee, type, days, and date.
- Prevent overdrawing available balances.

### Balance Rules

- Annual: start + monthly accrual - annual taken.
- Sick/Family/Study/Religious: current-year transactions only; month-to-month carry within the year; effective reset on 1 January.

### Reporting / Backup

- Generate leave reports by employee and date range.
- Export/import JSON backups.
- Append audit actions to CSV log.

## 5) Persistence

- Preferred: Postgres via `DATABASE_URL`.
- Fallback: browser `localStorage`.
- Files: `leave-manager-log.csv`, `leave-manager-backup-YYYY-MM-DD.json`.

## 6) Acceptance Criteria

- Unbranded by default.
- Client branding applied via config only.
- Leave rules behave as specified.
- Axon production repository remains unaffected.
