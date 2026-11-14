/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: [
          "Hiragino Maru Gothic ProN",
          "Hiragino Sans",
          "Noto Sans JP",
          "Yu Gothic",
          "Meiryo",
          "system-ui",
          "sans-serif",
        ],
      },
      boxShadow: {
        pop: "4px 4px 0 var(--line)",
        popLg: "8px 8px 0 var(--line)",
      },
    },
  },
  plugins: [],
};
