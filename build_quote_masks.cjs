// Rebuild after changing artwork. ImageMagick analyzes pixels without altering images.
const { execFileSync } = require('node:child_process');
const W = 120, H = 160;
const masks = [];
for (let n = 1; n <= 38; n++) {
  const file = `HTML/Images/quote-bg-${String(n).padStart(2, '0')}.webp`;
  const pixels = execFileSync('magick', [file, '-background', '#f5f1e8', '-alpha', 'remove', '-resize', `${W}x${H}^`, '-gravity', 'center', '-extent', `${W}x${H}`, '-colorspace', 'Gray', '-depth', '8', 'gray:-']);
  const sorted = [...pixels].sort((a,b) => a-b);
  const threshold = Math.max(185, sorted[Math.floor(sorted.length * 0.85)] - 22);
  const rows = [];
  for (let y=0; y<H; y++) {
    let row = '';
    for (let x=0; x<W; x++) {
      let clear = x >= 5 && x < W-5 && y >= 6 && y < H-6;
      for(let dy=-2; clear && dy<=2; dy++) for(let dx=-2; clear && dx<=2; dx++) {
        if (pixels[(y+dy)*W+x+dx] < threshold) clear=false;
      }
      row += clear ? '1' : '0';
    }
    rows.push(row);
  }
  masks.push({width:W,height:H,rows});
}
process.stdout.write('window.QuoteMasks = ' + JSON.stringify(masks) + ';\n');
