// Email sending via Microsoft 365 Graph API

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
  useServiceAccountMailbox?: boolean; // If true, send from service account's own mailbox (for testing)
}

interface GraphTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface SendEmailResult {
  success: boolean;
  error?: string;
}

// Cache for the access token
let tokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Get access token for Microsoft Graph API using client credentials flow
 */
async function getGraphAccessToken(env: {
  AZURE_TENANT_ID: string;
  AZURE_CLIENT_ID: string;
  AZURE_CLIENT_SECRET: string;
}): Promise<string> {
  // Check if we have a cached token that's still valid (with 5 min buffer)
  if (tokenCache && tokenCache.expiresAt > Date.now() + 300000) {
    return tokenCache.token;
  }

  const tokenUrl = `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: env.AZURE_CLIENT_ID,
    client_secret: env.AZURE_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get access token: ${response.status} ${errorText}`);
  }

  const data: GraphTokenResponse = await response.json();

  // Cache the token
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };

  return data.access_token;
}

/**
 * Get access token using Resource Owner Password Credentials (ROPC) flow
 * This allows the app to authenticate as a specific user (service account)
 */
async function getGraphAccessTokenROPC(env: {
  AZURE_TENANT_ID: string;
  AZURE_CLIENT_ID: string;
  AZURE_CLIENT_SECRET?: string;
  AZURE_SERVICE_USER: string;
  AZURE_SERVICE_PASSWORD: string;
}): Promise<string> {
  // Check if we have a cached token that's still valid (with 5 min buffer)
  if (tokenCache && tokenCache.expiresAt > Date.now() + 300000) {
    return tokenCache.token;
  }

  const tokenUrl = `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`;

  // Use .default scope which includes all consented permissions
  // This is more reliable than specifying individual scopes for ROPC
  const params = new URLSearchParams({
    client_id: env.AZURE_CLIENT_ID,
    scope: 'https://graph.microsoft.com/.default offline_access',
    username: env.AZURE_SERVICE_USER,
    password: env.AZURE_SERVICE_PASSWORD,
    grant_type: 'password',
  });

  // Add client secret if provided (for confidential clients)
  if (env.AZURE_CLIENT_SECRET) {
    params.append('client_secret', env.AZURE_CLIENT_SECRET);
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Parse error for more helpful message
    let errorDetail = errorText;
    try {
      const errorJson = JSON.parse(errorText);
      errorDetail = errorJson.error_description || errorJson.error || errorText;
    } catch {}
    throw new Error(`Token error (ROPC): ${errorDetail}`);
  }

  const data: GraphTokenResponse = await response.json();

  // Cache the token
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };

  return data.access_token;
}

/**
 * Send an email via Microsoft Graph API
 *
 * Supports two modes:
 * 1. Service Account (ROPC) - Uses a licensed user who has "Send As" permission on the shared mailbox
 *    Requires: AZURE_SERVICE_USER, AZURE_SERVICE_PASSWORD
 * 2. Application permissions - Requires Mail.Send application permission with admin consent
 *    Requires: AZURE_CLIENT_SECRET and app must have direct access to the mailbox
 */
export async function sendEmail(
  options: EmailOptions,
  env: {
    AZURE_TENANT_ID: string;
    AZURE_CLIENT_ID: string;
    AZURE_CLIENT_SECRET?: string;
    AZURE_SERVICE_USER?: string;
    AZURE_SERVICE_PASSWORD?: string;
  }
): Promise<SendEmailResult> {
  try {
    const sharedMailbox = options.from || 'subscriptions@AlnmouthVillage.Golf';

    // Determine which authentication method to use
    const useServiceAccount = env.AZURE_SERVICE_USER && env.AZURE_SERVICE_PASSWORD;

    let accessToken: string;
    let sendFromUser: string;

    if (useServiceAccount) {
      // ROPC flow: Authenticate as the service account user
      try {
        accessToken = await getGraphAccessTokenROPC(env as any);
      } catch (tokenError) {
        return {
          success: false,
          error: tokenError instanceof Error ? tokenError.message : 'Failed to get access token',
        };
      }
      sendFromUser = env.AZURE_SERVICE_USER!;
    } else if (env.AZURE_CLIENT_SECRET) {
      // Client credentials flow: App-only authentication
      try {
        accessToken = await getGraphAccessToken(env as any);
      } catch (tokenError) {
        return {
          success: false,
          error: tokenError instanceof Error ? tokenError.message : 'Failed to get access token',
        };
      }
      sendFromUser = sharedMailbox;
    } else {
      return {
        success: false,
        error: 'No valid authentication method configured. Set either AZURE_SERVICE_USER/PASSWORD or AZURE_CLIENT_SECRET.',
      };
    }

    // Build the message
    const message: any = {
      subject: options.subject,
      body: {
        contentType: 'HTML',
        content: options.html,
      },
      toRecipients: [
        {
          emailAddress: {
            address: options.to,
          },
        },
      ],
    };

    // Always set the from field with the club display name
    // When using service account and sending from a different address (shared mailbox),
    // or when using client credentials, ensure the sender shows as "Alnmouth Village Golf Club"
    if (!options.useServiceAccountMailbox) {
      message.from = {
        emailAddress: {
          name: 'Alnmouth Village Golf Club',
          address: sharedMailbox,
        },
      };
    }

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${sendFromUser}/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          saveToSentItems: true,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      // Parse the error for a more helpful message
      let errorDetail = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorDetail = errorJson.error?.message || errorJson.error?.code || errorText;
      } catch {}
      return {
        success: false,
        error: `SendMail failed (${response.status}): ${errorDetail}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error sending email',
    };
  }
}

/**
 * Send multiple emails with rate limiting
 */
export async function sendBulkEmails(
  emails: EmailOptions[],
  env: {
    AZURE_TENANT_ID: string;
    AZURE_CLIENT_ID: string;
    AZURE_CLIENT_SECRET: string;
  },
  onProgress?: (completed: number, total: number, current: EmailOptions, success: boolean, error?: string) => void
): Promise<{ sent: number; failed: number; errors: string[] }> {
  const results = { sent: 0, failed: 0, errors: [] as string[] };

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const result = await sendEmail(email, env);

    if (result.success) {
      results.sent++;
    } else {
      results.failed++;
      results.errors.push(`${email.to}: ${result.error}`);
    }

    if (onProgress) {
      onProgress(i + 1, emails.length, email, result.success, result.error);
    }

    // Rate limiting: wait 100ms between emails to avoid throttling
    if (i < emails.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

/**
 * Check if email configuration is available
 */
export function isEmailConfigured(env: {
  AZURE_TENANT_ID?: string;
  AZURE_CLIENT_ID?: string;
  AZURE_CLIENT_SECRET?: string;
  AZURE_SERVICE_USER?: string;
  AZURE_SERVICE_PASSWORD?: string;
}): boolean {
  // Need tenant and client ID always
  if (!env.AZURE_TENANT_ID || !env.AZURE_CLIENT_ID) {
    return false;
  }

  // Then need either service account credentials OR client secret
  const hasServiceAccount = !!(env.AZURE_SERVICE_USER && env.AZURE_SERVICE_PASSWORD);
  const hasClientSecret = !!env.AZURE_CLIENT_SECRET;

  return hasServiceAccount || hasClientSecret;
}

/**
 * Get a description of the current email configuration
 */
export function getEmailConfigStatus(env: {
  AZURE_TENANT_ID?: string;
  AZURE_CLIENT_ID?: string;
  AZURE_CLIENT_SECRET?: string;
  AZURE_SERVICE_USER?: string;
  AZURE_SERVICE_PASSWORD?: string;
}): { configured: boolean; method: string; details: string } {
  if (!env.AZURE_TENANT_ID || !env.AZURE_CLIENT_ID) {
    return {
      configured: false,
      method: 'none',
      details: 'Missing AZURE_TENANT_ID or AZURE_CLIENT_ID',
    };
  }

  if (env.AZURE_SERVICE_USER && env.AZURE_SERVICE_PASSWORD) {
    return {
      configured: true,
      method: 'service_account',
      details: `Using service account: ${env.AZURE_SERVICE_USER}`,
    };
  }

  if (env.AZURE_CLIENT_SECRET) {
    return {
      configured: true,
      method: 'app_only',
      details: 'Using application permissions (client credentials)',
    };
  }

  return {
    configured: false,
    method: 'none',
    details: 'Missing credentials. Set either AZURE_SERVICE_USER/PASSWORD or AZURE_CLIENT_SECRET.',
  };
}

/**
 * Validate an email address format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
