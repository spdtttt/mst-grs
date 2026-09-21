import http from "k6/http";
import { check } from "k6";
import { Rate, Counter } from "k6/metrics";

// Intentionally localhost-only: no authenticated or database load is claimed.
const base = __ENV.BASE_URL || "http://127.0.0.1:3100";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) {
  throw new Error("This preliminary test only accepts a localhost URL");
}
const smoke = __ENV.PROFILE === "smoke";
const phases = smoke
  ? [{ name: "smoke", rate: 20, startTime: "0s", duration: "30s" }]
  : [
      { name: "baseline", rate: 100, startTime: "0s", duration: "1m" },
      { name: "target", rate: 700, startTime: "1m", duration: "2m" },
      { name: "spike", rate: 1400, startTime: "3m", duration: "1m" },
      { name: "recovery", rate: 700, startTime: "4m", duration: "1m" },
    ];
const pageFailed = new Rate("page_failed");
const pageAttempts = new Counter("page_attempts");
const thresholds = {
  http_req_failed: ["rate<0.01"],
  page_failed: ["rate<0.01"],
  dropped_iterations: ["count==0"],
};
for (const phase of phases) {
  thresholds[`http_req_duration{scenario:${phase.name}}`] = ["p(95)<3000"];
  thresholds[`page_failed{scenario:${phase.name}}`] = ["rate<0.01"];
  thresholds[`page_attempts{scenario:${phase.name}}`] = ["count>0"];
}
export const options = {
  scenarios: Object.fromEntries(
    phases.map((phase) => [
      phase.name,
      {
        executor: "constant-arrival-rate",
        rate: phase.rate,
        timeUnit: "1m",
        startTime: phase.startTime,
        duration: phase.duration,
        preAllocatedVUs: 30,
        maxVUs: 100,
        gracefulStop: "15s",
      },
    ]),
  ),
  thresholds,
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
};
function isLoginPage(response) {
  return (
    response.status === 200 &&
    response.body.includes("MST Grade Recovery System") &&
    response.body.includes('name="identifier"')
  );
}
export function setup() {
  if (!isLoginPage(http.get(`${base}/`, { redirects: 0, timeout: "10s" }))) {
    throw new Error("Preflight failed: expected the actual login HTML");
  }
}
export default function () {
  pageAttempts.add(1);
  const response = http.get(`${base}/`, {
    redirects: 0,
    timeout: "10s",
    tags: { name: "GET login HTML" },
  });
  const valid = check(response, { "200 and actual login form": isLoginPage });
  pageFailed.add(!valid);
}
export function handleSummary(data) {
  return {
    [__ENV.REPORT_PATH || "test-results/k6/summary.json"]: JSON.stringify(
      {
        scope:
          "Local production server; unauthenticated login HTML only; Supabase disabled; no browser assets or JavaScript execution",
        generatedAt: new Date().toISOString(),
        phases,
        ...data,
      },
      null,
      2,
    ),
    stdout: `\nSummary saved. Scope: public login HTML only.\n${JSON.stringify(data.metrics, null, 2)}\n`,
  };
}
