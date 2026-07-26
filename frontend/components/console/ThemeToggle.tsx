import { useEffect, useState } from "react";
import { Moon, Sun } from "./Icons";

/**
 * Shares the `orydl-theme` localStorage key with the landing page, so a visitor
 * who picked light there lands in light here.
 */
export function ThemeToggle() {
  // `next build` with output:"export" prerenders this in Node, where there is
  // no `document`. Start from the SSR-safe default and adopt the real theme on
  // mount — the inline script in app/layout.tsx has already set the attribute
  // by then, so there is no flash.
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "light" || current === "dark") setTheme(current);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("orydl-theme", theme);
    } catch {
      /* private mode — the in-memory theme still applies */
    }
  }, [theme, mounted]);

  return (
    <button
      className="icon-btn"
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      aria-label="Toggle colour theme"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? <Moon /> : <Sun />}
    </button>
  );
}
