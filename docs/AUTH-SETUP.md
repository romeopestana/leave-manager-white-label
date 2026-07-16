# Auth & Email Setup (Google OAuth + SMTP)

Single-tenant setup: each company has its own deployment, `.env`, and `brand.json`.

## Sign-in modes

| Mode | When it appears |
|---|---|
| Company email + password | `auth.allowLocalLogin: true` (default) |
| Google Workspace | `auth.googleOAuthEnabled: true` **and** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` set |

Google sign-in only works for emails that already have a user profile created by Admin, and whose domain is in `companyDomains`.

## 1) Enable Google OAuth

1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select a project for this tenant
3. Configure OAuth consent screen (Internal for Workspace-only companies)
4. Create OAuth client ID → Web application
5. Authorized redirect URI:

```text
http://localhost:3001/api/auth/google/callback
```

For production, add your real HTTPS callback, e.g.:

```text
https://leave.client.com/api/auth/google/callback
```

6. Put values in `.env`:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:3001/api/auth/google/callback
```

7. In `config/brand.json`:

```json
"auth": {
  "allowLocalLogin": true,
  "googleOAuthEnabled": true
}
```

8. Restart the server. Login page shows **Sign in with Google**.

## 2) Enable Google Workspace SMTP

1. Use a Workspace mailbox (or SMTP relay) for this tenant
2. Create an App Password if required
3. Set `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=leave@yourcompany.com
SMTP_PASS=your-app-password
SMTP_FROM=Leave Manager <leave@yourcompany.com>
```

4. Restart the server. Notifications send over SMTP and are also logged to `data/email-outbox.jsonl`.

If SMTP is missing or fails, messages stay in the local outbox (`queued-local` / `smtp-failed-queued-local`).

## 3) Brand domains

```json
"companyDomains": ["yourcompany.com"]
```

Only these email domains can sign in (password or Google).

## 4) Test checklist

1. Admin creates user profile for `person@yourcompany.com`
2. Password login works (if local enabled)
3. Google login works for that same email (if Google enabled)
4. Leave request emails Exco (employee in CC) with login link
5. Exco profile updates email the employee (Exco in CC) with login link
6. Approve/reject emails the employee (Exco in CC)

## Security notes

- Never commit `.env`
- Use a unique `SESSION_SECRET` per tenant
- Keep each company on its own deployment (single-tenant)
