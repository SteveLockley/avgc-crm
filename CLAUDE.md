# Alnmouth Village Golf Club - Project Configuration

## Domains
- **Public Website**: https://www.alnmouthvillage.golf
- **Admin CRM**: https://crm.alnmouthvillage.golf (protected by Cloudflare Access)

## Cloudflare Configuration
- **Pages Project**: alnmouth-golf-crm
- **D1 Database Name**: alnmouth-golf-db
- **D1 Database ID**: 2dabf34e-2dc8-49ec-abb6-a6b1dfc78ac0

## Database Migrations
Run migrations with:
```bash
npx wrangler d1 execute alnmouth-golf-db --remote --file=migrations/XXX.sql
```

## Deployment
```bash
npm run build
npx wrangler pages deploy dist --project-name=alnmouth-golf-crm
```

## Site Structure
- `/` - Public homepage
- `/course`, `/visitors`, `/membership`, `/clubhouse`, `/contact`, `/faq`, `/news` - Public pages
- `/members/*` - Member portal (magic link auth)
- `/admin/*` - CRM admin (Cloudflare Access required)

## External Integrations
- **BRS Golf** (Visitor booking): https://www.brsgolf.com/alnmouthvillage/visitor_menu.php
- **BRS Golf** (Member booking): https://members.brsgolf.com/alnmouthvillage
- **Email**: Azure/Microsoft Graph API for sending emails
