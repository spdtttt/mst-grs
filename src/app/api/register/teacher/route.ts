import { registerTeacherRequest } from "@/lib/teacher-registration-server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "คำขอไม่ถูกต้อง" }, { status: 403 });
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
