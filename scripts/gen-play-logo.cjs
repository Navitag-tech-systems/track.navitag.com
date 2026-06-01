// Generates play-app-logo.png — navitag arrow at 70% of a 512x512 cream tile,
// with a Material Design product-icon cast shadow (single top light source,
// soft black, two-layer ambient+key, clipped to the tile).
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'icon-foreground.png');
const OUT = path.join(ROOT, 'assets', 'play-app-logo.png');

const SIZE = 512;
const BG = { r: 247, g: 244, b: 239 };  // brand cream #F7F4EF
const SHADOW = { r: 180, g: 180, b: 180 }; // light grey shadow
const PCT = 0.70;                       // logo = 70% of canvas
const PAD = 64;                         // transparent pad so blur can bleed

(async () => {
  // 1. Trim transparent border from the source foreground to get a tight logo bbox.
  const trimmed = await sharp(SRC).trim().toBuffer();
  const tmeta = await sharp(trimmed).metadata();
  console.log('source trimmed logo:', tmeta.width + 'x' + tmeta.height, 'hasAlpha=' + tmeta.hasAlpha);

  // 2. Scale so the longest side = 70% of the canvas.
  const target = Math.round(PCT * SIZE);
  const scale = target / Math.max(tmeta.width, tmeta.height);
  const lw = Math.round(tmeta.width * scale);
  const lh = Math.round(tmeta.height * scale);
  const logo = await sharp(trimmed).resize(lw, lh, { fit: 'fill' }).png().toBuffer();
  const left = Math.round((SIZE - lw) / 2);
  const top = Math.round((SIZE - lh) / 2);
  console.log('scaled logo:', lw + 'x' + lh,
    '(' + (Math.max(lw, lh) / SIZE * 100).toFixed(1) + '% of canvas), placed at', left + ',' + top);

  // 3. Grey silhouette from the logo's alpha channel.
  const alpha = await sharp(logo).extractChannel('alpha').toBuffer();
  const sil = await sharp({ create: { width: lw, height: lh, channels: 3, background: SHADOW } })
    .joinChannel(alpha)
    .png()
    .toBuffer();

  // Build one shadow layer: pad -> gaussian blur -> scale alpha by opacity.
  async function shadowLayer(sigma, opacity) {
    const padded = await sharp(sil)
      .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .blur(sigma)
      .toBuffer();
    const m = await sharp(padded).metadata();
    const a = await sharp(padded).extractChannel('alpha').linear(opacity, 0).toBuffer();
    const buf = await sharp({ create: { width: m.width, height: m.height, channels: 3, background: SHADOW } })
      .joinChannel(a)
      .png()
      .toBuffer();
    return buf;
  }

  // Even soft halo on all sides (no directional offset). Two blur radii for falloff.
  const ambient = await shadowLayer(9, 0.16); // soft outer halo
  const key = await shadowLayer(5, 0.16);     // tighter inner halo

  const place = (dx, dy) => ({ left: left - PAD + dx, top: top - PAD + dy });

  // 4. Composite: cream bg -> ambient -> key -> logo. RGB output (opaque store icon).
  await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: BG } })
    .composite([
      { input: ambient, ...place(0, 0) },
      { input: key, ...place(0, 0) },
      { input: logo, left, top },
    ])
    .png({ compressionLevel: 9 })
    .toFile(OUT);

  const stat = fs.statSync(OUT);
  console.log('wrote', path.relative(ROOT, OUT), '(' + (stat.size / 1024).toFixed(1) + ' KB)');
})().catch(e => { console.error(e); process.exit(1); });
