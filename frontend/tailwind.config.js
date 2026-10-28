import defaultTheme from "tailwindcss/defaultTheme";
import colors from "tailwindcss/colors";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // UI revamp "Indigo Refined": one font and cooler neutrals, applied app-wide from here.
      fontFamily: { sans: ['"Plus Jakarta Sans"', ...defaultTheme.fontFamily.sans] },
      colors: { gray: colors.slate },
    },
  },
  plugins: [],
}
