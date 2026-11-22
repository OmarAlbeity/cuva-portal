/* Tailwind build config. Rebuild CSS after changing classes: npm run build:css */
module.exports = {
  content: ['./public/**/*.html', './public/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff1f2',
          100: '#ffe4e6',
          200: '#fecdd3',
          400: '#fb7185',
          500: '#f43f5e',
          600: '#e11d48',
          700: '#be123c',
          800: '#9f1239',
          900: '#881337'
        },
        cuva: {
          red: '#ED1C24',
          blue: '#0072CE',
          green: '#00A651',
          gold: '#FDB913',
          dark: '#231F20'
        }
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'sans-serif']
      }
    }
  }
};
