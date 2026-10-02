import { notFound, redirect } from "next/navigation";
import AssignmentDetail from "@/components/assignment-detail";
import { configured, supabase } from "@/lib/supabase";
import type { AssignmentFile, GradeAssignment, GradeRecord, Profile } from "@/lib/domain";
import { isRole } from "@/lib/domain";
import { roleHomePath } from "@/lib/navigation";

export const dynamic = "force-dynamic";

export default async function AssignmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!configured()) redirect("/");
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    notFound();

  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    redirect(`/?next=${encodeURIComponent(`/dashboard/assignments/${id}`)}`);

  const { data: profile } = await db.from("profiles").select("id,role,full_name,student_code,classroom").eq("id", user.id).single();
  if (!isRole(profile?.role)) redirect("/");
  if (profile.role === "admin" || profile.role === "manager")
    redirect(roleHomePath(profile.role));
  const activeResult = await db.from("grade_records").select("*").eq("id", id).maybeSingle();
  if (activeResult.error)
    throw new Error("ไม่สามารถโหลดผลการเรียนได้");
  const historyResult = !activeResult.data
    ? await db.from("grade_record_history").select("*").eq("id", id).maybeSingle()
    : null;
  if (historyResult?.error) throw new Error("ไม่สามารถโหลดประวัติผลการเรียนได้");
  const record = activeResult.data ?? historyResult?.data;
  const archived = !!historyResult?.data;
  if (!profile || !record) notFound();

  const [filesResult, assignmentsResult] = await Promise.all([
    db.from("assignment_files").select("*").eq(archived ? "archived_record_id" : "record_id", id).order("created_at"),
    db.from("grade_assignments").select("*").eq(archived ? "archived_record_id" : "record_id", id).order("round_number"),
  ]);
  if (filesResult.error || assignmentsResult.error)
    throw new Error("ไม่สามารถโหลดภาระงานได้ กรุณาติดตั้ง migration ล่าสุด");

  const attachments = await Promise.all(
    (filesResult.data ?? []).map(async (file) => {
      const { data } = await db.storage
        .from("assignment-files")
        .createSignedUrl(file.storage_path, 600);
      return { ...file, signed_url: data?.signedUrl } as AssignmentFile;
    }),
  );

  return (
    <AssignmentDetail
      profile={profile as Profile}
      record={record as GradeRecord}
      attachments={attachments}
      assignments={(assignmentsResult.data ?? []) as GradeAssignment[]}
      backHref={archived ? "/dashboard?view=history" : "/dashboard"}
      archivedAt={archived ? record.archived_at : undefined}
    />
  );
}
