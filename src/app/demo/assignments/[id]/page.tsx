import { notFound } from "next/navigation";
import AssignmentDetail from "@/components/assignment-detail";
import { demoProfiles, demoRecords } from "@/lib/demo";
import type { Role } from "@/lib/domain";

export default async function DemoAssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const { id } = await params;
  const { role: requestedRole } = await searchParams;
  const role: Role = requestedRole === "teacher" ? "teacher" : "student";
  const record = demoRecords.find((item) => item.id === id);
  if (!record) notFound();

  return (
    <AssignmentDetail
      profile={demoProfiles[role]}
      record={record}
      attachments={[]}
      backHref="/demo"
      demo
    />
  );
}
