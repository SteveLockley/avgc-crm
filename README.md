# Alnmouth Village Golf Club CRM

A simple, free membership CRM built with Astro and Cloudflare Pages + D1.

## Features

- **Member Management**: View, add, edit, search members
- **Payment Tracking**: Record and manage payments
- **Reports**: Membership statistics, financial reports, export to CSV
- **Import/Export**: Import from your existing CSV, export for backups

## Tech Stack

- **Frontend**: [Astro](https://astro.build/) (server-side rendered)
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite at the edge)
- **Hosting**: [Cloudflare Pages](https://pages.cloudflare.com/) (free tier)
- **Authentication**: Simple session-based auth (consider Cloudflare Access for M365 SSO)

## Getting Started

### Prerequisites

- Node.js 18+ installed
- A Cloudflare account (free)
- Wrangler CLI

### Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Login to Cloudflare**
   ```bash
   npx wrangler login
   ```

3. **Create the D1 database**
   ```bash
   npm run db:create
   ```

   Copy the `database_id` from the output and update `wrangler.toml`:
   ```toml
   database_id = "your-database-id-here"
   ```

4. **Run database migrations**
   ```bash
   # For local development
   npm run db:migrate:local
   npm run db:seed:local

   # For production
   npm run db:migrate
   npm run db:seed
   ```

5. **Start local development**
   ```bash
   npm run dev
   ```

   Open http://localhost:4321

### Default Login

- **Email**: `admin@alnmouthvillage.golf`
- **Password**: `admin123`

⚠️ **Change this immediately in production!**

## Deployment

1. **Build and deploy**
   ```bash
   npm run deploy
   ```

2. **Connect your domain** (alnmouthvillage.golf)
   - Go to Cloudflare Pages dashboard
   - Select your project
   - Go to Custom Domains
   - Add `alnmouthvillage.golf`

## Importing Your Existing Members

1. Log in to the CRM
2. Go to Members → Import from CSV
3. Upload your `AVGC Members Export.csv` file
4. Select "Skip existing members" mode
5. Click Import

The import supports the same CSV format as your current export.

## Project Structure

```
avgc-crm/
├── src/
│   ├── pages/
│   │   ├── index.astro          # Dashboard
│   │   ├── login.astro          # Login page
│   │   ├── members/
│   │   │   ├── index.astro      # Member list
│   │   │   ├── [id].astro       # Member detail
│   │   │   ├── [id]/edit.astro  # Edit member
│   │   │   ├── new.astro        # Add member
│   │   │   ├── import.astro     # CSV import
│   │   │   └── export.astro     # CSV export
│   │   ├── payments/
│   │   │   ├── index.astro      # Payment list
│   │   │   ├── new.astro        # Record payment
│   │   │   └── [id]/edit.astro  # Edit payment
│   │   └── reports/
│   │       ├── index.astro      # Reports dashboard
│   │       ├── expiring.astro   # Expiring members export
│   │       └── renewals.astro   # Renewal reminders export
│   ├── layouts/
│   │   └── AdminLayout.astro    # Main admin layout
│   ├── lib/
│   │   ├── auth.ts              # Authentication utilities
│   │   └── db.ts                # Database types and helpers
│   └── middleware.ts            # Auth middleware
├── migrations/
│   ├── 001_initial.sql          # Database schema
│   └── 002_seed.sql             # Seed data
├── wrangler.toml                # Cloudflare config
├── astro.config.mjs             # Astro config
└── package.json
```

## Database Schema

The database matches your existing member export format:

- **members**: Full member data (50+ fields)
- **payments**: Payment records
- **subscription_history**: Subscription change tracking
- **admin_users**: CRM admin accounts
- **audit_log**: Change tracking

## Security Considerations

1. **Change the default password** immediately after deployment
2. **Consider Cloudflare Access** for M365 SSO integration
3. **Enable 2FA** on your Cloudflare account
4. **Review GDPR compliance** - the system tracks consent but ensure your processes are compliant

## Future Enhancements

- [ ] Cloudflare Access integration for M365 SSO
- [ ] Email notifications for renewals
- [ ] Tee time booking system
- [ ] Member self-service portal
- [ ] Direct debit integration with GoCardless

## Free Tier Limits

Cloudflare's free tier is generous for a golf club:

| Resource | Free Limit | Your Usage |
|----------|------------|------------|
| Requests | 100,000/day | ~500/day |
| D1 Reads | 5 million/day | ~2,000/day |
| D1 Writes | 100,000/day | ~100/day |
| D1 Storage | 5 GB | ~50 MB |

## Support

For issues or questions, contact your web administrator.
