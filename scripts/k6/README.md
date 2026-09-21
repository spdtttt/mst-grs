# Local k6 baseline

This measures **unauthenticated login HTML requests**, not logged-in users,
database throughput, browser rendering, or complete school workflows.
Supabase and Web Push are disabled in the build/server child process. The real
`.env` files are not modified. Do not use `/demo` to claim database capacity.

## Run on Windows (from the repository root)

Install k6 from the official Grafana distribution. For this run the verified
standalone binary is under `test-results/k6/bin/k6-v2.2.0-windows-amd64/k6.exe`.
That directory is ignored by Git.

```powershell
node scripts/k6/local-next.mjs build
node scripts/k6/local-next.mjs start
```

In a second terminal:

```powershell
$k6 = 'test-results/k6/bin/k6-v2.2.0-windows-amd64/k6.exe'
& $k6 run --quiet -e PROFILE=smoke -e REPORT_PATH=test-results/k6/smoke.json scripts/k6/public-page.js
& $k6 run --quiet -e REPORT_PATH=test-results/k6/local-load.json scripts/k6/public-page.js
node scripts/k6/report.mjs
```

Ensure `test-results/k6` exists when running on another machine. The test accepts
localhost URLs only. No credentials or accounts are needed. One iteration means
one `GET /`, with no cookies, static assets, JavaScript execution, or form POST.

The full local baseline is 100 requests/minute for one minute, 700/minute for
two minutes, 1,400/minute for one minute, then 700/minute for one minute.
Thresholds require p95 below 3 seconds per phase, fewer than 1% unexpected
HTTP/content failures, and zero dropped iterations. A nonzero exit code means
the test or a threshold failed. Inspect `page_attempts` for delivered load.

Stop the local server after testing. **Run `npm run build` again before normal
use or deployment:** the local test build uses empty public Supabase settings
and replaces `.next`. Never deploy this test build.

## What is still required for a production decision

- Provision a dedicated staging database and synthetic accounts/records.
- Test real login Server Actions, cookies, role-specific dashboards and writes.
- Separate 3,500 unique-user login arrivals from subsequent session activity;
  do not repeatedly log in a small account pool and mistake rate limits for
  database capacity.
- Allocate valid records per workflow; completed records cannot be repeatedly
  submitted or approved. Validate final states and audit logs.
- Run the representative authenticated mix for 30–60 minutes, including a
  spike and recovery, on production-equivalent infrastructure.
- Monitor database, hosting and load-generator resources and test browser
  behavior under load. The local generator shares a machine with the server.

References: https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/
and https://grafana.com/docs/k6/latest/using-k6/thresholds/
