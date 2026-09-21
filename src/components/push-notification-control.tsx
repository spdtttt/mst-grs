"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, LoaderCircle } from "lucide-react";
import { removePushSubscription, savePushSubscription } from "@/app/actions";

type PushState = "loading" | "unsupported" | "blocked" | "off" | "on" | "error";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function supported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    !!publicKey
  );
}

async function registration() {
  return navigator.serviceWorker.register("/push-sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
}

export async function disablePushForCurrentDevice() {
  if (!supported()) return;
  const worker = await registration();
  const subscription = await worker.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await removePushSubscription(subscription.endpoint);
  } finally {
    await subscription.unsubscribe();
  }
}

export default function PushNotificationControl() {
  const [state, setState] = useState<PushState>("loading");
  const [message, setMessage] = useState("กำลังตรวจสอบการแจ้งเตือน");

  useEffect(() => {
    let active = true;
    async function check() {
      if (!supported()) {
        if (active) {
          setState("unsupported");
          setMessage("เบราว์เซอร์นี้ไม่รองรับ Web Push");
        }
        return;
      }
      if (Notification.permission === "denied") {
        if (active) {
          setState("blocked");
          setMessage("การแจ้งเตือนถูกปิดในการตั้งค่าเบราว์เซอร์");
        }
        return;
      }
      try {
        const worker = await registration();
        const subscription = await worker.pushManager.getSubscription();
        if (!active) return;
        if (!subscription) {
          setState("off");
          setMessage("เปิดรับแจ้งเตือนเมื่อมีคำร้องใหม่");
          return;
        }
        const result = await savePushSubscription(subscription.toJSON());
        if (!active) return;
        if (result.error) {
          setState("error");
          setMessage(result.error);
          return;
        }
        setState("on");
        setMessage("เมื่อมีนักเรียนยื่นคำร้อง จะแจ้งเตือนบนอุปกรณ์นี้");
      } catch {
        if (active) {
          setState("error");
          setMessage("ตรวจสอบการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่");
        }
      }
    }
    void check();
    return () => {
      active = false;
    };
  }, []);

  async function enable() {
    setState("loading");
    setMessage("กำลังเปิดการแจ้งเตือน");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        setMessage(
          permission === "denied"
            ? "การแจ้งเตือนถูกปิดในการตั้งค่าเบราว์เซอร์"
            : "ยังไม่ได้อนุญาตการแจ้งเตือน",
        );
        return;
      }
      const worker = await registration();
      const subscription = await worker.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      });
      const result = await savePushSubscription(subscription.toJSON());
      if (result.error) {
        await subscription.unsubscribe();
        setState("error");
        setMessage(result.error);
        return;
      }
      setState("on");
      setMessage("เมื่อมีนักเรียนยื่นคำร้อง จะแจ้งเตือนบนอุปกรณ์นี้");
    } catch {
      setState("error");
      setMessage("เปิดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่");
    }
  }

  async function disable() {
    setState("loading");
    setMessage("กำลังปิดการแจ้งเตือน");
    try {
      await disablePushForCurrentDevice();
      setState("off");
      setMessage("เปิดรับแจ้งเตือนเมื่อมีคำร้องใหม่");
    } catch {
      setState("error");
      setMessage("ปิดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่");
    }
  }

  const Icon =
    state === "on"
      ? BellRing
      : state === "blocked" || state === "unsupported"
        ? BellOff
        : state === "loading"
          ? LoaderCircle
          : Bell;
  const canToggle = !["unsupported", "blocked", "loading"].includes(state);

  return (
    <section className="mx-[7px] mb-4 rounded-xl border border-[#e6dcf1] bg-white px-4 py-4 text-xs text-[#6f607c] shadow-[0_8px_28px_#40206f0a]">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
          <Icon
            className={state === "loading" ? "animate-spin" : ""}
            size={19}
            aria-hidden="true"
          />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-[#5b476d]">แจ้งเตือนคำร้องใหม่</h2>
          <p className="mt-1 leading-5" aria-live="polite">
            {message}
          </p>
        </div>
      </div>
      {canToggle && (
        <button
          type="button"
          onClick={state === "on" ? disable : enable}
          className="mt-3 w-full cursor-pointer rounded-lg border border-[#d9c8eb] bg-[#faf7fd] px-3 py-2 font-medium text-brand transition-colors hover:bg-brand-soft focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-2"
        >
          {state === "on" ? "ปิดบนอุปกรณ์นี้" : "เปิดการแจ้งเตือน"}
        </button>
      )}
    </section>
  );
}
