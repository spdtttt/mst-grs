import { z } from "zod";
import { studentAdminContext } from "@/lib/student-admin";
import { sameOrigin } from "@/lib/student-import";

const command = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("start") }).strict(),
  z
    .object({ operation: z.enum(["cancel", "finish"]), importId: z.uuid() })
    .strict(),
]);

export async function POST(request: Request) {
  if (!sameOrigin(request.url, request.headers.get("origin")))
    return Response.json({ error: "ต้นทางคำขอไม่ถูกต้อง" }, { status: 403 });
  const context = await studentAdminContext();
  if ("error" in context)
    return Response.json({ error: context.error }, { status: context.status });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const parsed = command.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  const { data, error } = await context.db.rpc("student_import_control", {
    p_operation: parsed.data.operation,
    p_import_id: "importId" in parsed.data ? parsed.data.importId : null,
  });
  if (error)
    return Response.json(
      {
        error:
          "ควบคุมการนำเข้าไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อและ migration 028",
      },
      { status: 400 },
    );
  return Response.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
