import { defineConfig } from '@rsbuild/core';
import { pluginVue } from '@rsbuild/plugin-vue';

export default defineConfig({
  source: {
    entry: {
      index: './src/main.ts',
    },
  },
  output: {
    distPath: {
      root: '../dist/client',
    },
  },
  plugins: [pluginVue()],
  html: {
    template: './index.html',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3030',
    },
  },
});
