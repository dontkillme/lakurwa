// La Kurwa - world: tiles, rooms, walls (edges), objects, pathfinding, building
'use strict';

// ground legend: a sprite name, or a list of variants (picked per tile). Flare tiles: gfx/custom (CC-BY-SA 3.0).
LK.spriteRange = (p, a, b) => Array.from({ length: b - a + 1 }, (_, i) => p + String(a + i).padStart(3, '0'));
LK.GROUND = {
  '.': 'dirt', ',': 'dirtTiles', '=': 'stoneUneven', '~': 'stoneMissingTiles', 's': 'stoneTile', 'f': 'dirtFarmland',
  'a': LK.spriteRange('desert_f', 1, 16),        // desert sand
  'k': LK.spriteRange('desert_f', 17, 32),       // rocky sand
  'g': LK.spriteRange('grass_f', 1, 32),         // grass
  'v': LK.spriteRange('cave_f', 1, 16),          // cave floor
  'w': LK.spriteRange('desert_f', 158, 173)      // water (blocks walking)
};
LK.GROUND_BLOCK = new Set(['w']);
LK.GROUND_NAMES = { '.': 'dirt', ',': 'rubble', '=': 'road', '~': 'broken road', 's': 'stone tiles', 'f': 'farmland', 'a': 'sand', 'k': 'rocky sand', 'g': 'grass', 'v': 'cave floor', 'w': 'water (blocks)' };
LK.ROOMS = {
  B: { name: 'Bar room', floor: 'planks', mat: 'wood', color: '#c8893a' },
  K: { name: 'Kitchen', floor: 'stoneTile', mat: 'wood', color: '#6aa0c8' },
  S: { name: 'Storage', floor: 'planksOld', mat: 'stone', color: '#8a8a5a' },
  X: { name: 'Ruin', floor: null, mat: 'ruin', color: '#777' }
};
// Floor styles that can be painted inside rooms (map layer `floors`, '.' = the room's default floor).
// under: what is drawn below sprites with gaps ('ground' = the outside ground, 'room' = the room's default floor)
// dir: fixed rotation (carpets), otherwise the rotation varies per tile
LK.FLOORS = {
  p: { name: 'Planks', sprite: 'planks' },
  o: { name: 'Old planks', sprite: 'planksOld' },
  b: { name: 'Broken planks', sprite: 'planksBroken', under: 'ground' },
  h: { name: 'Planks with hole', sprite: 'planksHole', under: 'ground' },
  s: { name: 'Stone', sprite: 'stone' },
  t: { name: 'Stone tiles', sprite: 'stoneTile' },
  u: { name: 'Uneven stone', sprite: 'stoneUneven' },
  m: { name: 'Missing tiles', sprite: 'stoneMissingTiles' },
  i: { name: 'Stone pit', sprite: 'stoneInset' },
  d: { name: 'Dirt', sprite: 'dirt' },
  a: { name: 'Sand', sprite: LK.spriteRange('desert_f', 1, 16) },
  g: { name: 'Grass', sprite: LK.spriteRange('grass_f', 1, 32) },
  v: { name: 'Cave floor', sprite: LK.spriteRange('cave_f', 1, 16) },
  r: { name: 'Rubble', sprite: 'dirtTiles' },
  f: { name: 'Farmland', sprite: 'dirtFarmland' },
  c: { name: 'Carpet', sprite: 'floorCarpet', under: 'room', dir: 'E' },
  C: { name: 'Carpet (turned)', sprite: 'floorCarpet', under: 'room', dir: 'S' },
  e: { name: 'Carpet end', sprite: 'floorCarpetEnd', under: 'room', dir: 'E' },
  E: { name: 'Carpet end (turned)', sprite: 'floorCarpetEnd', under: 'room', dir: 'S' }
};
LK.WALLSPR = {
  wood:  { wall: 'woodWall',  door: 'woodWallDoorOpen', window: 'woodWallWindow',  broken: 'woodWallHole' },
  stone: { wall: 'stoneWall', door: 'stoneWallDoor',    window: 'stoneWallWindow', broken: 'stoneWallBroken' },
  ruin:  { wall: 'stoneWallRoundBroken', door: 'stoneWallDoor', window: 'stoneWallWindow', broken: 'stoneWallBroken' }
};

// wall pieces the editor can put on a tile edge (edgeOverride value = the piece's sprite name).
// kind: wall / window = blocks passage; door = passable, an entrance; passage = passable opening (arch, gateway,
// frame, post, broken fence), also an entrance. The generic kinds 'wall' | 'door' | 'window' | 'none' still work
// (they take the room's material).
LK.WALL_PIECES = {};
[
  ['wall', 'woodWall woodWallSupport woodWallCross woodWallDiagional woodWallHole stoneWall stoneWallAged stoneWallAgedLeft stoneWallAgedRight ' +
    'stoneWallHalf stoneWallTop stoneWallCorner stoneWallBroken stoneWallBrokenLeft stoneWallBrokenRight stoneWallHole stoneWallStructure ' +
    'stoneWallRound stoneWallRoundBroken wallBooks fenceHigh fenceLow'],
  ['window', 'woodWallWindow woodWallWindowGlass stoneWallWindow stoneWallWindowBars stoneWallRoundWindow'],
  ['door', 'woodWallDoorOpen woodWallDoorClosed woodWallGateOpen woodWallGateClosed stoneWallDoor stoneWallDoorOpen stoneWallDoorClosed ' +
    'stoneWallDoorBars stoneWallGate stoneWallGateOpen stoneWallGateClosed stoneWallGateBars'],
  ['passage', 'woodWallDoorway woodWallGateway woodWallEmpty woodWallEmptyOpen woodWallCorner stoneWallArchway wallDoorway stoneWallColumn ' +
    'fenceLowBroken fenceHighBroken']
].forEach(([kind, list]) => list.split(' ').forEach(s => { LK.WALL_PIECES[s] = { sprite: s, kind }; }));
LK.WALL_PIECES.stoneWallWindowBars.bars = true;   // thieves need longer to get through barred windows
LK.edgeBlocksKind = k => k === 'wall' || k === 'window' || k === 'broken';
LK.edgePassable = k => k === 'door' || k === 'passage';

LK.World = class {
  constructor(def) {
    this.def = def;
    this.H = def.ground.length;
    this.W = def.ground[0].length;
    this.ground = def.ground.map(r => r.split(''));
    this.rooms = def.rooms.map(r => r.split(''));
    // optional floor layer; missing/short rows are filled with '.' (room default)
    this.floors = this.rooms.map((r, y) => Array.from({ length: r.length }, (_, x) => (def.floors && def.floors[y] && def.floors[y][x]) || '.'));
    this.edges = {};      // key "x,y,N" or "x,y,W" -> {mat, kind}
    this.edgeOverride = {}; // user/map set kinds: key -> kind ('door','window','wall','none')
    this.objects = [];
    this.decals = [];     // puddles etc {x,y,type,t}
    this.route = def.route.slice();
    (def.doors || []).forEach(d => this.edgeOverride[this.edgeKey(d.x, d.y, d.side)] = 'door');
    (def.windows || []).forEach(d => this.edgeOverride[this.edgeKey(d.x, d.y, d.side)] = 'window');
    if (def.edgeOverride) Object.assign(this.edgeOverride, def.edgeOverride);
    this.rebuildWalls();
    (def.objects || []).forEach(o => this.addObject(o.type, o.x, o.y, o.rot || 0, o.built === false ? false : true, o));
  }
  // canonical edge key: side S of (x,y) == N of (x,y+1); E of (x,y) == W of (x+1,y)
  edgeKey(x, y, side) {
    if (side === 'S') return x + ',' + (y + 1) + ',N';
    if (side === 'E') return (x + 1) + ',' + y + ',W';
    return x + ',' + y + ',' + side;
  }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  room(x, y) { return this.inb(x, y) ? this.rooms[y][x] : '.'; }
  isInside(x, y) { const r = this.room(x, y); return r !== '.' && r !== 'X'; }
  isBar(x, y) { const r = this.room(x, y); return r === 'B' || r === 'K' || r === 'S'; }

  rebuildWalls() {
    this.edges = {};
    this._wg = null;          // wall grid for path finding, rebuilt lazily
    this._ent = null;         // entrances cache
    this.touchGround();
    const mk = (x, y, side, a, b) => {
      const key = x + ',' + y + ',' + side;
      const ov = this.edgeOverride[key];
      const piece = LK.WALL_PIECES[ov];
      if (a === b && ov !== 'wall' && ov !== 'window' && !piece) return;
      if (a === '.' && b === '.' && !ov) return;
      if (ov === 'none') return;
      const owner = (a !== '.' && a !== 'X') ? a : (b !== '.' && b !== 'X') ? b : (a !== '.' ? a : b);
      if (owner === '.' && (!ov || ov === 'none')) return;
      const mat = owner === '.' ? 'wood' : LK.ROOMS[owner].mat;   // free-standing walls outside are wooden
      let kind = piece ? piece.kind : ov || 'wall';
      if (owner === 'X' && !ov) {
        const h = LK.hash(x * 3 + (side === 'N' ? 1 : 2), y * 7);
        if (h < 0.3) return;            // gap in the ruin
        kind = h < 0.6 ? 'broken' : 'wall';
      }
      this.edges[key] = piece ? { mat, kind, sprite: piece.sprite } : { mat, kind };
    };
    for (let y = 0; y <= this.H; y++) for (let x = 0; x <= this.W; x++) {
      if (x < this.W) mk(x, y, 'N', this.room(x, y - 1), this.room(x, y));
      if (y < this.H) mk(x, y, 'W', this.room(x - 1, y), this.room(x, y));
    }
  }
  // sprite layers for the floor of tile (x,y), bottom first: [[base, fixedDir|null], ...]
  floorLayers(x, y) {
    const r = this.rooms[y][x], rd = LK.ROOMS[r];
    const ground = [LK.GROUND[this.ground[y][x]] || 'dirt', null];
    const roomFloor = rd && rd.floor ? [rd.floor, null] : ground;
    const f = r !== '.' && LK.FLOORS[this.floors[y][x]];
    if (!f) return [roomFloor];
    const top = [f.sprite, f.dir || null];
    if (f.under === 'ground') return [ground, top];
    if (f.under === 'room') return [roomFloor, top];
    return [top];
  }
  // call after changing ground / rooms / floors: the renderer's ground cache is rebuilt
  touchGround() { this.groundVer = (this.groundVer || 0) + 1; }
  edge(x, y, side) { return this.edges[this.edgeKey(x, y, side)]; }
  edgeBlocks(e) { return !!e && LK.edgeBlocksKind(e.kind); }   // only walls (and windows) block

  // ---- objects ----
  addObject(type, x, y, rot, built, extra) {
    const def = LK.FURNITURE[type];
    if (!def) { console.warn('unknown object', type); return null; }
    const o = { id: LK.uid(), type, x, y, rot: rot || 0, built: built !== false, progress: 0,
      hp: 100, dirty: 0, reserved: null };
    if (extra && extra.hp != null) o.hp = extra.hp;
    this.objects.push(o);
    this.markDirty();
    return o;
  }
  removeObject(o) { this.objects = this.objects.filter(q => q !== o); this.markDirty(); }
  // object standing on tile (x,y) - per-tile index, rebuilt after objects are added/removed
  objAt(x, y) {
    if (!this._objIdx) { this._objIdx = new Map(); for (const o of this.objects) if (!this._objIdx.has(o.y * 100000 + o.x)) this._objIdx.set(o.y * 100000 + o.x, o); }
    return this._objIdx.get(y * 100000 + x);
  }
  // objects with a furniture tag; the per-tag lists are cached until objects are added/removed
  objsWithTag(tag, onlyBuilt) {
    const c = this._tags || (this._tags = {});
    const all = c[tag] || (c[tag] = this.objects.filter(o => (LK.FURNITURE[o.type] || { tags: [] }).tags.includes(tag)));
    return onlyBuilt ? all.filter(o => o.built && o.hp > 0) : all;
  }
  markDirty() { this._block = null; this._tags = null; this._objIdx = null; }
  blockGrid() {
    if (this._block) return this._block;
    const g = new Uint8Array(this.W * this.H);
    for (const o of this.objects) {
      const d = LK.FURNITURE[o.type];
      if (!d) continue;
      if (d.block && this.inb(o.x, o.y)) g[o.y * this.W + o.x] = 1;
      for (const p of d.parts || []) {      // multi-tile objects: blocking parts block their own tile
        const px = o.x + (p.tx || 0), py = o.y + (p.ty || 0);
        if (p.block && this.inb(px, py)) g[py * this.W + px] = 1;
      }
    }
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) if (LK.GROUND_BLOCK.has(this.ground[y][x]) && this.rooms[y][x] === '.') g[y * this.W + x] = 1;
    this._block = g;
    return g;
  }
  walkable(x, y) { return this.inb(x, y) && !this.blockGrid()[y * this.W + x]; }

  // can a character step from (x,y) to neighbour (nx,ny)?
  // blocking walls as flat arrays (fast path finding): W[i] = wall between (x-1,y) and (x,y),
  // N[i] = wall between (x,y-1) and (x,y), i = y * (W+1) + x
  wallGrid() {
    if (this._wg) return this._wg;
    const S = this.W + 1, wW = new Uint8Array(S * (this.H + 1)), wN = new Uint8Array(S * (this.H + 1));
    for (const k in this.edges) {
      if (!this.edgeBlocks(this.edges[k])) continue;
      const c1 = k.indexOf(','), c2 = k.indexOf(',', c1 + 1);
      const x = +k.slice(0, c1), y = +k.slice(c1 + 1, c2);
      if (x < 0 || y < 0 || x > this.W || y > this.H) continue;
      (k[c2 + 1] === 'W' ? wW : wN)[y * S + x] = 1;
    }
    return (this._wg = { S, wW, wN });
  }
  // wall between two orthogonal neighbours? (no bounds/object checks)
  wallBetween(x, y, nx, ny) {
    const g = this.wallGrid();
    if (nx === x + 1) return g.wW[y * g.S + nx] === 1;
    if (nx === x - 1) return g.wW[y * g.S + x] === 1;
    if (ny === y + 1) return g.wN[ny * g.S + x] === 1;
    if (ny === y - 1) return g.wN[y * g.S + x] === 1;
    return true;
  }
  canStep(x, y, nx, ny) {
    if (!this.walkable(nx, ny)) return false;
    const dx = nx - x, dy = ny - y;
    if (dx && dy) {
      // diagonal: both L-shaped routes must be open (no cutting corners through walls or objects)
      return this.walkable(x + dx, y) && this.walkable(x, y + dy) &&
        !this.wallBetween(x, y, x + dx, y) && !this.wallBetween(x + dx, y, nx, ny) &&
        !this.wallBetween(x, y, x, y + dy) && !this.wallBetween(x, y + dy, nx, ny);
    }
    return !this.wallBetween(x, y, nx, ny);
  }

  // A* on the tile grid, 8 directions. goal(x,y) -> bool ; h = heuristic target
  findPath(sx, sy, goalFn, hx, hy, maxIter) {
    sx = Math.floor(sx); sy = Math.floor(sy);
    if (goalFn(sx, sy)) return [];
    const W = this.W, N = W * this.H;
    const g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    // binary heap on flat typed arrays (no per-node allocations)
    let cap = 1024, hf = new Float64Array(cap), hi = new Int32Array(cap), hn = 0;
    const push = (i, f) => {
      if (hn === cap) { cap *= 2; const nf = new Float64Array(cap), ni = new Int32Array(cap); nf.set(hf); ni.set(hi); hf = nf; hi = ni; }
      let k = hn++;
      while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= f) break; hf[k] = hf[p]; hi[k] = hi[p]; k = p; }
      hf[k] = f; hi[k] = i;
    };
    const pop = () => {
      const top = hi[0]; hn--;
      if (hn > 0) {
        const f = hf[hn], i = hi[hn]; let k = 0;
        for (;;) { let l = 2 * k + 1, r = l + 1, m = k, mf = f; if (l < hn && hf[l] < mf) { m = l; mf = hf[l]; } if (r < hn && hf[r] < mf) m = r; if (m === k) break; hf[k] = hf[m]; hi[k] = hi[m]; k = m; }
        hf[k] = f; hi[k] = i;
      }
      return top;
    };
    const H = (x, y) => Math.max(Math.abs(x - hx), Math.abs(y - hy)) * 1.0;
    const s = sy * W + sx;
    g[s] = 0; push(s, H(sx, sy));
    let it = 0; maxIter = maxIter || 6000;
    while (hn > 0 && it++ < maxIter) {
      const i = pop();
      if (closed[i]) continue;
      closed[i] = 1;
      const x = i % W, y = (i / W) | 0;
      if (goalFn(x, y) && i !== s) {
        const path = [];
        let k = i;
        while (k !== s) { path.push([k % W, (k / W) | 0]); k = from[k]; }
        return path.reverse();
      }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (!this.inb(nx, ny)) continue;
        const ni = ny * W + nx;
        if (closed[ni]) continue;
        // allow the goal tile itself even if it is blocked (e.g. walking onto a seat)
        if (!this.canStep(x, y, nx, ny) && !(goalFn(nx, ny) && !dx !== !dy && this.edgeOkOnly(x, y, nx, ny))) continue;
        const ng = g[i] + (dx && dy ? 1.414 : 1);
        if (ng < g[ni]) { g[ni] = ng; from[ni] = i; push(ni, ng + H(nx, ny)); }
      }
    }
    return null;
  }
  edgeOkOnly(x, y, nx, ny) {
    if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) return false;
    return !this.wallBetween(x, y, nx, ny);
  }
  pathTo(sx, sy, tx, ty) { return this.findPath(sx, sy, (x, y) => x === tx && y === ty, tx, ty); }
  // path to any tile from which (tx,ty) can be reached in one step (for blocked objects)
  pathAdjacent(sx, sy, tx, ty) {
    return this.findPath(sx, sy, (x, y) => Math.max(Math.abs(x - tx), Math.abs(y - ty)) === 1 && this.walkable(x, y) &&
      (Math.abs(x - tx) + Math.abs(y - ty) === 1 ? this.edgeOkOnly(x, y, tx, ty) : true) && !this.wallBetweenDiag(x, y, tx, ty), tx, ty);
  }
  wallBetweenDiag(x, y, tx, ty) {
    const dx = tx - x, dy = ty - y;
    if (!dx || !dy) return false;
    return !(this.edgeOkOnly(x, y, x + dx, y) || this.edgeOkOnly(x, y, x, y + dy));
  }

  // ---- queries ----
  roomTiles(code) {
    const out = [];
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) if (this.rooms[y][x] === code) out.push([x, y]);
    return out;
  }
  // tiles of the bar room that are outside-adjacent through a door: the entrances
  entrances() {
    if (this._ent) return this._ent;                       // cached until walls / rooms change
    const out = this._ent = [];
    for (const k in this.edges) {
      const e = this.edges[k];
      if (!LK.edgePassable(e.kind)) continue;
      const [x, y, s] = k.split(',');
      const ax = +x, ay = +y, bx = s === 'W' ? ax - 1 : ax, by = s === 'N' ? ay - 1 : ay;
      const ra = this.room(ax, ay), rb = this.room(bx, by);
      if (ra === 'B' && rb === '.') out.push({ inside: [ax, ay], outside: [bx, by] });
      if (rb === 'B' && ra === '.') out.push({ inside: [bx, by], outside: [ax, ay] });
    }
    return out;
  }
  randomFree(code, notOccupiedFn) {
    const t = this.roomTiles(code).filter(([x, y]) => this.walkable(x, y) && !this.objAt(x, y) && (!notOccupiedFn || notOccupiedFn(x, y)));
    return t.length ? LK.pick(t) : null;
  }
  nearestObj(tag, x, y, filter) {
    let best = null, bd = 1e9;
    for (const o of this.objsWithTag(tag, true)) {
      if (filter && !filter(o)) continue;
      const d = LK.dist(o.x, o.y, x, y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ---- building / extending ----
  setRoom(x, y, code) {
    if (!this.inb(x, y)) return false;
    this.rooms[y][x] = code;
    return true;
  }
  extend(dir, n) {
    // add n columns (E) or rows (S) of fresh wasteland; the road keeps going
    if (dir === 'E') {
      for (let y = 0; y < this.H; y++) for (let i = 0; i < n; i++) {
        this.ground[y].push(this.route.includes(y) ? (Math.random() < 0.15 ? '~' : '=') : (Math.random() < 0.1 ? ',' : '.'));
        this.rooms[y].push('.');
        this.floors[y].push('.');
      }
      this.W += n;
    } else {
      for (let i = 0; i < n; i++) {
        this.ground.push(Array.from({ length: this.W }, () => Math.random() < 0.1 ? ',' : '.'));
        this.rooms.push(Array.from({ length: this.W }, () => '.'));
        this.floors.push(Array.from({ length: this.W }, () => '.'));
      }
      this.H += n;
    }
    this.rebuildWalls();
    this.markDirty();
  }
  // export as an editable map definition (same format as maps/default.js)
  toDef() {
    const doors = [], windows = [];
    const eo = {};
    for (const k in this.edgeOverride) eo[k] = this.edgeOverride[k];
    return {
      name: this.def.name,
      ground: this.ground.map(r => r.join('')),
      rooms: this.rooms.map(r => r.join('')),
      floors: this.floors.some(r => r.some(c => c !== '.')) ? this.floors.map(r => r.join('')) : undefined,
      doors, windows, edgeOverride: eo,
      objects: this.objects.map(o => ({ type: o.type, x: o.x, y: o.y, rot: o.rot, built: o.built, hp: o.hp })),
      route: this.route, playerStart: this.def.playerStart, merchantSpot: this.def.merchantSpot
    };
  }
};
