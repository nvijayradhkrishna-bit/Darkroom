// Copies the background-removal AI model into public/imgly so the app works with no internet.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const src = 'node_modules/@imgly/background-removal-data/dist', dst = 'public/imgly';
if (!existsSync(src)) { console.error('Model package missing. Run: npm install'); process.exit(1); }
rmSync(dst, { recursive: true, force: true }); mkdirSync(dst, { recursive: true });
try {
  // Keep only the small quantized model + runtime files to keep the APK small.
  const res = JSON.parse(readFileSync(join(src, 'resources.json'), 'utf8'));
  const keep = {}, hashes = new Set();
  for (const [k, v] of Object.entries(res)) {
    if (k.startsWith('/models/') && !k.startsWith('/models/isnet_quint8')) continue;
    keep[k] = v; (v.chunks || []).forEach(c => hashes.add(c.hash));
  }
  for (const h of hashes) cpSync(join(src, h), join(dst, h));
  cpSync(join(src, 'resources.json'), join(dst, 'resources.json'));
  console.log(`Copied ${hashes.size} model chunks.`);
} catch (e) {
  console.warn('Filtering failed, copying everything:', e.message);
  cpSync(src, dst, { recursive: true });
}
