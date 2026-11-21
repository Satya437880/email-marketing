/** @type {import('tailwindcss').Config} */
// Colours come from CSS variables (see src/index.css) so light and dark themes swap in one place.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (prefix, steps) => Object.fromEntries(steps.map((s) => [s, v(`${prefix}-${s}`)]));
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: scale("brand", STEPS),
        ink: scale("ink", STEPS),
        surface: v("surface"),
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      // The app is drawn at 80%, so the usual 12px "small" text would land at 9.6px, too small to read comfortably. 13px lands at about 10.4px.
      fontSize: { xs: ["0.8125rem", { lineHeight: "1.15rem" }] },
      boxShadow: { card: "0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)" },
    },
  },
  plugins: [],
};
