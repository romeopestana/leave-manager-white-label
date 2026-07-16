const { OAuth2Client } = require("google-auth-library");

function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function callbackUrl() {
  return (
    process.env.GOOGLE_CALLBACK_URL ||
    `http://localhost:${process.env.PORT || 3001}/api/auth/google/callback`
  );
}

function createOAuthClient() {
  if (!googleConfigured()) {
    throw new Error("Google OAuth is not configured (missing GOOGLE_CLIENT_ID/SECRET).");
  }
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl(),
  );
}

function getAuthorizeUrl(companyDomains = []) {
  const client = createOAuthClient();
  const primaryDomain =
    Array.isArray(companyDomains) && companyDomains.length
      ? String(companyDomains[0]).trim().toLowerCase()
      : "";

  const opts = {
    access_type: "online",
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
    include_granted_scopes: true,
  };
  // Hint Google to prefer Workspace accounts for this domain.
  if (primaryDomain) opts.hd = primaryDomain;

  return client.generateAuthUrl(opts);
}

async function getGoogleProfileFromCode(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) {
    throw new Error("Google did not return an ID token.");
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload() || {};
  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) throw new Error("Google account has no email address.");
  if (payload.email_verified === false) {
    throw new Error("Google email address is not verified.");
  }

  return {
    email,
    name: payload.name || email,
    picture: payload.picture || null,
    hd: payload.hd || null,
  };
}

module.exports = {
  googleConfigured,
  callbackUrl,
  getAuthorizeUrl,
  getGoogleProfileFromCode,
};
