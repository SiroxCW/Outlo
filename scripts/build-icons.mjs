#!/usr/bin/env node
// Renders resources/icon.svg into the PNG sizes that Linux desktops and the packages need.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const svg = await readFile(new URL('../resources/icon.svg', import.meta.url));
const outDir = new URL('../resources/icons/', import.meta.url);

await mkdir(outDir, { recursive: true });
for (const size of SIZES) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  await writeFile(new URL(`${size}x${size}.png`, outDir), png);
}
console.log(`Wrote ${SIZES.length} icons to resources/icons`);
