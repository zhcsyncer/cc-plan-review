/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{vue,js,ts,jsx,tsx,html}', './index.html'],
  darkMode: 'class', // 启用 class 模式的暗色主题
  theme: {
    extend: {
      colors: {
        // Claude 紫色主题配色
        'claude': {
          'primary': '#7C3AED',      // 主色（亮色模式）
          'primary-dark': '#8B5CF6', // 主色（暗色模式）
          'primary-hover': '#6D28D9',
          'primary-light': 'rgba(124, 58, 237, 0.1)',
        },
        // 背景色系统
        'app': {
          'bg-light': '#F3F3F3',      // 全局背景（亮色）
          'bg-dark': '#212121',       // 全局背景（暗色）
          'surface-light': '#FFFFFF', // 卡片背景（亮色）
          'surface-dark': '#1E1E1E',  // 卡片背景（暗色）
          'surface-alt-light': '#F0F0F0', // 代码块背景（亮色）
          'surface-alt-dark': '#2D2D2D',  // 代码块背景（暗色）
        },
        // 文字色系统
        'text': {
          'primary-light': '#3C3C3C',   // 主要文字（亮色）
          'primary-dark': '#D4D4D4',    // 主要文字（暗色）
          'secondary-light': '#6B7280', // 次要文字（亮色）
          'secondary-dark': '#9CA3AF',  // 次要文字（暗色）
        },
        // 边框色系统
        'border': {
          'light': '#E5E7EB',
          'dark': '#404040',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [],
};
