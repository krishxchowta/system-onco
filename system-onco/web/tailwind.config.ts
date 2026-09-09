import type { Config } from "tailwindcss";

// Tailwind v4 loads this compatibility config through @config in globals.css.
// CSS custom properties are the single source of truth for shared tokens.
export default {
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      swiss: {
        background: "var(--swiss-background)",
        foreground: "var(--swiss-foreground)",
        muted: "var(--swiss-muted)",
        accent: "var(--swiss-accent)",
        border: "var(--swiss-foreground)",
      },
    },
    fontFamily: { sans: ["Inter Variable", "Helvetica Neue", "Arial", "sans-serif"] },
    borderRadius: { none: "0px" },
    boxShadow: { none: "none" },
    extend: { fontSize: { display: ["clamp(4rem, 10vw, 10rem)", { lineHeight: "0.9", letterSpacing: "-0.075em", fontWeight: "900" }] } },
  },
} satisfies Config;
