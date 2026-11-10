import type { KeyboardEvent } from "react";

/** Implements the WAI-ARIA keyboard convention for a horizontal tab list. */
export function handleTabKey(event: KeyboardEvent<HTMLElement>): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  if (!tabs.length) return;
  const current = Math.max(
    0,
    tabs.findIndex((tab) => tab === document.activeElement),
  );
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}
