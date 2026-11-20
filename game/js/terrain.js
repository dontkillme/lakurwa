// La Kurwa - natural transitions between ground types (domain warping).
// Every pixel of a ground tile shows the ground of the tile at its slightly DISPLACED world position;
// the displacement is smooth noise in world coordinates. Borders between natural ground types
// therefore become crisp, irregular curves (sand patches, shorelines, field edges) that continue
// seamlessly across tiles and corners. Built surfaces (roads, stone tiles) and room floors are never
// warped into or out of, so they keep their straight edges.
'use strict';

// ground chars that get natural borders (missing = straight edges). Structured textures keep straight
// edges: roads/stone (built), farmland (furrows), rubble and rocky sand (their stones would be cut in half).
LK.GROUND_BLEND = { '.': 1, 'a': 1, 'g': 1, 'v': 1, 'w': 1 };
LK.TERRAIN = {
  on: true,
  amp: 0.42,      // max displacement in tiles (< 0.5: only direct neighbours can show through)
  freq: 1.3,      // noise frequency per tile (higher = more wiggly)
  res: 2,         // masks are computed on a res x res pixel grid and smoothed when scaled up (speed + anti-aliasing)
  budget: 60      // new masks per frame at most (big maps fill in over a few frames instead of stalling)
};

// smooth value noise in world coordinates, range about -1..1 (two octaves)
function lattice(ix, iy, seed) { return LK.hash(ix * 7 + seed * 1013, iy * 13 + seed * 517) * 2 - 1; }
function vnoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = lattice(x0, y0, seed) * (1 - sx) + lattice(x0 + 1, y0, seed) * sx;
  const b = lattice(x0, y0 + 1, seed) * (1 - sx) + lattice(x0 + 1, y0 + 1, seed) * sx;
  return a * (1 - sy) + b * sy;
}
function noise2(x, y, seed) {
  const f = LK.TERRAIN.freq;
  return vnoise(x * f, y * f, seed) * 0.72 + vnoise(x * f * 2.9, y * f * 2.9, seed + 50) * 0.28;
}
// displacement vector at a world point
LK.warp = (wx, wy) => [LK.TERRAIN.amp * noise2(wx, wy, 1), LK.TERRAIN.amp * noise2(wx, wy, 2)];

// pieces get a margin around the 128x64 tile so neighbouring pieces overlap (no hairline seams)
const M = 4, CW = 128 + 2 * M, CH = 64 + 2 * M;
// the 8 neighbours (index = (dy+1)*3 + (dx+1), centre = 4)
const OFFS = [];
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) OFFS.push([dx, dy]);

LK.Terrain = {
  cache: {}, budget: 0, sameAsMe: [],

  // ground char drawn on tile (x,y), or null when the tile shows a room floor
  groundAt(w, x, y) {
    if (!w.inb(x, y)) return null;
    const r = w.rooms[y][x];
    if (r !== '.' && r !== 'X') return null;
    return w.ground[y][x];
  },
  // world position of pixel (px,py) of the piece canvas of tile (x,y) (tile centre at 64+M, 32+M)
  pixelToWorld(x, y, px, py) {
    const a = (px - 64 - M) / 64, b = (py - 32 - M) / 32;
    return [x + 0.5 + (a + b) / 2, y + 0.5 + (b - a) / 2];
  },
  // which neighbour (index into OFFS, 4 = the tile itself) shows at world point (wx,wy) of tile (x,y)
  // blend[]: which neighbours are allowed (natural ground of a different type)
  ownerAt(x, y, wx, wy, allowed) {
    const [dx, dy] = LK.warp(wx, wy);
    const ox = Math.floor(wx + dx) - x, oy = Math.floor(wy + dy) - y;
    if (ox >= -1 && ox <= 1 && oy >= -1 && oy <= 1) {
      const i = (oy + 1) * 3 + (ox + 1);
      if (i === 4 || allowed[i]) return i;
      if (this.sameAsMe[i]) return 4;                      // same ground as this tile
    }
    // warped onto something that doesn't blend (road, stone, room, map edge): use the tile the point is
    // really in - every tile computes the same answer there, so the border stays consistent
    const rx = Math.floor(wx) - x, ry = Math.floor(wy) - y, j = (ry + 1) * 3 + (rx + 1);
    return rx >= -1 && rx <= 1 && ry >= -1 && ry <= 1 && allowed[j] ? j : 4;
  },

  // masks (128x64 canvases) for the neighbours that show through on tile (x,y): { key, list: {index: canvas} };
  // cached per tile and neighbourhood layout
  masks(w, x, y) {
    const me = this.groundAt(w, x, y);
    const allowed = OFFS.map(([dx, dy], i) => {
      if (i === 4) return false;
      const g = this.groundAt(w, x + dx, y + dy);
      return g != null && g !== me && !!LK.GROUND_BLEND[g];
    });
    if (!allowed.some(Boolean)) return null;
    this.sameAsMe = OFFS.map(([dx, dy]) => this.groundAt(w, x + dx, y + dy) === me);
    const sig = OFFS.map(([dx, dy]) => this.groundAt(w, x + dx, y + dy) || '#').join('');
    const key = x + ',' + y + ':' + sig;
    if (this.cache[key]) return this.cache[key];
    if (this.budget <= 0) return 'later';
    this.budget--;
    const R = LK.TERRAIN.res, LW = Math.ceil(CW / R), LH = Math.ceil(CH / R), cover = OFFS.map(() => null);
    for (let ly = 0; ly < LH; ly++) for (let lx = 0; lx < LW; lx++) {
      const px = (lx + 0.5) * R, py = (ly + 0.5) * R;
      if (Math.abs(px - 64 - M) / (64 + M + R) + Math.abs(py - 32 - M) / (32 + M / 2 + R) > 1) continue;   // diamond + margin
      const [wx, wy] = this.pixelToWorld(x, y, px, py);
      const o = this.ownerAt(x, y, wx, wy, allowed);
      if (o === 4) continue;
      if (!cover[o]) cover[o] = new Uint8Array(LW * LH);
      cover[o][ly * LW + lx] = 1;
    }
    const out = { key, list: {} };
    cover.forEach((cv, i) => {
      if (!cv) return;
      const lo = document.createElement('canvas'); lo.width = LW; lo.height = LH;
      const lg = lo.getContext('2d'), img = lg.createImageData(LW, LH);
      for (let k = 0; k < cv.length; k++) img.data[k * 4 + 3] = cv[k] ? 255 : 0;
      lg.putImageData(img, 0, 0);
      // scale up with smoothing: soft, anti-aliased border
      const c = document.createElement('canvas'); c.width = CW; c.height = CH;
      const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.filter = 'blur(' + (R * 0.55) + 'px)';            // round off the steps of the coarse grid
      g.drawImage(lo, 0, 0, LW * R, LH * R);
      out.list[i] = c;
    });
    return (this.cache[key] = out);
  },
  // the neighbour's ground texture cut out by its mask (null while the sprite is still loading)
  piece(masks, i, sprite, key) {
    const k = key + '|' + i + '|' + sprite;
    if (this.cache[k]) return this.cache[k];
    if (!LK.iso(sprite)) return null;
    const c = document.createElement('canvas'); c.width = CW; c.height = CH;
    const g = c.getContext('2d');
    g.save();
    g.beginPath(); g.moveTo(64 + M, 0); g.lineTo(CW, 32 + M); g.lineTo(64 + M, CH); g.lineTo(0, 32 + M); g.closePath(); g.clip();
    // lay the neighbour's ground out as a 3x3 grid of tiles (back to front, overlapping like the ground pass),
    // so the texture continues seamlessly instead of showing the sprite's own rim at the tile edges
    if (LK.TERRAIN.debug) { g.fillStyle = ['#f00', '#0f0', '#00f', '#ff0', '', '#0ff', '#f0f', '#fff', '#f80'][i]; g.fillRect(0, 0, CW, CH); }
    else for (const [ox, oy] of OFFS.slice().sort((p, q) => p[0] + p[1] - q[0] - q[1]))
      LK.drawIso(g, sprite, 64 + M + (ox - oy) * 64, 32 + M + (ox + oy) * 32, 1, LK.GROUND_OVERLAP);
    g.restore();
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(masks.list[i], 0, 0);
    return (this.cache[k] = c);
  },
  // draw the natural borders onto tile (x,y) whose top face centre is at screen (sx,sy)
  drawBlends(ctx, w, x, y, sx, sy, z) {
    if (!LK.TERRAIN.on) return;
    const me = this.groundAt(w, x, y);
    if (me == null || !LK.GROUND_BLEND[me]) return;
    const masks = this.masks(w, x, y);
    if (!masks) return;
    if (masks === 'later') return false;              // over this frame's budget: draw again later
    let ready = true;
    for (const i of Object.keys(masks.list)) {
      const [dx, dy] = OFFS[i], nx = x + dx, ny = y + dy;
      const pc = this.piece(masks, i, LK.groundName(LK.GROUND[this.groundAt(w, nx, ny)], nx, ny), masks.key);
      if (pc) ctx.drawImage(pc, sx - (64 + M) * z, sy - (32 + M) * z, CW * z, CH * z);
      else ready = false;                             // texture still loading
    }
    return ready;
  }
};
