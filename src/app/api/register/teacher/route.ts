import { registerTeacherRequest } from "@/lib/teacher-registration-server";

export const runtime = "nodejs";

// In-app browsers (e.g. LINE) may send an opaque or proxied Origin, so prefer
// Sec-Fetch-Site and compare against the Host the client actually used.
function sameSite(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    const { origin: expected } = new URL(request.url);
    return origin === expected || new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameSite(request)) {
    console.warn("[teacher-registration] origin rejected", {
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      host: request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
      userAgent: request.headers.get("user-agent")?.slice(0, 200),
    });
    return Response.json({ error: "คำขอไม่ถูกต้อง" }, { status: 403 });
  }
  let input: unknown;
  try {
    const body = await request.text();
    if (body.length > 4096)
      return Response.json({ error: "ข้อมูลยาวเกินกำหนด" }, { status: 400 });
    input = JSON.parse(body);
  } catch {
    return Response.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const source = process.env.VERCEL
    ? request.headers.get("x-vercel-forwarded-for") || "unknown"
    : "local";
  const result = await registerTeacherRequest(input, source);
  return Response.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
