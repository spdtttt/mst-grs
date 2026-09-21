import "server-only";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function pushConfigured() {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  );
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

function statusCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  )
    return error.statusCode;
  return null;
}

export async function notifyTeacherOfNewRequest(input: {
  recordId: string;
  teacherId: string;
}) {
  if (!pushConfigured()) return;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );

  const admin = adminClient();
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", input.teacherId);
  if (error) {
    console.error("Unable to load Web Push subscriptions:", error.code);
    return;
  }

  const payload = JSON.stringify({
    title: "MST GRS — มีคำร้องใหม่",
    body: "มีนักเรียนยื่นคำร้องขอแก้ไขผลการเรียนใหม่ กดเพื่อดู",
    icon: "/icon.png",
    badge: "/icon.png",
    tag: `grade-request-${input.recordId}`,
    url: `/dashboard/assignments/${input.recordId}`,
  });

  await Promise.all(
    ((data ?? []) as SubscriptionRow[]).map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
          { TTL: 60 * 60 * 24, urgency: "high" },
        );
      } catch (error) {
        const code = statusCode(error);
        if (code === 404 || code === 410) {
          await admin
            .from("push_subscriptions")
            .delete()
            .eq("id", subscription.id);
          return;
        }
        console.error(
          "Unable to send Web Push notification:",
          code ?? "unknown",
        );
      }
    }),
  );
}
