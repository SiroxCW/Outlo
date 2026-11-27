// The app registration of Outlo Mail at Microsoft. The ID is public: a desktop app has no secret.
export const CLIENT_ID = 'b12643c3-f2dc-4b91-8644-301ca7ec974e';
export const AUTHORITY = 'https://login.microsoftonline.com/common';

// What this version of the app uses. Later features ask for their permissions when they arrive.
export const SCOPES = ['User.Read', 'Mail.ReadWrite', 'MailboxSettings.Read', 'offline_access'];

// An administrator opens this address once to approve the app for the whole organization.
export const ADMIN_CONSENT_URL =
  'https://login.microsoftonline.com/organizations/v2.0/adminconsent?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    scope: 'https://graph.microsoft.com/.default',
    redirect_uri: 'http://localhost',
  }).toString();
