import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

function userscriptAssets(dev = false) {
  let source = readFileSync(resolve(__dirname, '../scripts/qoj-sync.user.js'), 'utf8');
  if (dev) {
    const marker = 'false; // DEV_ORIGIN_ALLOWLIST';
    if (!source.includes(marker)) throw new Error('Missing userscript dev origin marker');
    source = source
      .replace('// @grant        GM_xmlhttpRequest', '// @match        http://localhost/*\n// @match        http://127.0.0.1/*\n// @grant        GM_xmlhttpRequest')
      .replace('XCPC Tracker 主站', 'XCPC Tracker 主站及本地 5173 开发站')
      .replace(marker, "['http://localhost:5173', 'http://127.0.0.1:5173'].includes(location.origin);");
  }
  const version = source.match(/^\/\/ @version\s+(\d+\.\d+\.\d+)$/m)?.[1];
  const metadata = source.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)?.[0];
  if (!version || !metadata) throw new Error('Invalid QOJ userscript metadata');
  return { 'qoj-sync.user.js': source,
    'qoj-sync.version.json': JSON.stringify({version,minimum_version:'1.0.3',protocol_version:1}) };
}

export default defineConfig(({ mode }) => ({
  base: mode === "github-pages" ? "/xcpc-tracker/" : "/",
  plugins: [vue(), {
    name: 'qoj-userscript',
    configureServer(server) {
      // Generated files can change while dev is running; bypass Vite's public-file inventory.
      server.middlewares.use('/generated', async (req, res) => {
        const path=req.url?.split('?')[0] ?? '';
        if (!/^\/(?:contest-index|coverage-basis|problem-lookup)\.json$|^\/contests\/[a-zA-Z0-9_%.-]+\.json$/.test(path)) {
          res.statusCode=404;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Catalog asset not found'}));return;
        }
        try {
          const data=await readFile(resolve(__dirname, '../catalog/generated',path.slice(1)));
          res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(data);
        } catch {
          res.statusCode=404;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Catalog asset not found'}));
        }
      });
      server.middlewares.use('/userscripts', (req, res, next) => {
        const assets = userscriptAssets(true);
        const name = req.url?.split('?')[0].slice(1) as keyof typeof assets;
        if (!Object.hasOwn(assets, name)) return next();
        res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control','no-store');
        res.end(assets[name]);
      });
    },
    generateBundle() {
      for (const [name,source] of Object.entries(userscriptAssets())) this.emitFile({type:'asset', fileName:`userscripts/${name}`,source});
    },
  }],
  publicDir: resolve(__dirname, "../catalog"),
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
}));
