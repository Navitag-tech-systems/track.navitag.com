// Generates ic_stat_navitag.png — a WHITE silhouette of the navitag arrow on a
// transparent background, for use as the Android notification small icon.
// Android renders notification small icons using only the alpha channel (color
// is discarded and the system applies its own tint), so the source must be a
// flat white glyph on transparency. Output to all 5 density buckets.
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'icon-foreground.png');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const NAME = 'ic_stat_navitag.png';
const FILL = 0.86; // glyph fills ~86% of the frame, leaving a small safe margin

// density bucket -> px size (24dp baseline)
const DENSITIES = {
  'drawable-mdpi': 24,
  'drawable-hdpi': 36,
  'drawable-xhdpi': 48,
  'drawable-xxhdpi': 72,
  'drawable-xxxhdpi': 96,
};

(async () => {
  // 1. Trim transparent border, take the alpha silhouette, paint it solid white.
  const trimmed = await sharp(SRC).trim().toBuffer();
  const tmeta = await sharp(trimmed).metadata();
  const alpha = await sharp(trimmed).extractChannel('alpha').toBuffer();
  const whiteSil = await sharp({ create: { width: tmeta.width, height: tmeta.height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .joinChannel(alpha)
    .png()
    .toBuffer();

  for (const [dir, S] of Object.entries(DENSITIES)) {
    const inner = Math.round(S * FILL);
    const resized = await sharp(whiteSil).resize(inner, inner, { fit: 'inside' }).toBuffer();
    const m = await sharp(resized).metadata();
    const padX = S - m.width, padY = S - m.height;
    const left = Math.floor(padX / 2), right = padX - left;
    const topp = Math.floor(padY / 2), bottom = padY - topp;
    const outDir = path.join(RES, dir);
    fs.mkdirSync(outDir, { recursive: true });
    await sharp(resized)
      .extend({ top: topp, bottom, left, right, background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(path.join(outDir, NAME));
    console.log(dir.padEnd(18), S + 'x' + S, '(glyph ' + m.width + 'x' + m.height + ')');
  }

  // Preview: composite the xxxhdpi glyph over blue + dark so we can eyeball it
  // (white-on-transparent is invisible in a plain viewer).
  const big = path.join(RES, 'drawable-xxxhdpi', NAME);
  await sharp(big).resize(192, 192, { kernel: 'nearest' }).flatten({ background: '#1E88E5' })
    .png().toFile(path.join(ROOT, 'scripts', '_preview_blue.png'));
  await sharp(big).resize(192, 192, { kernel: 'nearest' }).flatten({ background: '#222222' })
    .png().toFile(path.join(ROOT, 'scripts', '_preview_dark.png'));
  console.log('wrote previews: scripts/_preview_blue.png, scripts/_preview_dark.png');
})().catch(e => { console.error(e); process.exit(1); });
