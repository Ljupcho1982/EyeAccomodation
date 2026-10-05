// Bundles src/ + ui/ into two self-contained files (no server, works offline):
//   dist/index.html     full page, open it directly in a browser
//   dist/artifact.html  same page as a fragment, for publishing as a claude.ai Artifact
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const order = ['grid', 'profile', 'planner', 'guidance', 'voice', 'store', 'session', 'demo-room', 'mapping', 'app'];
const js = order
  .map((n) => readFileSync(`src/${n}.js`, 'utf8').replace(/^import .*;\s*$/gm, '').replace(/^export\s+/gm, ''))
  .join('\n');

const css = readFileSync('ui/style.css', 'utf8');
const body = readFileSync('ui/body.html', 'utf8');
const fonts =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&family=Unbounded:wght@600;700&display=swap">';
const head = `<title>Навигатор</title>\n${fonts}\n<style>\n${css}\n</style>`;
const script = `<script>\n(() => {\n'use strict';\n${js}\n})();\n</script>`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/artifact.html', `${head}\n${body}\n${script}\n`);
writeFileSync(
  'dist/index.html',
  `<!doctype html>\n<html lang="mk">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n<style>body{margin:0}[hidden]{display:none!important}</style>\n</head>\n<body>\n${body}\n${script}\n</body>\n</html>\n`,
);
console.log('built dist/index.html and dist/artifact.html');
