/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#F8F3EF",
        card: "#FFFDFB",
        ink: "#1F1A18",
        muted: "#6F635D",
        border: "#E9DCD2",
        crimson: {
          50: "#FBE9E4",
          100: "#F4C9BF",
          200: "#EAA697",
          300: "#DC8170",
          400: "#CB624F",
          500: "#B14437",
          600: "#9A3326",
          700: "#7D261C",
          800: "#5F1B15",
          900: "#3F100C",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "sans-serif",
        ],
        serif: [
          "Source Han Serif SC",
          "Noto Serif SC",
          "Songti SC",
          "STZhongSong",
          "serif",
        ],
      },
      boxShadow: {
        soft: "0 24px 48px -28px rgba(99, 36, 22, 0.25)",
        ring: "0 0 0 6px rgba(177, 68, 55, 0.12)",
      },
      borderRadius: {
        xl: "0.95rem",
        "2xl": "1.25rem",
      },
      backgroundImage: {
        "gradient-canvas":
          "radial-gradient(circle at 10% 10%, #fbe7e2, #f8f3ef 45%, #f3ece6 100%)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
