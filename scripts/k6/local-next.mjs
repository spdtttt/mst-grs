// Run a local production build/server without loading real Supabase credentials.
import { spawn } from "node:child_process";

const mode = process.argv[2];
if (!["build", "start"].includes(mode)) throw new Error("Use build or start");
const env = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
};
for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "LOGIN_HMAC_SECRET",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
])
  env[name] = "";
const args = ["node_modules/next/dist/bin/next", mode];
if (mode === "start") args.push("--hostname", "127.0.0.1", "--port", "3100");
const child = spawn(process.execPath, args, { env, stdio: "inherit" });
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
