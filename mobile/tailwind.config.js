const { light, typeScale, fontFamily } = require("./src/lib/theme/tokens.js");

// Colours are CSS variables set per theme on the root view (src/lib/theme/theme-provider.tsx),
// so a class like `bg-surface` is right in both light and dark without `dark:` variants.
const colors = Object.fromEntries(Object.keys(light).map((name) => [name, `var(--${name})`]));

const fontSize = Object.fromEntries(
  Object.entries(typeScale).map(([name, t]) => [
    name,
    [`${t.size}px`, { lineHeight: `${t.lineHeight}px`, letterSpacing: `${t.tracking}px` }],
  ]),
);

module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors,
      fontSize,
      fontFamily: {
        sans: [fontFamily[400]],
        regular: [fontFamily[400]],
        semibold: [fontFamily[600]],
        bold: [fontFamily[700]],
      },
      borderRadius: {
        card: "18px",
        control: "12px",
      },
    },
  },
  plugins: [],
};
