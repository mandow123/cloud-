"use client";

import { useEffect, useState } from "react";
import { useLocale } from "./locale-provider";

type Preference = "system" | "light" | "dark";

const STORAGE_KEY = "kai-color-mode";

function resolveMode(preference: Preference) {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyPreference(preference: Preference) {
  const root = document.documentElement;
  root.dataset.colorPreference = preference;
  root.dataset.colorMode = resolveMode(preference);
}

export function ThemeControl() {
  const { t } = useLocale();
  const [preference, setPreference] = useState<Preference>("system");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) as Preference | null;
    const next = saved === "light" || saved === "dark" ? saved : "system";
    applyPreference(next);
    const frame = window.requestAnimationFrame(() => setPreference(next));

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      if ((window.localStorage.getItem(STORAGE_KEY) ?? "system") === "system") {
        applyPreference("system");
      }
    };
    media.addEventListener("change", update);
    return () => {
      window.cancelAnimationFrame(frame);
      media.removeEventListener("change", update);
    };
  }, []);

  return (
    <label className="theme-control">
      <span>{t("theme")}</span>
      <select
        aria-label={t("theme")}
        value={preference}
        onChange={(event) => {
          const next = event.target.value as Preference;
          setPreference(next);
          if (next === "system") {
            window.localStorage.removeItem(STORAGE_KEY);
          } else {
            window.localStorage.setItem(STORAGE_KEY, next);
          }
          applyPreference(next);
        }}
      >
        <option value="system">{t("system")}</option>
        <option value="light">{t("light")}</option>
        <option value="dark">{t("dark")}</option>
      </select>
    </label>
  );
}
