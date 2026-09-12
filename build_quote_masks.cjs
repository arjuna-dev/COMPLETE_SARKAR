// Rebuild after changing artwork. ImageMagick analyzes pixels without altering images.
const { execFileSync } = require('node:child_process');
const W = 120, H = 160;
const masks = [];
const darkSafeBackgrounds = new Set([18]);
const excludedPolygons = {
  // Baba's white robe is visually indistinguishable from the paper by luminance.
  // Exclude the complete seated figure so only the surrounding paper is writable.
  26: [[
    [28, 22], [44, 25], [56, 44], [72, 53], [76, 70], [88, 81],
    [88, 112], [79, 132], [73, 137], [82, 160], [0, 160],
    [0, 98], [3, 61], [17, 52], [23, 35],
  ]],
};

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = yi > y !== yj > y;
    if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function isExcluded(background, x, y) {
  const polygons = excludedPolygons[background] || [];
  return polygons.some((polygon) => pointInPolygon(x, y, polygon));
}

for (let n = 1; n <= 38; n++) {
  const file = `HTML/Images/quote-bg-${String(n).padStart(2, '0')}.webp`;
  const pixels = execFileSync('magick', [file, '-background', '#f5f1e8', '-alpha', 'remove', '-resize', `${W}x${H}^`, '-gravity', 'center', '-extent', `${W}x${H}`, '-colorspace', 'Gray', '-depth', '8', 'gray:-']);
  const sorted = [...pixels].sort((a,b) => a-b);
  const darkSafe = darkSafeBackgrounds.has(n);
  const threshold = darkSafe
    ? Math.min(120, sorted[Math.floor(sorted.length * 0.4)] + 25)
    : Math.max(185, sorted[Math.floor(sorted.length * 0.85)] - 22);
  const rows = [];
  for (let y=0; y<H; y++) {
    let row = '';
    for (let x=0; x<W; x++) {
      let clear = x >= 5 && x < W-5 && y >= 6 && y < H-6;
      let matchingPixels = 0;
      for(let dy=-2; clear && dy<=2; dy++) for(let dx=-2; dx<=2; dx++) {
        const sampleX = x + dx;
        const sampleY = y + dy;
        if (isExcluded(n, sampleX, sampleY)) {
          clear = false;
          break;
        }
        const value = pixels[sampleY*W+sampleX];
        if (darkSafe ? value <= threshold : value >= threshold) matchingPixels++;
      }
      if (clear) clear = darkSafe ? matchingPixels >= 18 : matchingPixels === 25;
      row += clear ? '1' : '0';
    }
    rows.push(row);
  }
  masks.push({width:W,height:H,rows});
}
process.stdout.write('window.QuoteMasks = ' + JSON.stringify(masks) + ';\n');
