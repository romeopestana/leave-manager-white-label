# Auth & Email Setup (Phase 1 → Google)

Phase 1 is live with **local email/password** login and a local email outbox.
Use this guide when you are ready for Google Workspace OAuth + SMTP.

## Current Phase 1 behaviour

- Login: `/login.html` with company email + temporary password
- Roles: `admin`, `employee`, `exco`
- Leave requests require Exco approval (including Admin submissions)
- Notifications are written to `data/email-outbox.jsonl` (not emailed yet)
- Allowed email domains: `config/brand.json` → `companyDomains`

### First admin

On first server start, a seed admin is created (see console):

- Default email: `admin@yourcompany.com`
- Default password: `ChangeMe123!`
- Override with `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`

## 1) Google Cloud OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select a project
3. Enable **Google Identity / OAuth consent screen**
4. App type: Internal (Workspace) if only company users
5. Create OAuth client ID:
   - Application type: Web application
   - Authorized redirect URI: `http://localhost:3001/api/auth/google/callback`
6. Copy Client ID and Client Secret into `.env`

## 2) Google Workspace SMTP

1. In Google Admin, ensure SMTP is allowed for the sending account
2. Prefer an App Password (or Workspace SMTP relay)
3. Put values in `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=leave@yourcompany.com
SMTP_PASS=your-app-password
SMTP_FROM=Leave Manager <leave@yourcompany.com>
```

## 3) Environment variables

Copy `.env.example` to `.env` and fill in values:

```env
SESSION_SECRET=replace-with-long-random-string
SEED_ADMIN_EMAIL=admin@yourcompany.com
SEED_ADMIN_PASSWORD=ChangeMe123!
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3001/api/auth/google/callback
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

## 4) Brand config

```json
{
  "companyDomains": ["yourcompany.com"],
  "auth": {
    "allowLocalLogin": true,
    "googleOAuthEnabled": false
  }
}
```

Set `googleOAuthEnabled` to `true` after OAuth credentials are configured (Phase 2 wiring).
