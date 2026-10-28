// Phase 2 — generate browsable API docs from server/openapi.json.
//
// Usage: `npm run docs:api`
// Output: docs/api.html (committed). No CDN, no JS framework, no build
// tool: a single static page listing every path, method, summary and
// description from the spec, so the docs work offline and the /docs route
// can serve them from a running server. The preview.yml workflow fails
// when docs/api.html is out of sync with server/openapi.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const specPath = path.join(root, 'server', 'openapi.json');
const outPath = path.join(root, 'docs', 'api.html');

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const methodColors = {
  get: '#0f766e',
  post: '#1d4ed8',
  put: '#b45309',
  delete: '#b91c1c',
  patch: '#6d28d9',
};

const sections = Object.entries(spec.paths || {})
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([route, methods]) => {
    const rows = Object.entries(methods)
      .map(([method, op]) => {
        const color = methodColors[method.toLowerCase()] || '#334155';
        const responses = Object.entries(op.responses || {})
          .map(([code, r]) => `<code>${esc(code)}</code> ${esc(r.description || '')}`)
          .join('<br>');
        return `<tr>
          <td><span class="method" style="background:${color}">${esc(method.toUpperCase())}</span></td>
          <td><code>${esc(route)}</code></td>
          <td><strong>${esc(op.summary || '')}</strong>${op.description ? `<br><span class="desc">${esc(op.description)}</span>` : ''}</td>
          <td>${responses}</td>
        </tr>`;
      })
      .join('\n');
    return `<h2><code>${esc(route)}</code></h2><table><thead><tr><th>Method</th><th>Path</th><th>Summary</th><th>Responses</th></tr></thead><tbody>${rows}</tbody></table>`;
  })
  .join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.info?.title || 'API')} — API Documentation</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 960px; padding: 0 1rem; color: #1e293b; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1rem; margin-top: 2rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #e2e8f0; vertical-align: top; font-size: 0.9rem; }
  th { background: #f8fafc; }
  .method { color: #fff; font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.4rem; border-radius: 4px; }
  .desc { color: #475569; }
  code { background: #f1f5f9; padding: 0.1rem 0.3rem; border-radius: 4px; }
  .note { background: #fefce8; border: 1px solid #fde68a; padding: 0.75rem 1rem; border-radius: 8px; font-size: 0.9rem; }
</style>
</head>
<body>
<h1>${esc(spec.info?.title || 'API')}</h1>
<p>${esc(spec.info?.description || '')}</p>
<p class="note">Generated from <code>server/openapi.json</code> — run <code>npm run docs:api</code> after editing the spec. Served live at <code>/docs</code>; raw spec at <code>/api/openapi.json</code>.</p>
${sections}
<p><small>OpenAPI ${esc(spec.openapi)} · spec version ${esc(spec.info?.version)}</small></p>
</body>
</html>
`;

fs.writeFileSync(outPath, html);
console.log(`Wrote ${outPath} (${Object.keys(spec.paths || {}).length} paths)`);
