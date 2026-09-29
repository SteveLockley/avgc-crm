# Daily bar takings → Sage: reconciliation and go-live plan

*Prepared 29 September 2026 for the treasurer and the office. Covers the 2026 financial year to date (1 January – 28 September).*

## 1. What the two systems hold today

**Sage (manual system).** One "Other Receipt" per trading day into *Money In Till (1230)*, keyed by the bookkeeper from TouchOffice, with a VAT-coded line per budget head:

| Budget head | Nominal | VAT code | 2026 to date (gross) |
|---|---|---|---|
| Bar Sales | 4000 | Standard 20% | £145,947.56 |
| Food Sales | 4010 | Standard 20% | £155,245.02 |
| Coffee Machine Sales | 4020 | Standard 20% | £29,761.49 |
| Members Subscription | 4030 | Exempt | £33,524.00 |
| Visiting Green Fees | 4040 | Exempt | £45,081.10 |
| Buggies | 4050 | Standard 20% | £6,645.00 |
| Locker Sales | 4060 | Standard 20% | £390.00 |
| Merchandise sales | 4070 | Standard 20% | £13,971.94 |
| **Total** | | | **£430,566.11** (268 daily entries, 1 Jan – 25 Sep) |

The reference field is left blank, so Sage displays the date. Card settlements (Dojo) and cash banked at the post office are then transferred from 1230 to the current account, which is why the weekly receipts reports key off these date-named entries.

**TouchOffice (till).** Department sales per day. The CRM has been collecting the Monday–Sunday weekly totals since January (38 complete weeks, £432,554.32 across the nine departments below). The *drawer* total is higher than department sales by about £9,300 for the year because it includes customer account top-ups ("PAY ACCOUNT"), which are not revenue; the bookkeeper correctly posts department sales, not drawer totals.

## 2. Reconciliation result

Comparing TouchOffice weekly department totals with the Sage daily entries summed over the same Monday–Sunday weeks:

- **32 of 38 weeks agree to the penny on every budget head.**
- The six that differ:

| Week | Dates | Difference (TouchOffice − Sage) | Cause |
|---|---|---|---|
| 17 | 27 Apr – 3 May | −£40.00 Members Subscription | Keying difference on one day; needs the daily run to pinpoint |
| 18 | 4 – 10 May | −£5.00 Members Subscription | as above |
| 20 | 18 – 24 May | −£20.00 Members Subscription | as above |
| 24 | 15 – 21 Jun | −£0.01 Merchandise | A second, 1p receipt keyed on 21 June (duplicate) |
| 25 | 22 – 28 Jun | −£50.00 Coffee Machine | Keying difference on one day; needs the daily run to pinpoint |
| 38 | 21 – 27 Sep | +£4,964.13 | 26 and 27 September not yet keyed in Sage (entries lag 6–7 days on average, up to 4 weeks) |

The full week table is in `data/daily-takings/weekly-reconciliation-2026.csv`; every Sage line is in `data/daily-takings/sage-till-lines-2026.csv`.

**VAT coding errors inside otherwise-matching days** (gross agrees, VAT does not). These over-declare output VAT and should be corrected in Sage before the next VAT return:

| Date | Line | Keyed as | Should be | VAT over-declared |
|---|---|---|---|---|
| 9 Mar | Visiting Green Fees £10.00 | Standard | Exempt | £1.67 |
| 12 Mar | Members Subscription £18.50 | Standard | Exempt | £3.08 |
| 7 Apr | Members Subscription £204.50 | Standard | Exempt | £34.08 |
| 13 Apr | Members Subscription £70.00 | Standard | Exempt | £11.67 |
| 19 Jun | Visiting Green Fees £105.00 | Standard | Exempt | £17.50 |
| 3 Jul | Visiting Green Fees £170.00 and Members Subscription £228.00 | Standard | Exempt | £66.33 |
| 4 Jul | Visiting Green Fees £90.10 | Standard | Exempt | £15.02 |
| 7 Jul | Visiting Green Fees £507.50 | Standard | Exempt | £84.58 |
| 24 Jul | Visiting Green Fees £751.00 | Standard | Exempt | £125.17 |
| 18 Jun | Buggies £25.00, Coffee £105.60, Merchandise £41.95 | net £0, VAT = gross | net/VAT split | £150.68 |
| 26 Jun | Buggies £10.00 | net £0, VAT = gross | net/VAT split | £8.33 |
| **Total** | | | | **£518.11** |

Also: 6 January has no Sage entry (TouchOffice shows no sales that day, so nothing is missing), and 21 June has two entries (the real one plus a 1p duplicate to delete).

**Conclusion.** The bookkeeper's entries are sourced from the same department totals the CRM reads, so an automated post will produce the same figures. The differences found are all keying slips, which automation removes.

## 3. How the automated post works

Code: `src/lib/daily-takings.ts`, `src/pages/api/sage/daily-takings.ts`, admin page **Finance → Daily Takings → Sage** (`/admin/sage/daily-takings`), migration `069_daily_takings.sql`.

For each completed day:

1. Read the day's department totals from TouchOffice (the same homepage widget the weekly collection uses).
2. Map each department to a budget head and VAT rate (table `daily_takings_mapping`, editable on the page). Memberships and Social Memberships both go to 4030. A department with sales but no mapping blocks the day.
3. Build one Other Receipt into *Money In Till (1230)*: one line per budget head, VAT split as net = round(gross ÷ 1.2), VAT = gross − net. This matches 1,241 of the 1,245 standard-rated lines keyed this year; the other four are the 18 and 26 June errors above.
4. Read what Sage already holds for the day (till receipts only) and compare gross, net, VAT and VAT code per head. Store the result: *match*, *differs*, *not in Sage*, *no sales*, *unmapped*, *error*.
5. Post only when asked to, and only when Sage holds nothing for that day.

Safeguards:

- **Nothing is written by a dry run.** The check reads both systems and stores the comparison.
- **No duplicates.** A day that already has a till receipt in Sage is refused. Posting re-runs the check on fresh data first.
- **Go-live date.** Live posts are refused for any day before the date set on the page, so history stays with the manual entries.
- **Test business first.** Posts can go to a connected Sage trial business (role *test*) with identical code; Sage ids are resolved by nominal code, so the same mapping works in both.
- **Typed confirmation** ("POST TO LIVE") for any manual live post; **void** removes a receipt the CRM created (Sage refuses if it is reconciled or on a VAT return); every post, void and settings change is written to `audit_log`.
- Reference = the date, so the weekly receipts scripts and the Dojo/P.O. transfer workflow carry on unchanged. Line details read "TouchOffice: Bar Sales" so automated entries are recognisable.

The scheduled run (`cron/daily-takings`, a Cloudflare Worker firing at 05:30 UTC) calls the CRM once a day. What it does depends on the **mode** on the page:

| Mode | Each morning |
|---|---|
| Dry run | Checks yesterday (and retries any unresolved day in the last week) and records the comparison. This is the automated "tandem" period. |
| Test | As above, and also posts the day to the test business. |
| Live | As dry run, and posts yesterday to the club accounts when Sage has nothing for it and the day is on or after the go-live date. Days the bookkeeper has already keyed are never touched. |

## 4. Dummy runs on existing data

**Already done, from the Sage side (29 Sep).** Every one of the 267 days in Sage was fed back through the posting engine using its own gross figures per head. 255 days come out as *match*; the 12 flagged are exactly the VAT-error days and the duplicate in section 2, and nothing else. The receipt the engine would generate for each day (lines, net, VAT, and the Sage payload) is in `data/daily-takings/engine-dummy-run-2026.csv`.

**Still to run, against TouchOffice day by day.** Two ways, both read-only:

**On the page.** Choose a date range (up to a year) and *Run dry run*. Each day is fetched and compared; the table shows the result with a line-by-line breakdown under *Details*. Days with a manual entry should show *Matches Sage*; the keying errors above will show *Differs* with the reason.

**From a terminal**, without deploying anything:

```bash
node --import ./scripts/lib/register-ts.mjs scripts/daily-takings-check.mjs --from 2026-01-01 --to 2026-09-28
```

It uses the same library as the page, prints one line per day and writes `data/daily-takings-check-<from>_<to>.csv`. It needs `TOUCHOFFICE_USERNAME` and `TOUCHOFFICE_PASSWORD` in `.dev.vars`, or a fresh session: opening Food & Bar in the CRM signs in and stores one, and the script picks it up.

## 5. Go-live steps

1. **Apply the migration** (needs to be run by hand; it also drops the two empty tables from the old journal import):
   `npx wrangler d1 execute alnmouth-golf-db --remote --file=migrations/069_daily_takings.sql`
2. **Deploy** the `develop` branch, review, then merge to `main` and deploy production. The page is admin-only and reads Sage without writing until told otherwise.
3. **Dry run the whole year** from the page (or the script). Expect *Matches Sage* everywhere except the days listed in section 2 and 26–27 September (*Not in Sage*).
4. **Fix the Sage keying errors** in section 2 (re-code the exempt lines, correct the two net-zero days, delete the 1p duplicate). Re-check those days: they should now match.
5. **Connect a Sage trial business** (developer.sage.com → `/api/sage/authorize?role=test`), set mode to *Test*, and let the morning run post to it for a week. Compare a few days in the Sage web app against the manual entries.
6. **Set the secret for the scheduled run** and deploy the worker:
   ```bash
   printf '%s' THE_SECRET | npx wrangler pages secret put CRON_SECRET --project-name alnmouth-golf-crm
   cd cron/daily-takings && npx wrangler deploy && printf '%s' THE_SECRET | npx wrangler secret put CRON_SECRET
   ```
7. **Agree the cut-over date** with the bookkeeper (a Monday). They key the manual entry for the last time on the day before. Set the go-live date and mode *Live* on the page. From then on the morning run posts the previous day; the bookkeeper checks the page rather than keying.
8. Keep the P.O. cash and Dojo transfers exactly as now; they are unaffected.

## 6. Open points

- TouchOffice login for the local script (`.dev.vars`); the deployed CRM already has it.
- Sage trial business not yet created (also needed for the supplier change-set work).
- The Cloudflare Pages project has no cron of its own, hence the small worker. An external scheduler (e.g. cron-job.org) calling the same endpoint with the bearer would also do.
- Not built: an email digest when a morning run finds a mismatch or fails. Easy to add on top of the existing Graph email sender if wanted.
