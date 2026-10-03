"use client";

import {
  useEffect,
  useRef,
  useState,
  type TouchEvent,
  type TransitionEvent,
} from "react";

type SwipeStart = {
  x: number;
  y: number;
  wasOpen: boolean;
  dragging: boolean;
};

export function useSwipeSidebar(width: number) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "dragging" | "settling">("idle");
  const asideRef = useRef<HTMLElement>(null);
  const startRef = useRef<SwipeStart | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  function finishSettling() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setPhase("idle");
    frameRef.current = requestAnimationFrame(() => {
      asideRef.current?.style.removeProperty("--sidebar-offset");
    });
  }

  function settle(target: boolean) {
    setOpen(target);
    setPhase("settling");
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      asideRef.current?.style.setProperty(
        "--sidebar-offset",
        target ? "0px" : `-${width}px`,
      );
    });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(
      finishSettling,
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 32 : 550,
    );
  }

  function onTransitionEnd(event: TransitionEvent<HTMLElement>) {
    if (
      phase === "settling" &&
      event.target === asideRef.current &&
      (event.propertyName === "translate" || event.propertyName === "transform")
    )
      finishSettling();
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    onTouchCancel();
    if ((event.target as Element).closest("[data-swipe-ignore]")) return;
    if (
      phase !== "idle" ||
      event.touches.length !== 1 ||
      (window.visualViewport?.scale ?? 1) > 1 ||
      window.matchMedia("(min-width: 48rem)").matches
    )
      return;
    const touch = event.touches[0];
    if (open || touch.clientX <= 48)
      startRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        wasOpen: open,
        dragging: false,
      };
  }

  function onTouchMove(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1 || (window.visualViewport?.scale ?? 1) > 1) {
      onTouchCancel();
      return;
    }
    const start = startRef.current;
    if (!start) return;
    const touch = event.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (!start.dragging) {
      if (Math.abs(dx) < 10) return;
      if (Math.abs(dx) <= Math.abs(dy) * 1.25) {
        startRef.current = null;
        return;
      }
      start.dragging = true;
      setPhase("dragging");
    }
    const offset = Math.max(
      -width,
      Math.min(0, (start.wasOpen ? 0 : -width) + dx),
    );
    asideRef.current?.style.setProperty("--sidebar-offset", `${offset}px`);
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = startRef.current;
    startRef.current = null;
    if (!start?.dragging) return;
    if (event.touches.length > 0 || event.changedTouches.length !== 1) {
      settle(start.wasOpen);
      return;
    }
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const horizontal = Math.abs(dx) > Math.abs(dy) * 1.25;
    settle(
      horizontal && Math.abs(dx) >= 64
        ? start.wasOpen
          ? dx >= 0
          : dx > 0
        : start.wasOpen,
    );
  }

  function onTouchCancel() {
    const start = startRef.current;
    startRef.current = null;
    if (start?.dragging) settle(start.wasOpen);
  }

  return {
    open,
    setOpen,
    phase,
    visible: open || phase !== "idle",
    asideRef,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    onTransitionEnd,
  };
}
