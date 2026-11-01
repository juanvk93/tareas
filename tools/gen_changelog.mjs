// Genera CHANGELOG.md a partir de js/changelog.js (fuente única).
// Uso (desde la raíz del proyecto): node tools/gen_changelog.mjs
import { writeFile } from 'node:fs/promises';
import { APP_VERSION, CHANGELOG } from '../js/changelog.js'; // package.json: "type": "module"

const LABEL = { add: 'Añadido', chg: 'Cambiado', fix: 'Corregido' };
let md = `# Registro de cambios\n\nTodos los cambios relevantes de **Tareas**. Versión actual: **${APP_VERSION}**.\n\n` +
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
