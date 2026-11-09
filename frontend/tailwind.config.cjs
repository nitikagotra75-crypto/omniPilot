/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Mochiy Pop One'", "'Fredoka Variable'", "'Nirmala UI'", "sans-serif"],
        sans: ["'Fredoka Variable'", "'Nirmala UI'", "'Segoe UI'", "sans-serif"],
        mono: ["ui-monospace", "Consolas", "monospace"],
      },
      colors: {
        paper: "#eaf6ff",      // sky background
        surface: "#ffffff",
        blush: "#fff0f6",
        lilac: "#ece5ff",
        line: "#23194226",
        ink: { DEFAULT: "#231942", soft: "#5a4a8a", faint: "#8a7fb5" },
        lemon: "#ffe566",
        sky: "#9bd8ff",
        grape: "#8b6cff",
        pink: { 300: "#ff9ac1", 400: "#ff7db1", 500: "#ff5c9e", 600: "#d9337c" },
        mint: { 400: "#0f9d76", 500: "#2fd6a1" },
        rose: { 400: "#e5384f" },
      },
      boxShadow: {
        pop: "4px 4px 0 #231942",
        "pop-sm": "0 3px 0 #231942",
        "pop-rose": "0 3px 0 #e5384f",
      },
      keyframes: {
        rise: { "0%": { opacity: 0, transform: "translateY(8px) scale(.98)" }, "100%": { opacity: 1, transform: "none" } },
        bob: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-5px)" } },
        bounce2: { "0%,100%": { transform: "translateY(0) scale(1,1)" }, "40%": { transform: "translateY(-9px) scale(.96,1.05)" }, "70%": { transform: "translateY(0) scale(1.05,.94)" } },
        blink: { "0%,92%,100%": { transform: "scaleY(1)" }, "95%": { transform: "scaleY(.08)" } },
        twirl: { to: { transform: "rotate(360deg)" } },
        sweep: { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(250%)" } },
        wiggle: { "0%,100%": { transform: "rotate(-2deg)" }, "50%": { transform: "rotate(2deg)" } },
      },
      animation: {
        rise: "rise .3s cubic-bezier(.2,1.3,.4,1) both",
        bob: "bob 2.6s ease-in-out infinite",
        bounce2: "bounce2 .7s ease-in-out infinite",
        twirl: "twirl 1.6s linear infinite",
        sweep: "sweep 1.4s ease-in-out infinite",
        wiggle: "wiggle 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
