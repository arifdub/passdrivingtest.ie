/** @type {import('tailwindcss').Config} */
export default {
  /* Class-based dark mode, not media. The app has its own toggle in Settings,
     and a learner who prefers dark at night should not have the OS override
     the choice they just made in the app. */
  darkMode: "class",
  content: [
    "./app/index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: { extend: {} },
  plugins: [],
};
