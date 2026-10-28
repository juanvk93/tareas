// Genera CHANGELOG.md a partir de js/changelog.js (fuente única).
// Uso (desde la raíz del proyecto): node tools/gen_changelog.mjs
import { readFile, writeFile } from 'node:fs/promises';

// changelog.js es un ES module con extensión .js: lo cargamos como data: URL
// para no depender de "type": "module" en un package.json que no existe.
const src = await readFile(new URL('../js/changelog.js', import.meta.url), 'utf8');
const { APP_VERSION, CHANGELOG } = await import('data:text/javascript,' + encodeURIComponent(src));

const LABEL = { add: 'Añadido', chg: 'Cambiado', fix: 'Corregido' };
let md = `# Registro de cambios\n\nTodos los cambios relevantes de **Tareas del Hogar**. Versión actual: **${APP_VERSION}**.\n\n` +
  `> Archivo generado desde \`js/changelog.js\` con \`node tools/gen_changelog.mjs\`. No editar a mano.\n`;
for (const e of CHANGELOG) {
  md += `\n## [${e.version}] — ${e.date}\n`;
  for (const type of ['add', 'chg', 'fix']) {
    const items = e.changes.filter((c) => c.type === type);
    if (!items.length) continue;
    md += `\n### ${LABEL[type]}\n\n` + items.map((c) => `- ${c.text}`).join('\n') + '\n';
  }
}
await writeFile(new URL('../CHANGELOG.md', import.meta.url), md);
console.log(`CHANGELOG.md generado (${CHANGELOG.length} versiones, actual ${APP_VERSION}).`);
