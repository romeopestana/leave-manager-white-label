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

- Admin: create/manage employees and user profiles, request leave, full admin tools
- Employee: log in, view own leave balances, request leave
- Exco: log in, view leave balances, run reports, approve/reject leave requests

## 3) Branding Requirements

- Product name, company name, logo, website, and accent colors are configured in `config/brand.json`.
- No hard-coded client branding should be present in the base white-label build.
- Each client deployment customizes brand config (and optional logo assets) without changing core leave logic.

## 4) Functional Specification

### Employee Management

- Create, update, and delete employees.
- Required fields: name, start date (`MM/YY`), leave start balances, annual accrual/month, annual max carry-over days.
- Numeric leave values must be zero or positive.

### Leave Transactions

- Admin and Employee submit leave requests (not applied immediately).
- Exco approves or rejects requests in the platform.
- Approved requests update balances; rejected requests do not.
- Prevent overdrawing available balances at request time.

### Balance Rules

- Annual:
  - Accrual is credited on the last day of each month.
  - Year-end unused annual carries over up to the employee’s configured max carry-over days.
  - Amounts above max carry-over are forfeited when the new year starts.
- Sick/Family/Study/Religious:
  - Reset on 1 January every year.
  - Only current-year transactions reduce the balance.

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
