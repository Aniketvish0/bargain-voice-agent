import { useEffect, useState } from "react";
import { Moon, Sun } from "./Icons";

/**
 * Shares the `orydl-theme` localStorage key with the landing page, so a visitor
 * who picked light there lands in light here.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">(
    () =>
      (document.documentElement.getAttribute("data-theme") as
        | "dark"
        | "light") ?? "dark",
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("orydl-theme", theme);
    } catch {
      /* private mode — the in-memory theme still applies */
    }
  }, [theme]);

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
