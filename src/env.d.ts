/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type D1Database = import('@cloudflare/workers-types').D1Database;

interface Env {
  DB: D1Database;
  // Azure AD credentials for email sending via Microsoft Graph API
  AZURE_TENANT_ID?: string;
  AZURE_CLIENT_ID?: string;
  AZURE_CLIENT_SECRET?: string;
  // Service account credentials (for sending via shared mailbox)
  // The service account must have "Send As" permission on the shared mailbox
  AZURE_SERVICE_USER?: string;
  AZURE_SERVICE_PASSWORD?: string;
}

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    user?: {
      email: string;
      name: string;
      role: string;
    };
  }
}
