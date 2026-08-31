/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0b1220",
        surface: "#121b2e",
        surface2: "#16233b",
        line: "#2a3a54",
        muted: "#8fa0bc",
        accent: "#ff8a3d",
        accent2: "#4fd1c5",
        good: "#7fd88f",
        bad: "#e57373",
      },
      fontFamily: {
        display: ["Archivo", "sans-serif"],
        body: ["Source Sans 3", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
