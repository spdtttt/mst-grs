"use client";

import { useEffect, useState } from "react";
import { CircleCheck, Download, Share, Smartphone } from "lucide-react";

type InstallState = "loading" | "prompt" | "ios" | "manual" | "installed";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __mstInstallPrompt?: InstallPromptEvent | null;
  }
}

function standalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function iosSafari() {
  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export default function InstallAppControl() {
  const [state, setState] = useState<InstallState>("loading");
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (standalone()) {
      setState("installed");
      return;
    }
    const early = window.__mstInstallPrompt;
    if (early) {
      setPrompt(early);
      setState("prompt");
    } else {
      setState(iosSafari() ? "ios" : "manual");
    }

    function onPrompt(event: Event) {
      event.preventDefault();
      window.__mstInstallPrompt = event as InstallPromptEvent;
      setPrompt(event as InstallPromptEvent);
      setState("prompt");
    }
    function onInstalled() {
      window.__mstInstallPrompt = null;
      setPrompt(null);
      setState("installed");
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    // An install prompt can only be used once.
    window.__mstInstallPrompt = null;
    setPrompt(null);
    setState(outcome === "accepted" ? "installed" : "manual");
  }

  if (state === "loading") return null;

  const Icon =
    state === "installed" ? CircleCheck : state === "ios" ? Share : Smartphone;
  const message =
    state === "installed"
      ? "ติดตั้งแอปบนอุปกรณ์นี้แล้ว"
      : state === "prompt"
        ? "เพิ่ม MST GRS ไปยังหน้าจอโฮม เพื่อเปิดใช้งานได้รวดเร็วเหมือนแอป"
        : state === "ios"
          ? "แตะปุ่ม แชร์ ใน Safari แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”"
          : "เปิดเมนูของเบราว์เซอร์ แล้วเลือก “ติดตั้งแอป” หรือ “เพิ่มไปยังหน้าจอหลัก”";

  return (
    <section className="mx-[7px] rounded-xl border border-[#e6dcf1] bg-white px-4 py-4 text-sm text-[#6f607c] shadow-[0_8px_28px_#40206f0a]">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
          <Icon size={19} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-[#5b476d]">ติดตั้งแอป</h2>
          <p className="mt-1 leading-5 text-xs" aria-live="polite">
            {message}
          </p>
        </div>
      </div>
      {state === "prompt" && (
        <button
          type="button"
          onClick={install}
          className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#d9c8eb] bg-[#faf7fd] px-3 py-2 font-medium text-brand transition-colors hover:bg-brand-soft focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-2"
        >
          <Download size={15} aria-hidden="true" />
          เพิ่มไปยังหน้าจอโฮม
        </button>
      )}
    </section>
  );
}
