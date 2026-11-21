// Sokoban solver for make.fun sokoban-solver-01-run-20261121 (MIT).
//
// Approach: push-based search, room by room. Every generated level is a
// 1-wide hallway with 1-4 rooms off it; a box pushed out of a room into the
// hallway can never come back, so each room is an independent sub-problem and
// the level optimum is the sum of the rooms' optima. Each room is solved
// push-optimally with a breadth-first search over pushes: a state is the
// boxes' squares plus the player's reachable region (named by its lowest
// square). Two sound prunes keep the search small: dead squares (a box that
// can never be pushed onto any goal, found by pulling boxes back from the
// goals) and frozen 2x2 blocks (walls/boxes with a box off its goal). Work is
// budgeted by states expanded, never by the wall clock, so two runs write
// the same bytes. Fallbacks, in order, if a room's BFS exhausts its budget:
// push-A* with a sum-of-min-distances heuristic, then a plain move-A* that
// at least produces a valid solution. Stdlib only, no network, no clock.
//
// Input:  /input/<id>/level.txt (or $MAKEFUN_INPUT_DIR); output:
// /output/<id>/solution.txt (or $MAKEFUN_OUTPUT_DIR), moves in LURD.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Budget in states, counted work (never time): the generator certifies each
// room solvable within 250k states, so 400k per room leaves headroom; the
// whole run is capped so the 60 s wall is never approached.
const BFS_STATES_PER_ROOM = 400_000;
const ASTAR_STATES_PER_ROOM = 400_000;
const MOVE_ASTAR_STATES = 200_000;

type Dir = [number, number, string, string];
const DIRS: Dir[] = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x] as string;
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

/** Squares from which a box can be pushed onto some goal (pull-back from goals). */
function liveSquares(level: Level): Uint8Array {
  const { w, wall, goals } = level;
  const live = new Uint8Array(wall.length);
  const queue = [...goals];
  for (const g of goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi] as number;
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/** Flood-fill the player's reachable region; returns its lowest square. */
function reachLow(
  level: Level, occupied: Uint8Array, from: number,
  seen: Int32Array, stamp: number, stack: Int32Array,
): number {
  const { w, wall } = level;
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n] as number;
    if (p < low) low = p;
    for (let k = 0; k < 4; k++) {
      const q = k === 0 ? p - w : k === 1 ? p + w : k === 2 ? p - 1 : p + 1;
      if (wall[q] === 0 && occupied[q] === 0 && seen[q] !== stamp) {
        seen[q] = stamp;
        stack[n++] = q;
      }
    }
  }
  return low;
}

/** True when the box just pushed to `t` sits in a frozen 2x2 block. */
function frozenBlock(level: Level, occupied: Uint8Array, goal: Uint8Array, t: number): boolean {
  const { w, wall } = level;
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b]) ||
        !(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) ||
        (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

/** Shortest walk from `from` to `to` around walls and boxes (lower-case LURD). */
function walkTo(level: Level, occupied: Uint8Array, from: number, to: number): string {
  const { w, wall } = level;
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how = new Array<string>(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi] as number;
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * w + dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: push square out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p] as number) s = (how[p] as string) + s;
  return s;
}

function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

interface Solved {
  pushes: number;
  moves: string;
}

/**
 * Push-optimal BFS for one level (or one room sub-level). States are kept in
 * discovery order; expansion is in pushes-made order, so the first solved
 * state met is push-optimal. Returns null when the state budget runs out
 * or the level is unsolvable.
 */
function solvePushBfs(level: Level, maxStates: number): Solved | null {
  const { w, wall, goals } = level;
  const size = wall.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(level);
  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;
  const solved = (boxes: number[]): boolean => boxes.every((b) => goal[b]);
  if (level.boxes.some((b) => !live[b])) return null;

  const keyOf = (boxes: number[], low: number): number => {
    let k = low;
    for (const b of boxes) k = k * size + b;
    return k;
  };

  const statesBoxes: number[][] = [level.boxes];
  const statesPlayer: number[] = [level.player];
  const parent: number[] = [-1];
  const index = new Map<number, number>();
  for (const b of level.boxes) occupied[b] = 1;
  index.set(keyOf(level.boxes, reachLow(level, occupied, level.player, seen, ++stamp, stack)), 0);
  for (const b of level.boxes) occupied[b] = 0;
  let found = solved(level.boxes) ? 0 : -1;
  for (let head = 0; found < 0 && head < statesBoxes.length; head++) {
    const boxes = statesBoxes[head] as number[];
    for (const b of boxes) occupied[b] = 1;
    reachLow(level, occupied, statesPlayer[head] as number, seen, ++stamp, stack);
    const here = stamp;
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi] as number;
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const t = b + d;
        if (seen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(level, occupied, goal, t);
        let key = -1;
        let next: number[] | null = null;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((a, x) => a - x);
          key = keyOf(next, reachLow(level, occupied, b, mark, ++stamp, stack));
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen || index.has(key)) continue;
        if (statesBoxes.length >= maxStates) {
          for (const x of boxes) occupied[x] = 0;
          return null;
        }
        index.set(key, statesBoxes.length);
        statesBoxes.push(next as number[]);
        statesPlayer.push(b);
        parent.push(head);
        if (solved(next as number[])) {
          found = statesBoxes.length - 1;
          break;
        }
      }
    }
    for (const x of boxes) occupied[x] = 0;
  }
  if (found < 0) return null;
  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s] as number) path.push(s);
  path.reverse();
  let moves = '';
  let player = level.player;
  let boxes = level.boxes;
  for (const s of path) {
    const nextBoxes = statesBoxes[s] as number[];
    const from = boxes.find((b) => !nextBoxes.includes(b)) as number;
    const to = nextBoxes.find((b) => !boxes.includes(b)) as number;
    const d = to - from;
    const dir = DIRS.find(([dx, dy]) => dy * w + dx === d) as Dir;
    for (const b of boxes) occupied[b] = 1;
    moves += walkTo(level, occupied, player, from - d);
    for (const b of boxes) occupied[b] = 0;
    moves += dir[3];
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

/**
 * Push-A* fallback: same push states, best-first on pushes + sum of each
 * box's Manhattan distance to its nearest goal (admissible: one push moves
 * one box by one square). May return a non-optimal solution; still far
 * better than no solution.
 */
function solvePushAstar(level: Level, maxStates: number): Solved | null {
  const { w, wall, goals } = level;
  const size = wall.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(level);
  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;
  const solved = (boxes: number[]): boolean => boxes.every((b) => goal[b]);
  if (level.boxes.some((b) => !live[b])) return null;
  const gx = goals.map((g) => g % w);
  const gy = goals.map((g) => Math.floor(g / w));
  const h = (boxes: number[]): number => {
    let s = 0;
    for (const b of boxes) {
      const bx = b % w;
      const by = Math.floor(b / w);
      let m = Infinity;
      for (let i = 0; i < goals.length; i++) {
        const d = Math.abs((gx[i] as number) - bx) + Math.abs((gy[i] as number) - by);
        if (d < m) m = d;
      }
      s += m;
    }
    return s;
  };
  const keyOf = (boxes: number[], low: number): number => {
    let k = low;
    for (const b of boxes) k = k * size + b;
    return k;
  };
  // Heap of [f, g, stateIndex], smallest f first, ties by larger g then index.
  const heap: [number, number, number][] = [];
  const less = (a: [number, number, number], b: [number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] < b[2])));
  const heapPush = (e: [number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i] as [number, number, number], heap[p] as [number, number, number])) break;
      const tmp = heap[i] as [number, number, number];
      heap[i] = heap[p] as [number, number, number];
      heap[p] = tmp;
      i = p;
    }
  };
  const heapPop = (): [number, number, number] => {
    const top = heap[0] as [number, number, number];
    const last = heap.pop() as [number, number, number];
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1] as [number, number, number], heap[c] as [number, number, number])) c++;
        if (!less(heap[c] as [number, number, number], heap[i] as [number, number, number])) break;
        const tmp = heap[i] as [number, number, number];
        heap[i] = heap[c] as [number, number, number];
        heap[c] = tmp;
        i = c;
      }
    }
    return top;
  };

  const statesBoxes: number[][] = [level.boxes];
  const statesPlayer: number[] = [level.player];
  const parent: number[] = [-1];
  const stateG: number[] = [0];
  const best = new Map<number, number>();
  for (const b of level.boxes) occupied[b] = 1;
  best.set(keyOf(level.boxes, reachLow(level, occupied, level.player, seen, ++stamp, stack)), 0);
  for (const b of level.boxes) occupied[b] = 0;
  heapPush([h(level.boxes), 0, 0]);
  let found = solved(level.boxes) ? 0 : -1;
  let expanded = 0;
  while (heap.length > 0 && found < 0 && expanded < maxStates) {
    const [, g, s] = heapPop();
    if (best.get(keyOf(statesBoxes[s] as number[], reachLow(level, (() => {
      for (const b of statesBoxes[s] as number[]) occupied[b] = 1;
      return occupied;
    })(), statesPlayer[s] as number, seen, ++stamp, stack))) !== s) {
      for (const b of statesBoxes[s] as number[]) occupied[b] = 0;
      continue;
    }
    for (const b of statesBoxes[s] as number[]) occupied[b] = 0;
    const boxes = statesBoxes[s] as number[];
    expanded++;
    for (const b of boxes) occupied[b] = 1;
    reachLow(level, occupied, statesPlayer[s] as number, seen, ++stamp, stack);
    const here = stamp;
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi] as number;
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const t = b + d;
        if (seen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(level, occupied, goal, t);
        let key = -1;
        let next: number[] | null = null;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((a, x) => a - x);
          key = keyOf(next, reachLow(level, occupied, b, mark, ++stamp, stack));
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen) continue;
        const prev = best.get(key);
        if (prev !== undefined && (stateG[prev] as number) <= g + 1) continue;
        if (statesBoxes.length >= maxStates) {
          for (const x of boxes) occupied[x] = 0;
          return null;
        }
        const idx = statesBoxes.length;
        best.set(key, idx);
        statesBoxes.push(next as number[]);
        statesPlayer.push(b);
        parent.push(s);
        stateG.push(g + 1);
        if (solved(next as number[])) {
          found = idx;
          break;
        }
        heapPush([g + 1 + h(next as number[]), g + 1, idx]);
      }
    }
    for (const x of boxes) occupied[x] = 0;
  }
  if (found < 0) return null;
  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s] as number) path.push(s);
  path.reverse();
  let moves = '';
  let player = level.player;
  let boxes = level.boxes;
  for (const s of path) {
    const nextBoxes = statesBoxes[s] as number[];
    const from = boxes.find((b) => !nextBoxes.includes(b)) as number;
    const to = nextBoxes.find((b) => !boxes.includes(b)) as number;
    const d = to - from;
    const dir = DIRS.find(([dx, dy]) => dy * w + dx === d) as Dir;
    for (const b of boxes) occupied[b] = 1;
    moves += walkTo(level, occupied, player, from - d);
    for (const b of boxes) occupied[b] = 0;
    moves += dir[3];
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

/** Plain move-A* last resort (fewest moves, not fewest pushes). */
function solveMoveAstar(level: Level, maxStates: number): Solved | null {
  const { w, wall, goals } = level;
  const goal = new Set(goals);
  const dist = (b: number): number => {
    let m = Infinity;
    for (const g of goals) {
      const d = Math.abs((g % w) - (b % w)) + Math.abs(Math.floor(g / w) - Math.floor(b / w));
      if (d < m) m = d;
    }
    return m;
  };
  const est = (bs: number[]): number => bs.reduce((a, b) => a + dist(b), 0);
  const key = (p: number, bs: number[]): string => `${p}|${bs.join(',')}`;
  const sp: number[] = [level.player];
  const sb: number[][] = [level.boxes];
  const sg: number[] = [0];
  const parent: number[] = [-1];
  const step: string[] = [''];
  const best = new Map<string, number>([[key(level.player, level.boxes), 0]]);
  const heap: [number, number, number][] = [[est(level.boxes), 0, 0]];
  const less = (a: [number, number, number], b: [number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] < b[2])));
  const heapPush = (e: [number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i] as [number, number, number], heap[p] as [number, number, number])) break;
      const tmp = heap[i] as [number, number, number];
      heap[i] = heap[p] as [number, number, number];
      heap[p] = tmp;
      i = p;
    }
  };
  const heapPop = (): [number, number, number] => {
    const top = heap[0] as [number, number, number];
    const last = heap.pop() as [number, number, number];
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1] as [number, number, number], heap[c] as [number, number, number])) c++;
        if (!less(heap[c] as [number, number, number], heap[i] as [number, number, number])) break;
        const tmp = heap[i] as [number, number, number];
        heap[i] = heap[c] as [number, number, number];
        heap[c] = tmp;
        i = c;
      }
    }
    return top;
  };
  let expanded = 0;
  let pushes = 0;
  while (heap.length > 0 && expanded < maxStates) {
    const [, g, s] = heapPop();
    if (best.get(key(sp[s] as number, sb[s] as number[])) !== s) continue;
    const bs = sb[s] as number[];
    if (bs.every((b) => goal.has(b))) {
      let moves = '';
      for (let t = s; t > 0; t = parent[t] as number) moves = (step[t] as string) + moves;
      pushes = [...moves].filter((c) => c === c.toUpperCase()).length;
      return { pushes, moves };
    }
    expanded++;
    const p = sp[s] as number;
    for (const [dx, dy, letter] of DIRS) {
      const d = dy * w + dx;
      const q = p + d;
      if (wall[q]) continue;
      let nb = bs;
      let move = letter;
      const at = bs.indexOf(q);
      if (at >= 0) {
        if (wall[q + d] || bs.includes(q + d)) continue;
        nb = bs.slice();
        nb[at] = q + d;
        nb.sort((a, b) => a - b);
        move = letter.toUpperCase();
      }
      const k = key(q, nb);
      const seenIdx = best.get(k);
      if (seenIdx !== undefined && (sg[seenIdx] as number) <= g + 1) continue;
      const t = sp.length;
      sp.push(q);
      sb.push(nb);
      sg.push(g + 1);
      parent.push(s);
      step.push(move);
      best.set(k, t);
      heapPush([g + 1 + est(nb), g + 1, t]);
    }
  }
  return null;
}

interface Room {
  squares: number[];
  boxes: number[];
  goals: number[];
  done?: boolean;
}

/**
 * Split a level into rooms: cut the dead squares of the player's row (the
 * hallway: a box there reaches no goal); each remaining part holding boxes
 * is a room. Null when the level is no set of rooms.
 */
function roomsOf(level: Level): Room[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(level);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) if (!wall[i] && !live[i]) cut[i] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = (squares[i] as number) + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of boxes) rooms[part[b] as number]?.boxes.push(b);
  for (const g of goals) if (part[g] as number >= 0) rooms[part[g] as number]?.goals.push(g);
  if (goals.some((g) => part[g] as number < 0) ||
      rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

function solveLevel(level: Level): string {
  const rooms = roomsOf(level);
  if (rooms !== null) {
    let player = level.player;
    let moves = '';
    const done: Room[] = [];
    let ok = true;
    for (const room of rooms) {
      // Other rooms' boxes (not yet solved) also block: treat as walls.
      const wall = level.wall.slice();
      for (const other of rooms) {
        if (other === room) continue;
        for (const b of other.done ? other.goals : other.boxes) wall[b] = 1;
      }
      const sub: Level = {
        w: level.w, h: level.h, wall,
        goals: room.goals.slice().sort((a, b) => a - b),
        boxes: room.boxes.slice().sort((a, b) => a - b),
        player,
      };
      const solved = solvePushBfs(sub, BFS_STATES_PER_ROOM) ??
        solvePushAstar(sub, ASTAR_STATES_PER_ROOM);
      if (solved === null) {
        ok = false;
        break;
      }
      moves += solved.moves;
      player = endOf(level.w, player, solved.moves);
      room.done = true;
      done.push(room);
    }
    if (ok) return moves;
  }
  // Whole-level fallbacks, in order.
  const whole = solvePushBfs(level, BFS_STATES_PER_ROOM) ??
    solvePushAstar(level, ASTAR_STATES_PER_ROOM) ??
    solveMoveAstar(level, MOVE_ASTAR_STATES);
  return whole === null ? '' : whole.moves;
}

for (const id of readdirSync(INPUT).sort()) {
  const moves = solveLevel(parseLevel(readFileSync(join(INPUT, id, 'level.txt'), 'utf8')));
  mkdirSync(join(OUTPUT, id), { recursive: true });
  writeFileSync(join(OUTPUT, id, 'solution.txt'), `${moves}\n`);
}
