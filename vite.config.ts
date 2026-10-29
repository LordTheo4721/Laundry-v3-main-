import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const isCodespaces = !!process.env.CODESPACES;
  const codespaceName = process.env.CODESPACE_NAME;
  const githubUser = process.env.GITHUB_USER;
  // Allow Render domain and other production hosts
  const allowedHosts = [
    'happywashlandry.onrender.com',
    'localhost',
    '.onrender.com', // Allow all onrender.com subdomains
  ];
  
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 8080,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Allow external hosts (Render, Codespaces, etc.)
      allowedHosts,
      // Codespaces support: allow HMR over forwarded ports
      ...(isCodespaces && codespaceName && githubUser && {
        hmr: {
          protocol: 'wss',
          host: `${codespaceName}-8080.${githubUser}.githubpreview.dev`,
          clientPort: 443,
        },
      }),
    },
  };
});
