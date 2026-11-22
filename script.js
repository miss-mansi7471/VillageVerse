/* =====================================================================
   VillageVerse – A Tiny Living Village
   Vanilla JS simulation: 12 villagers with needs, memories, opinions,
   rumours that mutate, diaries generated from real events, day/night.
   ===================================================================== */
'use strict';
(() => {

/* ============================== CONFIG ============================== */
const T = 24, W = 44, H = 26;           // tile size & map size (tiles)
const WW = W * T, WH = H * T;           // world size in px
const MIN_PER_SEC = 4;                  // game minutes per real second at 1×
const WALK = 0.5;                       // tiles per game minute
const DAY = 1440;
const START_TIME = 6 * 60 + 20;         // Day 1, 06:20
const LINE = 7;                         // game minutes per dialogue line

const G = { GRASS: 0, ROAD: 1, WATER: 2, BRIDGE: 3, PLAZA: 4, SOIL: 5, SAND: 6, DOCK: 7, FLOWERS: 8 };
const COST = [2, 1, 99, 1, 1, 2.4, 2, 1, 2];

/* ============================== UTILS ============================== */
const rnd = Math.random;
const rand = (a, b) => a + rnd() * (b - a);
const randi = (a, b) => Math.floor(a + rnd() * (b - a + 1));
const pick = a => a[Math.floor(rnd() * a.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hpick(arr, seed) { // deterministic pick (stable diaries between re-renders)
  let h = Math.floor(Math.abs(seed)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h ^= h >>> 16;
  return arr[(h >>> 0) % arr.length];
}
function weighted(list) {
  let s = 0; for (const o of list) s += Math.max(0, o.w);
  if (s <= 0) return null;
  let r = rnd() * s;
  for (const o of list) { r -= Math.max(0, o.w); if (r <= 0) return o.v; }
  return list[list.length - 1].v;
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = n => String(n).padStart(2, '0');
const fmtTime = m => { m = Math.floor(m) % DAY; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
const $ = s => document.querySelector(s);

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(p, v) {
    const a = this.a; a.push([p, v]); let i = a.length - 1;
    while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}

/* ============================== WORLD DATA ============================== */
const tiles = new Uint8Array(W * H), solid = new Uint8Array(W * H), tileSeed = new Float32Array(W * H);
const idx = (x, y) => y * W + x;
const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const riverX = y => 30 + Math.round(Math.sin(y / 4));
const walkable = (x, y) => inB(x, y) && !solid[idx(x, y)] && tiles[idx(x, y)] !== G.WATER;

const MARKET = { x: 16, y: 3, w: 10, h: 7 }, SQUARE = { x: 16, y: 15, w: 7, h: 7 };
const FARM = { x: 1, y: 17, w: 8, h: 7 }, GROVE = { x: 2, y: 2, w: 5, h: 4 }, BEES = { x: 23, y: 20, w: 4, h: 4 };
const inRect = (x, y, r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

const PLACES = {
  bakery:  { x: 18, y: 5, name: 'the bakery stall', stall: true },
  cloth:   { x: 22, y: 5, name: 'the cloth stall', stall: true },
  goods:   { x: 18, y: 8, name: 'the spice stall', stall: true },
  candles: { x: 22, y: 8, name: 'the candle stall', stall: true },
  forge:   { x: 12, y: 7, name: 'the forge' },
  grove:   { x: 4, y: 4, name: 'the herb grove' },
  dock:    { x: 29, y: 19, name: 'the fishing dock' },
  farm:    { x: 5, y: 20, name: 'the farm' },
  library: { x: 24, y: 18, name: 'the library' },
  bees:    { x: 24, y: 21, name: 'the bee garden' },
  lumber:  { x: 40, y: 20, name: 'the lumber yard' },
  tea:     { x: 21, y: 17, name: 'the tea table in the square' },
};
const MARKET_SPOT = { x: 20, y: 6 };
const RELAX = [
  { x: 27, y: 7, name: 'the riverside bench' }, { x: 27, y: 17, name: 'the riverside bench' },
  { x: 33, y: 6, name: 'the east riverbank' }, { x: 4, y: 3, name: 'the herb grove' },
  { x: 20, y: 6, name: 'the market' }, { x: 23, y: 7, name: 'the market' },
  { x: 17, y: 16, name: 'the village square' }, { x: 21, y: 19, name: 'the village square' },
  { x: 17, y: 18, name: 'the fountain' }, { x: 25, y: 22, name: 'the bee garden' },
  { x: 31, y: 19, name: 'the dock' }, { x: 31, y: 12, name: 'the bridge' },
  { x: 36, y: 12, name: 'the east lane' }, { x: 9, y: 14, name: 'the farm fence' },
];
const SQUARE_SPOTS = [[17, 16], [21, 16], [17, 19], [20, 20], [22, 18], [16, 17], [19, 15], [20, 16], [18, 20], [21, 20]];
const PERFORM_SPOT = { x: 20, y: 19 };
const BONFIRE = { x: 17, y: 20 };

const HOUSES = [
  { name: 'Honeycomb Cottage', x: 1, y: 8, roof: '#c8553d', wall: '#f3dfb8' },
  { name: 'Forge House', x: 9, y: 8, roof: '#55606e', wall: '#dccdb2' },
  { name: 'Mossy Nook', x: 8, y: 2, roof: '#5e8c4a', wall: '#efe3c4' },
  { name: 'Riverside Shack', x: 35, y: 20, roof: '#3f8f8a', wall: '#d8c4a0' },
  { name: 'Ribbon House', x: 5, y: 8, roof: '#b5579b', wall: '#f7e6d0' },
  { name: 'Lantern Lodge', x: 39, y: 2, roof: '#a33b3b', wall: '#ecd9b5' },
  { name: 'Sunpatch Farmhouse', x: 10, y: 15, roof: '#d9a441', wall: '#f1e2c0' },
  { name: 'Inkwell House', x: 39, y: 7, roof: '#3d5a80', wall: '#e6dcc8' },
  { name: 'Bramble Cottage', x: 35, y: 15, roof: '#e07a8f', wall: '#fbe9d8' },
  { name: 'Oak Hollow', x: 39, y: 15, roof: '#8a5a35', wall: '#e3cfa8' },
  { name: 'Fiddle Loft', x: 10, y: 20, roof: '#4f7cac', wall: '#f0e0c8' },
  { name: 'Teapot Manor', x: 35, y: 2, roof: '#7b4b94', wall: '#f2e4d0' },
];

const props = [], trees = [], lamps = [], benches = [], waterTiles = [], fireflies = [];

/* ============================== ITEMS ============================== */
const ITEMS = { bread: '🍞', tools: '🔨', herbs: '🌿', fish: '🐟', cloth: '🧵', spices: '🧂', vegetables: '🥕', books: '📚', honey: '🍯', wood: '🪵', candles: '🕯️', tea: '🍵' };
const SING = { bread: 'loaf of bread', tools: 'tool', herbs: 'bundle of herbs', fish: 'fish', cloth: 'bolt of cloth', spices: 'jar of spices', vegetables: 'basket of vegetables', books: 'book', honey: 'jar of honey', wood: 'bundle of firewood', candles: 'candle', tea: 'tin of tea' };
const PLUR = { bread: 'loaves of bread', tools: 'tools', herbs: 'bundles of herbs', fish: 'fish', cloth: 'bolts of cloth', spices: 'jars of spices', vegetables: 'baskets of vegetables', books: 'books', honey: 'jars of honey', wood: 'bundles of firewood', candles: 'candles', tea: 'tins of tea' };
const qty = (n, it) => (n === 1 ? 'a ' + SING[it] : n + ' ' + PLUR[it]);
const FOODS = ['bread', 'fish', 'vegetables', 'honey'];
const MEAL_PHRASE = { bread: 'fresh bread', fish: 'grilled fish', vegetables: 'vegetable stew', honey: 'honey cakes' };
const PROD_NOUN = { bread: 'baking', tools: 'metalwork', herbs: 'herbal remedies', fish: 'fishing', cloth: 'sewing', spices: 'spice blends', vegetables: 'vegetables', books: 'library', honey: 'honey', wood: 'woodwork', candles: 'candles', tea: 'tea' };

/* ============================== VILLAGERS ============================== */
const DEFS = [
  { name: 'Mabel Thornbury', prof: 'Baker', icon: '🥖', personality: "Warm-hearted and generous — feeds the whole village and remembers everyone's favourite pastry.", tags: ['Warm', 'Generous', 'Early riser'], traits: { friendly: .9, gossip: .4, temper: .2, forgive: .9, greed: .1, generous: .9 }, voice: 'warm', wake: 5.5, bed: 21.5, produce: 'bread', wants: ['vegetables', 'honey', 'wood', 'fish'], work: 'bakery', verb: 'baking bread at my stall', complain: { say: 'the queue at your stall', tell: 'the queue at the bakery stall' }, look: { skin: '#f2c9a5', hair: '#7a4a2a', style: 'bun', shirt: '#e98a7a', pants: '#6b4a3a', acc: 'chef' } },
  { name: 'Bram Ironsides', prof: 'Blacksmith', icon: '⚒️', personality: 'Gruff and proud with a short fuse, but secretly soft for anyone who appreciates good craftsmanship.', tags: ['Gruff', 'Proud', 'Hot-tempered'], traits: { friendly: .35, gossip: .15, temper: .85, forgive: .35, greed: .45, generous: .3 }, voice: 'gruff', wake: 6, bed: 22, produce: 'tools', wants: ['fish', 'bread', 'wood'], work: 'forge', verb: 'hammering away at the forge', complain: { say: 'the racket from your forge', tell: 'the racket from the forge' }, look: { skin: '#d39a6a', hair: '#2a2420', style: 'short', beard: true, shirt: '#7d8b99', pants: '#3a3a44', acc: 'apron' } },
  { name: 'Wren Willowby', prof: 'Herbalist', icon: '🌿', personality: 'Shy and gentle; talks to plants more than people, and quietly notices everything.', tags: ['Shy', 'Gentle', 'Observant'], traits: { friendly: .45, gossip: .2, temper: .15, forgive: .85, greed: .1, generous: .75 }, voice: 'dreamy', wake: 6.5, bed: 21.5, produce: 'herbs', wants: ['honey', 'tea', 'books', 'bread'], work: 'grove', verb: 'gathering herbs in the grove', complain: { say: 'the weeds from your grove', tell: 'the weeds spreading from the herb grove' }, look: { skin: '#f5d6bd', hair: '#c4622d', style: 'long', shirt: '#7fae6a', pants: '#5a6b3a', acc: 'flowercrown' } },
  { name: 'Finn Marlow', prof: 'Fisher', icon: '🎣', personality: 'Easy-going joker who never takes anything seriously — except fishing.', tags: ['Laid-back', 'Funny', 'Night fisher'], traits: { friendly: .8, gossip: .55, temper: .3, forgive: .85, greed: .3, generous: .6 }, voice: 'witty', wake: 5, bed: 23.5, nightOwl: true, produce: 'fish', wants: ['bread', 'candles', 'tools', 'vegetables'], work: 'dock', verb: 'fishing off the dock', complain: { say: 'the fish smell at your stall', tell: 'the fish smell around the market' }, look: { skin: '#e0ac7e', hair: '#d9b35a', style: 'messy', shirt: '#3f7fb5', pants: '#4a5a6a', acc: 'buckethat' } },
  { name: 'Lila Featherstone', prof: 'Seamstress', icon: '🧵', personality: "Dramatic social butterfly who knows everyone's business — and tells it with flair.", tags: ['Dramatic', 'Gossipy', 'Charming'], traits: { friendly: .85, gossip: .95, temper: .55, forgive: .55, greed: .35, generous: .5 }, voice: 'dramatic', wake: 7.5, bed: 23, produce: 'cloth', wants: ['herbs', 'honey', 'candles', 'bread'], work: 'cloth', verb: 'sewing at my stall', complain: { say: 'your endless gossip', tell: 'all that endless gossip' }, look: { skin: '#f6d0b6', hair: '#f0c75e', style: 'long', shirt: '#c86bb0', pants: '#6a3a6a', acc: 'ribbon' } },
  { name: 'Oswin Pebble', prof: 'Merchant', icon: '💰', personality: 'Shrewd trader with an eye for profit; believes every friendship has a price tag.', tags: ['Shrewd', 'Greedy', 'Persuasive'], traits: { friendly: .55, gossip: .6, temper: .45, forgive: .3, greed: .95, generous: .1 }, voice: 'shrewd', wake: 6.5, bed: 22.5, produce: 'spices', wants: ['cloth', 'tools', 'vegetables', 'fish'], work: 'goods', verb: 'haggling at my spice stall', complain: { say: 'your outrageous prices', tell: 'those outrageous prices' }, look: { skin: '#eab88f', hair: '#5a3a22', style: 'short', mustache: true, shirt: '#5b3f8a', pants: '#2e2440', acc: 'tophat' } },
  { name: 'Hazel Brightwater', prof: 'Farmer', icon: '🌾', personality: 'Honest and hardworking; up before the roosters and says exactly what she thinks.', tags: ['Honest', 'Hardworking', 'Blunt'], traits: { friendly: .7, gossip: .3, temper: .45, forgive: .6, greed: .2, generous: .7 }, voice: 'earnest', wake: 5, bed: 21, produce: 'vegetables', wants: ['bread', 'tools', 'honey', 'fish'], work: 'farm', verb: 'tending the crops', complain: { say: 'the mud you leave on the road', tell: 'the mud all over the village road' }, look: { skin: '#c98e62', hair: '#3b2a1e', style: 'braid', shirt: '#d98c3a', pants: '#4a6a8a', acc: 'strawhat' } },
  { name: 'Tobias Quill', prof: 'Librarian', icon: '📚', personality: 'Curious bookworm, a little aloof; reads by candlelight long after everyone sleeps.', tags: ['Curious', 'Aloof', 'Night owl'], traits: { friendly: .35, gossip: .35, temper: .35, forgive: .55, greed: .3, generous: .4 }, voice: 'formal', wake: 8, bed: 24.5, nightOwl: true, produce: 'books', wants: ['candles', 'tea', 'bread', 'fish'], work: 'library', verb: 'cataloguing books at the library', complain: { say: 'your stuck-up attitude', tell: 'that stuck-up attitude' }, look: { skin: '#f0c8a8', hair: '#1f1f2a', style: 'short', shirt: '#3d5a80', pants: '#2a2a3a', acc: 'glasses' } },
  { name: 'Rosie Clementine', prof: 'Beekeeper', icon: '🐝', personality: 'Hopeless romantic who sees the best in everyone and secretly plays matchmaker.', tags: ['Romantic', 'Optimistic', 'Matchmaker'], traits: { friendly: .9, gossip: .6, temper: .15, forgive: .95, greed: .1, generous: .85 }, voice: 'cheerful', wake: 6, bed: 22, produce: 'honey', wants: ['cloth', 'wood', 'fish', 'bread'], work: 'bees', verb: 'tending my beehives', complain: { say: 'your bees buzzing round my door', tell: 'the bees buzzing round everyone' }, look: { skin: '#f7d5c0', hair: '#e2725b', style: 'pigtails', shirt: '#f2b134', pants: '#8a5a3a', acc: 'flower' } },
  { name: 'Gideon Ashby', prof: 'Carpenter', icon: '🪚', personality: 'Stubborn as an old oak, but fiercely loyal to the friends he trusts.', tags: ['Stubborn', 'Loyal', 'Blunt'], traits: { friendly: .5, gossip: .2, temper: .65, forgive: .25, greed: .35, generous: .55 }, voice: 'gruff', wake: 6, bed: 21.5, produce: 'wood', wants: ['tools', 'bread', 'fish', 'vegetables'], work: 'lumber', verb: 'chopping wood at the lumber yard', complain: { say: 'the sawdust you leave everywhere', tell: 'sawdust everywhere' }, look: { skin: '#b57a4f', hair: '#6b3e1e', style: 'short', beard: true, shirt: '#a13d2d', pants: '#4a3a2a', acc: 'bandana' } },
  { name: 'Pip Tumbleweed', prof: 'Candlemaker & Bard', icon: '🕯️', personality: 'Mischievous and full of energy — loves a prank, a song, and stirring the pot.', tags: ['Mischievous', 'Musical', 'Night owl'], traits: { friendly: .8, gossip: .8, temper: .4, forgive: .7, greed: .3, generous: .5 }, voice: 'cheeky', wake: 8.5, bed: 24.8, nightOwl: true, produce: 'candles', wants: ['honey', 'fish', 'spices', 'bread'], work: 'candles', verb: 'dipping candles at my stall', complain: { say: 'your late-night fiddling', tell: 'the late-night fiddling' }, look: { skin: '#f3cfa9', hair: '#b5553a', style: 'messy', shirt: '#2f9e8f', pants: '#5a3a6a', acc: 'feather' } },
  { name: 'Agatha Moss', prof: 'Retired Mayor & Tea Brewer', icon: '🍵', personality: "Wise, nosy elder who remembers everything and brews tea for anyone who'll listen.", tags: ['Wise', 'Nosy', 'Tea lover'], traits: { friendly: .6, gossip: .75, temper: .4, forgive: .6, greed: .2, generous: .6 }, voice: 'wise', wake: 5.5, bed: 21, produce: 'tea', wants: ['herbs', 'honey', 'books', 'bread'], work: 'tea', verb: 'brewing tea in the square', complain: { say: 'your meddling', tell: 'all the meddling' }, look: { skin: '#eec3a0', hair: '#d8d8d8', style: 'bun', shirt: '#6a4a8a', pants: '#3a2a4a', acc: 'shawl' } },
];
const PIP = 10;
const GENERIC_REASONS = [
  { say: 'the broken fence', tell: 'the broken fence' }, { say: 'that ladder you borrowed', tell: 'a borrowed ladder' },
  { say: 'the best spot by the river', tell: 'the best spot by the river' }, { say: 'the festival plans', tell: 'the festival plans' },
  { say: 'whose turn it is to sweep', tell: 'whose turn it was to sweep the square' }, { say: 'that spilled bucket', tell: 'a spilled bucket of paint' },
];
// preset relationships [a, b, opinion]
const PRESET = [[0, 6, 45], [1, 9, 42], [4, 11, 35], [8, 2, 40], [3, 10, 36], [7, 11, 26], [0, 8, 28], [3, 8, 22], [6, 9, 18],
  [5, 6, -32], [1, 10, -26], [9, 5, -20], [7, 10, -15], [4, 2, -12], [1, 4, -10]];

/* ============================== STATE ============================== */
const S = {
  time: START_TIME, running: true, speed: 1, selected: null, tab: 'log', subtab: 'overview', logFilter: 'all',
  conversations: [], rumours: [], nextRumourId: 1, pairCD: {}, pairTier: {}, minuteAcc: 0,
  stats: { talks: 0, trades: 0, args: 0, makeups: 0, gifts: 0, gossip: 0, mutations: 0 },
  today: { talks: 0, trades: 0, args: 0, makeups: 0, gossip: 0 },
  particles: [], logCount: 0,
};
const dayNum = () => Math.floor(S.time / DAY) + 1;
const minOfDay = () => S.time % DAY;
const hourNow = () => minOfDay() / 60;
const pkey = (a, b) => (a.id < b.id ? a.id * 100 + b.id : b.id * 100 + a.id);

const V = DEFS.map((d, i) => {
  const h = HOUSES[i];
  return {
    id: i, ...d, first: d.name.split(' ')[0], home: i,
    color: shade(d.look.shirt, -45),
    x: 0, y: 0, off: [rand(-4, 4), rand(-3, 4)], path: [], facing: 'down', walkPhase: 0,
    speedMul: i === 11 ? 0.75 : i === PIP ? 1.18 : rand(0.92, 1.08),
    needs: { hunger: rand(55, 80), energy: rand(70, 95), social: rand(45, 75), happiness: rand(55, 72) },
    state: 'sleeping', timer: 0, plan: null, inside: true, activity: `Sleeping at ${h.name}`,
    inv: { [d.produce]: 3, [pick(FOODS)]: 1 }, coins: randi(10, 22),
    op: {}, base: {}, note: {}, grudges: {}, memories: [], diary: [], rumours: [], flags: {},
    conv: null, workedAM: false, workedPM: false, ate: {}, sleepQ: 1, napUntil: 0,
    counts: { talks: 0, trades: 0, args: 0, gossip: 0 },
  };
});

/* ============================== MAP BUILDING ============================== */
function fillR(r, t) { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) tiles[idx(x, y)] = t; }
function block(x, y, w, h) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (inB(i, j)) solid[idx(i, j)] = 1; }
const roadish = t => t === G.ROAD || t === G.BRIDGE || t === G.PLAZA || t === G.DOCK;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function carve(sx, sy) {
  const s = idx(sx, sy);
  if (roadish(tiles[s]) && !(tiles[s] === G.DOCK)) return;
  const dist = new Float32Array(W * H).fill(Infinity), prev = new Int32Array(W * H).fill(-1);
  const heap = new Heap(); dist[s] = 0; heap.push(0, s);
  let found = -1;
  while (heap.size) {
    const [d, i] = heap.pop();
    if (d > dist[i]) continue;
    if (i !== s && roadish(tiles[i]) && tiles[i] !== G.DOCK) { found = i; break; }
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy; if (!inB(nx, ny)) continue;
      const j = idx(nx, ny); if (solid[j] || tiles[j] === G.WATER) continue;
      const c = roadish(tiles[j]) ? 1 : tiles[j] === G.SOIL ? 4 : 3;
      if (d + c < dist[j]) { dist[j] = d + c; prev[j] = i; heap.push(d + c, j); }
    }
  }
  if (found < 0) return;
  let i = prev[found];
  while (i >= 0) { const t = tiles[i]; if (t === G.GRASS || t === G.SAND || t === G.FLOWERS) tiles[i] = G.ROAD; i = prev[i]; }
}

function buildMap() {
  const mr = mulberry32(7331);
  for (let i = 0; i < W * H; i++) { tiles[i] = G.GRASS; tileSeed[i] = mr(); }
  // river + banks
  for (let y = 0; y < H; y++) { const cx = riverX(y); for (let x = cx - 2; x <= cx + 2; x++) tiles[idx(x, y)] = Math.abs(x - cx) <= 1 ? G.WATER : G.SAND; }
  fillR(GROVE, G.FLOWERS); fillR(BEES, G.FLOWERS);
  // roads
  for (let x = 0; x < W; x++) for (const y of [12, 13]) tiles[idx(x, y)] = tiles[idx(x, y)] === G.WATER ? G.BRIDGE : G.ROAD;
  for (let y = 0; y < H; y++) for (const x of [14, 15]) tiles[idx(x, y)] = G.ROAD;
  for (let y = 2; y <= 24; y++) tiles[idx(38, y)] = G.ROAD;
  fillR(MARKET, G.PLAZA); fillR(SQUARE, G.PLAZA);
  // farm
  for (let y = 18; y <= 22; y++) for (let x = 2; x <= 7; x++) tiles[idx(x, y)] = G.SOIL;
  for (let x = FARM.x; x < FARM.x + FARM.w; x++) { solid[idx(x, 17)] = 1; solid[idx(x, 23)] = 1; }
  for (let y = 17; y <= 23; y++) { solid[idx(1, y)] = 1; solid[idx(8, y)] = 1; }
  solid[idx(8, 20)] = 0; // gate
  props.push({ kind: 'fence', by: 17.5 });
  // dock
  const dcx = riverX(19); tiles[idx(dcx, 19)] = G.DOCK; tiles[idx(dcx + 1, 19)] = G.DOCK; PLACES.dock.x = dcx;
  // houses
  HOUSES.forEach((h, i) => { h.id = i; h.fx = h.x + 1; h.fy = h.y + 3; block(h.x, h.y, 3, 3); props.push({ kind: 'house', h, by: h.y + 3 }); });
  // buildings & props
  block(23, 15, 4, 3); props.push({ kind: 'library', x: 23, y: 15, by: 18 });
  const stalls = [
    { x: 17, y: 4, c1: '#e9604f', c2: '#fff4e0', goods: 'bread' }, { x: 21, y: 4, c1: '#b25fb0', c2: '#fff4e0', goods: 'cloth' },
    { x: 17, y: 7, c1: '#4d8f5a', c2: '#fff4e0', goods: 'spices' }, { x: 21, y: 7, c1: '#e2a23b', c2: '#fff4e0', goods: 'candles' }];
  for (const s of stalls) { block(s.x, s.y, 2, 1); props.push({ kind: 'stall', ...s, by: s.y + 1 }); }
  block(11, 5, 2, 2); props.push({ kind: 'forge', x: 11, y: 5, by: 7 });
  block(18, 17, 2, 2); props.push({ kind: 'fountain', x: 18, y: 17, by: 19 });
  block(24, 8, 1, 1); props.push({ kind: 'well', x: 24, y: 8, by: 9 });
  block(39, 21, 3, 2); props.push({ kind: 'logs', x: 39, y: 21, by: 23 });
  for (const [x, y] of [[23, 22], [26, 22]]) { block(x, y, 1, 1); props.push({ kind: 'hive', x, y, by: y + 1 }); }
  block(BONFIRE.x, BONFIRE.y, 1, 1); props.push({ kind: 'bonfire', x: BONFIRE.x, y: BONFIRE.y, by: BONFIRE.y + 1 });
  block(21, 16, 1, 1); props.push({ kind: 'teatable', x: 21, y: 16, by: 17 });
  for (const [x, y] of [[4, 11], [12, 11], [20, 11], [26, 11], [34, 11], [42, 11], [13, 16], [13, 22], [37, 14], [16, 15], [22, 15], [16, 21], [22, 21], [37, 6]]) {
    block(x, y, 1, 1); lamps.push({ x, y }); props.push({ kind: 'lamp', x, y, by: y + 1 });
  }
  const signs = [[16, 2, 'MARKET'], [23, 14, 'SQUARE'], [9, 18, 'FARM'], [7, 6, 'HERBS'], [32, 21, 'DOCK'], [42, 19, 'LUMBER']];
  for (const [x, y, text] of signs) { block(x, y, 1, 1); props.push({ kind: 'sign', x, y, text, by: y + 1 }); }
  for (const [x, y] of [[27, 7], [27, 17], [33, 6]]) benches.push({ x, y });

  // carve footpaths to every door / workplace / spot
  const entrances = [];
  HOUSES.forEach(h => entrances.push([h.fx, h.fy]));
  Object.values(PLACES).forEach(p => entrances.push([p.x, p.y]));
  RELAX.forEach(p => entrances.push([p.x, p.y]));
  entrances.push([9, 20], [dcx + 2, 19], [PERFORM_SPOT.x, PERFORM_SPOT.y]);
  for (const [x, y] of entrances) carve(x, y);

  // trees
  const reserved = new Set(entrances.map(([x, y]) => idx(x, y)));
  const isTree = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (tiles[i] !== G.GRASS || solid[i]) continue;
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy; if (!inB(nx, ny)) continue;
      const j = idx(nx, ny);
      if (reserved.has(j) || (tiles[j] !== G.GRASS && tiles[j] !== G.FLOWERS) || (solid[j] && !isTree[j])) { ok = false; break; }
    }
    if (!ok) continue;
    const d = Math.min(x, y, W - 1 - x, H - 1 - y);
    let p = d === 0 ? 0.8 : d === 1 ? 0.55 : d === 2 ? 0.22 : 0.05;
    if (x <= 8 && y <= 7) p = Math.max(p, 0.45);
    if (mr() < p) {
      solid[i] = 1; isTree[i] = 1;
      const r = mr();
      trees.push({ x, y, kind: r < 0.3 ? 'pine' : r < 0.42 ? 'fruit' : 'oak', s: mr(), by: y + 1 });
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (tiles[idx(x, y)] === G.WATER) waterTiles.push([x, y, tileSeed[idx(x, y)]]);
  for (let i = 0; i < 34; i++) {
    const t = trees.length ? trees[Math.floor(mr() * trees.length)] : { x: 20, y: 20 };
    const nearRiver = mr() < 0.4;
    fireflies.push({ x: nearRiver ? (riverX(Math.floor(mr() * H)) + (mr() < .5 ? -2.5 : 2.5)) * T : t.x * T + 12, y: nearRiver ? mr() * WH : t.y * T + 10, ph: mr() * 6.28, r: 8 + mr() * 18 });
  }
}

// Connectivity check (dev aid)
function verifyMap() {
  const seen = new Uint8Array(W * H), q = [idx(14, 12)]; seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (walkable(nx, ny) && !seen[idx(nx, ny)]) { seen[idx(nx, ny)] = 1; q.push(idx(nx, ny)); } }
  }
  const bad = [];
  HOUSES.forEach(h => { if (!seen[idx(h.fx, h.fy)]) bad.push(h.name); });
  Object.entries(PLACES).forEach(([k, p]) => { if (!seen[idx(p.x, p.y)]) bad.push(k); });
  if (bad.length) console.warn('[VillageVerse] unreachable:', bad.join(', '));
  return bad;
}

/* ============================== PATHFINDING ============================== */
function nearestWalkable(x, y) {
  for (let r = 1; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (walkable(x + dx, y + dy)) return [x + dx, y + dy];
  return null;
}
function findPath(sx, sy, tx, ty) {
  if (!walkable(tx, ty)) { const n = nearestWalkable(tx, ty); if (!n) return null; [tx, ty] = n; }
  if (!walkable(sx, sy)) { const n = nearestWalkable(sx, sy); if (n) [sx, sy] = n; }
  const s = idx(sx, sy), t = idx(tx, ty);
  if (s === t) return [[tx, ty]];
  const g = new Float32Array(W * H).fill(Infinity), prev = new Int32Array(W * H).fill(-1), closed = new Uint8Array(W * H);
  const heap = new Heap(); g[s] = 0; heap.push(0, s);
  while (heap.size) {
    const [, i] = heap.pop();
    if (i === t) break;
    if (closed[i]) continue; closed[i] = 1;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy; if (!walkable(nx, ny)) continue;
      const j = idx(nx, ny); if (closed[j]) continue;
      const ng = g[i] + COST[tiles[j]];
      if (ng < g[j]) { g[j] = ng; prev[j] = i; heap.push(ng + Math.abs(nx - tx) + Math.abs(ny - ty), j); }
    }
  }
  if (prev[t] < 0) return null;
  const path = []; let i = t;
  while (i !== s) { path.push([i % W, (i / W) | 0]); i = prev[i]; }
  return path.reverse();
}

/* ============================== HELPERS ============================== */
const tileOf = v => [clamp(Math.floor(v.x / T), 0, W - 1), clamp(Math.floor(v.y / T), 0, H - 1)];
const distPx = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function placeName(v) {
  const [tx, ty] = tileOf(v);
  if (inRect(tx, ty, MARKET)) return 'the market';
  if (inRect(tx, ty, SQUARE)) return 'the village square';
  if (inRect(tx, ty, FARM)) return 'the farm';
  if (inRect(tx, ty, GROVE)) return 'the herb grove';
  if (inRect(tx, ty, BEES)) return 'the bee garden';
  const t = tiles[idx(tx, ty)];
  if (t === G.BRIDGE) return 'the bridge';
  if (t === G.DOCK) return 'the dock';
  if (Math.abs(tx - riverX(ty)) <= 3) return 'the riverbank';
  for (const h of HOUSES) if (Math.abs(tx - h.fx) <= 2 && ty >= h.y && ty <= h.fy + 1) return h.name;
  if (tx >= 34) return 'the east lane';
  if (ty === 12 || ty === 13) return 'the main road';
  return 'the village lanes';
}
function nm(v) { return `<b class="vn" data-id="${v.id}" style="color:${v.color}">${esc(v.first)}</b>`; }
function mealName(h) { return h < 10.5 ? 'breakfast' : h < 15.5 ? 'lunch' : h < 21.5 ? 'dinner' : 'a late snack'; }
function relLabel(o) {
  if (o >= 60) return ['Best friend', 'best']; if (o >= 30) return ['Friend', 'friend']; if (o >= 10) return ['Friendly', 'friendly'];
  if (o > -10) return ['Neutral', 'neutral']; if (o > -30) return ['Wary', 'wary']; return ['Rival', 'rival'];
}
function tierOf(a, b) { const o = (a.op[b.id] + b.op[a.id]) / 2; return o >= 60 ? 3 : o >= 30 ? 2 : o <= -30 ? -1 : 0; }
function mood(v) {
  const h = v.needs.happiness;
  if (h >= 80) return { label: 'Joyful', emoji: '😄', color: '#4fbf5a' };
  if (h >= 62) return { label: 'Content', emoji: '🙂', color: '#9ccc4a' };
  if (h >= 45) return { label: 'Okay', emoji: '😐', color: '#f0c03c' };
  if (h >= 28) return { label: 'Grumpy', emoji: '😒', color: '#f08a3c' };
  return { label: 'Miserable', emoji: '😢', color: '#e0503c' };
}
const foodOf = v => FOODS.find(f => (v.inv[f] || 0) > 0);
function addInv(v, it, n) { v.inv[it] = (v.inv[it] || 0) + n; if (v.inv[it] <= 0) delete v.inv[it]; }
function isAvailable(v) { return !v.inside && !v.conv && ['walking', 'relaxing', 'idle', 'waiting', 'working', 'shopping'].includes(v.state); }
function pairReady(a, b, cd) { const t = S.pairCD[pkey(a, b)]; return t === undefined || S.time - t > cd; }
function knows(v, fid) { return v.rumours.some(k => k.fid === fid); }
function changeOp(a, b, d, note) { a.op[b.id] = clamp(a.op[b.id] + d, -100, 100); if (note) a.note[b.id] = note; }

function addMemory(v, kind, text, who, val, extra) {
  const m = { t: S.time, day: dayNum(), min: Math.floor(minOfDay()), kind, text, who: who == null ? null : who, val, ...(extra || {}) };
  v.memories.push(m);
  if (v.memories.length > 80) v.memories.shift();
  return m;
}

/* ============================== LOG / TOASTS ============================== */
const logList = () => $('#logList');
function logEvent(type, icon, html) {
  const li = document.createElement('li');
  li.className = `log-item t-${type}`;
  li.dataset.type = type;
  li.innerHTML = `<span class="lt">D${dayNum()} ${fmtTime(S.time)}</span><span class="li">${icon}</span><span class="lx">${html}</span>`;
  if (S.logFilter !== 'all' && S.logFilter !== type) li.style.display = 'none';
  const ul = logList(); if (!ul) return;
  ul.prepend(li);
  S.logCount++;
  while (ul.children.length > 260) ul.lastChild.remove();
}
function toast(icon, html) {
  const box = $('#toasts'); if (!box) return;
  const d = document.createElement('div');
  d.className = 'toast'; d.innerHTML = `<span class="ti">${icon}</span><span>${html}</span>`;
  box.appendChild(d);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => d.remove(), 4800);
}
function spawnParticles(x, y, type, n) {
  for (let i = 0; i < n; i++) S.particles.push({ x: x + rand(-6, 6), y: y + rand(-4, 2), vx: rand(-8, 8), vy: rand(-22, -12), life: 0, max: rand(1.2, 2), type });
}

/* ============================== RUMOURS ============================== */
const RUMOURS = {
  argument: { val: -3, t: ['{0} and {1} had a disagreement', '{0} and {1} had a shouting match', '{0} and {1} nearly came to blows', '{0} and {1} have sworn never to speak again'] },
  rude:     { val: -5, t: ['{0} was rude to {1}', '{0} insulted {1} in front of everyone', '{0} has a truly nasty temper', '{0} threw a tantrum and kicked over a cart'] },
  unfair:   { val: -5, t: ['{0} drove a hard bargain with {1}', '{0} overcharged {1} for {item}', '{0} swindled {1} out of their {item}', '{0} is a crook who cheats everyone'] },
  gift:     { val: 2, t: ['{0} gave {1} some {item}', '{0} is sweet on {1}', '{0} and {1} are secretly courting', '{0} and {1} are planning a secret wedding'] },
  kind:     { val: 4, t: ['{0} was kind to {1}', '{0} is the most generous soul in the village', '{0} gives away everything they own', '{0} is basically a saint'] },
  makeup:   { val: 2, t: ['{0} and {1} patched things up', '{0} apologised to {1}', '{0} begged {1} for forgiveness', '{0} wept and begged {1} for forgiveness on bended knee'] },
  night:    { val: -2, t: ['{0} was out walking late at night', '{0} sneaks around after dark', '{0} meets someone in secret at midnight', '{0} might belong to a secret society'] },
  lazy:     { val: -3, t: ['{0} overslept this morning', '{0} sleeps half the day away', "{0} hasn't done an honest day's work in weeks", '{0} is planning to quit working for good'] },
};
function rText(k) {
  return RUMOURS[k.kind].t[k.level]
    .replace('{0}', V[k.subj[0]].first).replace('{1}', k.subj[1] != null ? V[k.subj[1]].first : 'someone')
    .replace('{item}', k.item ? PLUR[k.item] : 'goods');
}
// One rumour "family" per real event; each witness gets first-hand knowledge.
function seedRumour(kind, subj, item, witnesses, howFn) {
  const ws = witnesses.filter(w => !w.rumours.some(k => k.kind === kind && k.subj[0] === subj[0] && S.time - k.t < 240));
  if (!ws.length) return null;
  const fam = { id: S.nextRumourId++, kind, subj: subj.slice(), item: item || null, t: S.time, day: dayNum(), origin: ws.map(w => w.id), how: howFn(ws[0]), versions: 0, hops: [], texts: {} };
  S.rumours.push(fam);
  for (const w of ws) learn(w, { fid: fam.id, kind, subj: subj.slice(), level: 0, item: item || null, from: null, t: S.time, ver: 0, believed: true });
  const k0 = { kind, subj, level: 0, item };
  fam.texts[rText(k0)] = ws.length;
  logEvent('rumour', '👀', `${ws.map(nm).join(' & ')} ${fam.how} — a new rumour is born: <span class="q">“${esc(rText(k0))}”</span>`);
  return fam;
}
function learn(v, k) { v.rumours.push(k); if (v.rumours.length > 30) v.rumours.shift(); }
function witnessesOf(a, b, r = 6) {
  return V.filter(w => w !== a && w !== b && !w.inside && w.state !== 'sleeping' && !w.conv && distPx(w, a) < r * T);
}
function pickRumourToTell(a, b) {
  const opts = [];
  for (const k of a.rumours) {
    if (knows(b, k.fid) || S.time - k.t > 3 * DAY || !k.believed) continue;
    const val = RUMOURS[k.kind].val;
    let w = k.level + 1;
    if (k.subj.includes(b.id)) w *= val < 0 ? 0.25 : (k.kind === 'makeup' || k.kind === 'argument') ? 0.03 : 0.8;
    if (k.subj.includes(a.id) && val < 0) w *= 0.1;
    if (val < 0 && k.subj.some(s => s !== a.id && a.op[s] > 50)) w *= 0.2;
    opts.push({ w, v: k });
  }
  return weighted(opts);
}

/* ============================== CONVERSATIONS ============================== */
function say(conv, who, text) { conv.lines.push({ s: who, text }); }

function compat(a, b) {
  const d = Math.abs(a.traits.friendly - b.traits.friendly) + Math.abs(a.traits.temper - b.traits.temper) + Math.abs(a.traits.gossip - b.traits.gossip);
  return 1 - d / 1.2; // roughly -1..1
}
function pickReason(a, b) {
  const unfair = a.memories.slice().reverse().find(m => m.who === b.id && (m.kind === 'trade_unfair' || m.kind === 'trade_declined'));
  if (unfair && rnd() < 0.6) return { say: 'that rotten deal you gave me', tell: `that unfair deal over ${PLUR[unfair.item] || 'goods'}` };
  const bad = a.rumours.find(k => k.believed && k.subj[0] === b.id && RUMOURS[k.kind].val < 0);
  if (bad && rnd() < 0.5) return { say: "what everyone's saying about you", tell: `the rumour that ${rText(bad)}` };
  return rnd() < 0.65 ? b.complain : pick(GENERIC_REASONS);
}
function findTrade(a, b) {
  const gives = Object.keys(a.inv).filter(x => a.inv[x] >= 2 && b.wants.includes(x) && (b.inv[x] || 0) < 3);
  if (!gives.length) return null;
  const x = pick(gives);
  const backs = Object.keys(b.inv).filter(y => y !== x && b.inv[y] >= 1 && a.wants.includes(y) && (a.inv[y] || 0) < 3);
  if (backs.length) return { kind: 'barter', x, y: pick(backs) };
  if (b.coins >= 4) return { kind: 'sale', x };
  return null;
}
function pickGift(a, b) {
  const items = Object.keys(a.inv).filter(i => a.inv[i] >= 1 && !(FOODS.includes(i) && a.inv[i] === 1 && a.needs.hunger < 50));
  if (!items.length) return null;
  const wanted = items.filter(i => b.wants.includes(i));
  return wanted.length ? pick(wanted) : pick(items);
}

function chooseTopic(a, b) {
  const oa = a.op[b.id], ob = b.op[a.id], o = (oa + ob) / 2;
  const g = a.grudges[b.id] || b.grudges[a.id];
  const opts = [];
  if (g) {
    const age = S.time - g.t;
    if (age > 240) opts.push({ w: 1.6 * (a.traits.forgive + b.traits.forgive) + age / DAY, v: { type: 'makeup', reason: g.reason } });
    opts.push({ w: age < 240 ? 1.2 : 0.35, v: { type: 'argue', reason: { say: g.reason, tell: g.reason }, renewed: true } });
    opts.push({ w: 0.8, v: { type: 'cold' } });
  }
  const r = pickRumourToTell(a, b);
  if (r) opts.push({ w: 0.6 + a.traits.gossip * 2.6, v: { type: 'gossip', k: r } });
  const tr = findTrade(a, b);
  if (tr && !g) opts.push({ w: 2.2 + a.traits.greed * 0.6, v: { type: 'trade', tr } });
  if (oa > 18 && !g) { const gi = pickGift(a, b); if (gi) opts.push({ w: a.traits.generous * 1.3 * (0.4 + oa / 60), v: { type: 'gift', item: gi } }); }
  if (o > 30 && !g) opts.push({ w: 1.0, v: { type: 'deep' } });
  if (oa > 10 && !g) opts.push({ w: 0.5, v: { type: 'compliment' } });
  if (!g) {
    const clash = (a.traits.temper + b.traits.temper) / 2;
    let w = o < -15 ? 0.7 + clash * 1.3 + (-o) / 50 : o < 15 ? clash * 0.3 * (1.2 - compat(a, b)) : clash * 0.05;
    if (a.rumours.some(k => k.believed && k.subj[0] === b.id && RUMOURS[k.kind].val < 0)) w += 0.6;
    if (a.needs.happiness < 35 || a.needs.hunger < 25) w += 0.25;
    opts.push({ w, v: { type: 'argue', reason: pickReason(a, b) } });
  }
  opts.push({ w: 1, v: { type: 'chat' } });
  return weighted(opts);
}

function startConversation(a, b, opts = {}) {
  let topic = null;
  const g = a.grudges[b.id] || b.grudges[a.id];
  if (opts.intent === 'makeup' && g) topic = { type: 'makeup', reason: g.reason };
  if (!topic) topic = chooseTopic(a, b);
  const conv = { a, b, lines: [], timer: 0, type: topic.type, icon: '💬' };
  for (const [v, o] of [[a, b], [b, a]]) {
    v.state = 'talking'; v.path = []; v.plan = null; v.conv = conv;
    v.activity = `Talking with ${o.first}`;
    v.facing = Math.abs(o.x - v.x) > Math.abs(o.y - v.y) ? (o.x > v.x ? 'right' : 'left') : (o.y > v.y ? 'down' : 'up');
    v.needs.social = clamp(v.needs.social + 16, 0, 100);
    v.counts.talks++;
  }
  const before = tierOf(a, b);
  (RESOLVE[topic.type] || RESOLVE.chat)(a, b, topic, conv);
  if (!conv.lines.length) say(conv, a, 'Hello!');
  conv.dur = conv.lines.length * LINE;
  S.conversations.push(conv);
  S.pairCD[pkey(a, b)] = S.time;
  S.stats.talks++; S.today.talks++;
  checkTier(a, b, before);
}
function endConversation(c) {
  for (const v of [c.a, c.b]) { v.conv = null; v.state = 'idle'; v.timer = 0; }
  S.conversations.splice(S.conversations.indexOf(c), 1);
}

function checkTier(a, b, before) {
  const k = pkey(a, b), now = tierOf(a, b), prev = S.pairTier[k] ?? before;
  if (now === prev) return;
  S.pairTier[k] = now;
  const A = nm(a), B = nm(b);
  if (now === 2 && prev < 2) { logEvent('milestone', '💛', `${A} and ${B} have become <b>friends</b>!`); toast('💛', `${esc(a.first)} and ${esc(b.first)} are now friends!`); memBoth(a, b, 'milestone', n => `I think ${n} and I are real friends now.`, 5); }
  else if (now === 3) { logEvent('milestone', '💖', `${A} and ${B} are now <b>best friends</b>!`); toast('💖', `${esc(a.first)} and ${esc(b.first)} are best friends!`); memBoth(a, b, 'milestone', n => `${n} has become my best friend.`, 7); }
  else if (now === -1) { logEvent('milestone', '⚔️', `${A} and ${B} are now <b>rivals</b>.`); toast('⚔️', `${esc(a.first)} and ${esc(b.first)} are now rivals!`); memBoth(a, b, 'milestone', n => `${n} and I are truly at odds now.`, -6); }
  else if (prev === -1 && now >= 0) { logEvent('milestone', '🕊️', `${A} and ${B} are <b>no longer rivals</b>.`); toast('🕊️', `${esc(a.first)} and ${esc(b.first)} buried the hatchet!`); }
  else if (prev >= 2 && now < 2) { logEvent('milestone', '💔', `${A} and ${B} have drifted apart.`); }
}
function memBoth(a, b, kind, fn, val) { addMemory(a, kind, fn(b.first), b.id, val); addMemory(b, kind, fn(a.first), a.id, val); }

const RESOLVE = {
  chat(a, b, t, c) {
    const topicMem = a.memories.slice().reverse().find(m => m.chat && m.who !== b.id && !m.chat.includes(b.first) && !m.text.includes(b.first) && S.time - m.t < 480);
    const h = hourNow();
    if (topicMem) {
      say(c, a, pick(['Guess what? I ', 'So, earlier I ', 'Today I ']) + topicMem.chat + '!');
    } else {
      say(c, a, h < 11 ? pick(['Lovely morning, isn\'t it?', 'Morning! Sleep well?', 'Early start today?']) : h < 17 ? pick(['Busy day?', 'Nice weather today!', `How's the ${PROD_NOUN[b.produce]} going?`]) : pick(['What a sunset!', 'Chilly evening, eh?', 'Long day, huh?']));
    }
    const d = compat(a, b) * 6 + rand(0, 4);
    const ob = b.op[a.id];
    say(c, b, ob > 25 ? pick(['Ha! Good for you!', 'Always nice to see you!', 'Tell me everything!']) : ob > -10 ? pick(['Oh, really?', 'Mm, I see.', 'Is that so?']) : pick(['Hmph. If you say so.', 'Right. Whatever.', '...Fascinating.']));
    changeOp(a, b, d, d >= 0 ? 'pleasant chat' : 'awkward chat');
    changeOp(b, a, d + rand(-1, 1), d >= 0 ? 'pleasant chat' : 'awkward chat');
    a.needs.happiness += d > 0 ? 2 : -1; b.needs.happiness += d > 0 ? 2 : -1;
    if (topicMem) {
      addMemory(a, 'chat', `I chatted with ${b.first} and told them I ${topicMem.chat}.`, b.id, d > 0 ? 1 : -1);
      addMemory(b, 'chat', `I chatted with ${a.first}, who told me they ${topicMem.chat}.`, a.id, d > 0 ? 1 : -1);
    } else {
      const txt = n => (d >= 0 ? `I had a pleasant chat with ${n}.` : `I made small talk with ${n}. It was a bit awkward.`);
      addMemory(a, 'chat', txt(b.first), b.id, d >= 0 ? 1 : -1);
      addMemory(b, 'chat', txt(a.first), a.id, d >= 0 ? 1 : -1);
    }
    logEvent('social', '💬', `${nm(a)} and ${nm(b)} chatted${topicMem ? ` — ${nm(a)} mentioned they ${esc(topicMem.chat)}` : ''}.`);
  },
  deep(a, b, t, c) {
    say(c, a, pick(['Can I tell you something?', 'Got a minute? I need to talk.', 'I was thinking about us...']));
    say(c, b, pick(['Of course. Always.', "I'm all ears.", 'What is it?']));
    say(c, a, pick(["I'm really glad we're friends.", 'You always make my day better.', 'Thanks for always listening.']));
    say(c, b, pick(['Me too. Truly.', 'Aww, you too!', "That's what friends are for."]));
    const d = rand(5, 10);
    changeOp(a, b, d, 'heart-to-heart'); changeOp(b, a, d, 'heart-to-heart');
    a.needs.happiness += 6; b.needs.happiness += 6;
    addMemory(a, 'deep', `I had a long heart-to-heart with ${b.first}.`, b.id, 4, { chat: `had a heart-to-heart with ${b.first}` });
    addMemory(b, 'deep', `${a.first} and I had a long heart-to-heart.`, a.id, 4, { chat: `had a heart-to-heart with ${a.first}` });
    spawnParticles((a.x + b.x) / 2, (a.y + b.y) / 2 - 20, 'heart', 4);
    logEvent('social', '💞', `${nm(a)} and ${nm(b)} had a heart-to-heart.`);
  },
  compliment(a, b, t, c) {
    const noun = PROD_NOUN[b.produce];
    say(c, a, pick([`Your ${noun} is the best around!`, `I keep hearing great things about your ${noun}.`, `Honestly, your ${noun} is wonderful.`]));
    say(c, b, b.traits.temper > .6 ? 'Hmph. ...Thanks.' : pick(['Aw, thank you!', 'You just made my day!', 'Oh stop, you!']));
    changeOp(b, a, 6, `complimented my ${noun}`); changeOp(a, b, 2);
    b.needs.happiness += 5;
    addMemory(b, 'compliment', `${a.first} complimented my ${noun}.`, a.id, 3, { chat: `got a compliment from ${a.first}` });
    addMemory(a, 'compliment', `I told ${b.first} how much I admire their ${noun}.`, b.id, 1);
    logEvent('social', '🌟', `${nm(a)} complimented ${nm(b)}'s ${esc(noun)}.`);
  },
  cold(a, b, t, c) {
    say(c, a, '...Hello.'); say(c, b, pick(['Hmph.', '...', 'Oh. It\'s you.']));
    changeOp(a, b, -1); changeOp(b, a, -1);
    addMemory(a, 'cold', `I crossed paths with ${b.first}. Awkward silence.`, b.id, -1);
    addMemory(b, 'cold', `I bumped into ${a.first}. We barely spoke.`, a.id, -1);
    logEvent('conflict', '🧊', `${nm(a)} and ${nm(b)} exchanged a frosty hello.`);
  },
  gossip(a, b, t, c) {
    const k = t.k, fam = S.rumours.find(f => f.id === k.fid);
    const nk = { fid: k.fid, kind: k.kind, subj: k.subj.slice(), level: k.level, item: k.item, from: a.id, t: S.time, ver: k.ver, believed: true };
    const old = rText(k);
    let mutated = false;
    const p = 0.12 + a.traits.gossip * 0.3 + a.traits.temper * 0.05;
    if (rnd() < p) {
      const opts = [];
      if (nk.level < 3) opts.push({ w: 3, v: 'exaggerate' });
      const enemies = V.filter(x => a.op[x.id] < -15 && !nk.subj.includes(x.id) && x !== a && x !== b);
      if (enemies.length && RUMOURS[nk.kind].val < 0) opts.push({ w: 1.2, v: 'blame' });
      if (nk.item) opts.push({ w: 0.8, v: 'item' });
      const m = weighted(opts);
      if (m === 'exaggerate') nk.level++;
      else if (m === 'blame') nk.subj[0] = pick(enemies).id;
      else if (m === 'item') nk.item = pick(Object.keys(ITEMS).filter(i => i !== nk.item));
      if (m) { mutated = true; fam.versions++; nk.ver = fam.versions; S.stats.mutations++; }
    }
    const text = rText(nk);
    const val = RUMOURS[nk.kind].val;
    say(c, a, pick(['Psst! Did you hear?', 'You will NOT believe this...', 'Between you and me...', 'Have you heard the news?']));
    say(c, a, `${text}!`);
    a.counts.gossip++; S.stats.gossip++; S.today.gossip++;
    changeOp(a, b, 1.5);
    if (nk.subj.includes(b.id)) {
      if (val < 0) {
        say(c, b, pick(["That's a lie!", 'Who said that?!', 'How DARE they!']));
        changeOp(b, a, -(8 + nk.level * 3), 'spread rumours about me');
        b.grudges[a.id] = { t: S.time, reason: 'the rumours being spread' };
        b.needs.happiness -= 8;
        addMemory(b, 'rumour_about_me', `${a.first} told me people are saying that ${text}! The nerve!`, a.id, -6, { fid: nk.fid });
        spawnParticles(b.x, b.y - 26, 'anger', 3);
      } else {
        say(c, b, pick(['Oh, stop it! *blushes*', 'Really? Hee hee.', 'Who told you that?!']));
        changeOp(b, a, 3);
        b.needs.happiness += 4;
        addMemory(b, 'rumour_about_me', `${a.first} told me people are saying that ${text}. How flattering!`, a.id, 3, { fid: nk.fid });
      }
      nk.believed = true;
    } else {
      const trust = b.op[a.id];
      const prior = nk.subj.reduce((s, id) => s + (id === b.id ? 0 : b.op[id]), 0) / nk.subj.length;
      const pB = clamp(0.55 + trust / 220 + (val < 0 ? -prior / 220 : prior / 300), 0.1, 0.95);
      nk.believed = rnd() < pB;
      if (nk.believed) {
        const mult = 1 + nk.level * 0.35;
        const two = ['argument', 'gift', 'makeup'].includes(nk.kind);
        nk.subj.forEach((id, i) => {
          if (id === b.id || id === a.id) return;
          if (i === 0 || two) changeOp(b, V[id], val * mult, `heard that ${text}`);
          else changeOp(b, V[id], 1.5);
        });
        say(c, b, val < 0 ? pick(['No way!', 'I knew it!', 'How scandalous!', 'Goodness me!']) : pick(['How sweet!', 'Good for them!', 'Aww!']));
      } else {
        say(c, b, pick(["I don't believe that.", 'Sounds like nonsense.', 'Hmm, are you sure?']));
        if (val < 0 && nk.subj.some(id => b.op[id] > 40)) changeOp(b, a, -3, 'spreads nonsense');
      }
      addMemory(b, 'gossip_heard', `${a.first} told me that ${text}.${nk.believed ? '' : " I'm not sure I believe it."}`, a.id, nk.believed ? (val < 0 ? -1 : 1) : 0, { fid: nk.fid, chat: `heard that ${text}` });
    }
    addMemory(a, 'gossip_told', `I told ${b.first} that ${text}.`, b.id, 1);
    learn(b, nk);
    fam.hops.push({ from: a.id, to: b.id, t: S.time, day: dayNum(), text, mutated });
    fam.texts[text] = (fam.texts[text] || 0) + 1;
    logEvent('rumour', '🗣️', `${nm(a)} told ${nm(b)}: <span class="q">“${esc(text)}”</span>${nk.believed ? '' : ' (not believed)'}${mutated ? `<span class="mut">🌀 The story changed! It was: “${esc(old)}”</span>` : ''}`);
    if (mutated) toast('🌀', `A rumour twisted: “${esc(text)}”`);
    spawnParticles(b.x, b.y - 26, nk.believed ? 'gasp' : 'doubt', 1);
  },
  trade(a, b, t, c) {
    const tr = t.tr, x = tr.x;
    const greedy = rnd() < a.traits.greed * 0.75;
    S.stats.trades++; S.today.trades++; a.counts.trades++; b.counts.trades++;
    if (tr.kind === 'barter') {
      const y = tr.y;
      const askN = greedy && b.inv[y] >= 2 ? 2 : 1;
      say(c, a, askN === 1 ? `Fancy a swap? My ${SING[x]} for your ${SING[y]}?` : `My ${SING[x]} for ${qty(2, y)}. It IS top quality.`);
      if (askN === 1 || rnd() < 0.3 + b.op[a.id] / 150 + (b.traits.greed < .4 ? .15 : 0)) {
        addInv(a, x, -1); addInv(b, x, 1); addInv(b, y, -askN); addInv(a, y, askN);
        if (askN === 1) {
          say(c, b, pick(['Deal!', "You've got yourself a trade!", 'Perfect, just what I needed!']));
          say(c, a, pick(['Pleasure doing business!', 'Wonderful!', 'Enjoy!']));
          changeOp(a, b, 4, 'fair trade'); changeOp(b, a, 4, 'fair trade');
          a.needs.happiness += 3; b.needs.happiness += 3;
          addMemory(a, 'trade_fair', `I traded ${qty(1, x)} with ${b.first} for ${qty(1, y)}. A fair deal!`, b.id, 3, { chat: `traded ${PLUR[x]} with ${b.first}`, item: x });
          addMemory(b, 'trade_fair', `I traded ${qty(1, y)} with ${a.first} for ${qty(1, x)}. A fair deal!`, a.id, 3, { chat: `traded ${PLUR[y]} with ${a.first}`, item: y });
          logEvent('trade', '🔁', `${nm(a)} traded ${ITEMS[x]} ${esc(SING[x])} with ${nm(b)} for ${ITEMS[y]} ${esc(SING[y])}. Fair and square.`);
          spawnParticles(a.x, a.y - 24, 'coin', 2); spawnParticles(b.x, b.y - 24, 'coin', 2);
        } else {
          say(c, b, pick(["Fine... but that's steep.", 'You drive a hard bargain.', 'Ugh. Deal, I suppose.']));
          changeOp(b, a, -7, 'overcharged me'); changeOp(a, b, 2);
          b.needs.happiness -= 4; a.needs.happiness += 4;
          addMemory(b, 'trade_unfair', `${a.first} made me give ${qty(2, y)} for just ${qty(1, x)}. What a rip-off!`, a.id, -5, { item: x });
          addMemory(a, 'trade_gain', `I got ${qty(2, y)} from ${b.first} for just ${qty(1, x)}. Excellent bargain!`, b.id, 3, { chat: `struck a great bargain with ${b.first}`, item: y });
          logEvent('trade', '💸', `${nm(a)} drove a hard bargain: ${ITEMS[x]} 1 ${esc(SING[x])} for ${ITEMS[y]} ${esc(qty(2, y))} from ${nm(b)}.`);
          seedRumour('unfair', [a.id, b.id], x, [b, ...witnessesOf(a, b, 5)].filter(w => w === b ? rnd() < 0.4 + b.traits.gossip * 0.6 : rnd() < 0.5), w => w === b ? `felt cheated by ${a.first}` : `saw ${a.first} overcharge ${b.first}`);
        }
      } else declined(a, b, x, c);
    } else {
      const price = greedy ? 6 : 3;
      say(c, a, `Want ${qty(1, x)}? Only ${price} coins.`);
      if (price === 3 || rnd() < 0.35 + b.op[a.id] / 150) {
        addInv(a, x, -1); addInv(b, x, 1); b.coins -= price; a.coins += price;
        say(c, b, price === 3 ? pick(['Sold!', "Here's your coins.", 'Lovely, thank you!']) : pick(['Pricey... but fine.', "Daylight robbery, but I'll take it."]));
        changeOp(a, b, price === 3 ? 3 : 1); changeOp(b, a, price === 3 ? 3 : -5, price === 3 ? 'sold me goods' : 'overcharged me');
        addMemory(a, 'sale', `I sold ${qty(1, x)} to ${b.first} for ${price} coins.`, b.id, 2, { chat: `sold ${PLUR[x]} to ${b.first}`, item: x });
        addMemory(b, price === 3 ? 'sale' : 'trade_unfair', `I bought ${qty(1, x)} from ${a.first} for ${price} coins.${price > 3 ? ' Far too expensive!' : ''}`, a.id, price === 3 ? 2 : -4, { item: x });
        logEvent('trade', '🪙', `${nm(b)} bought ${ITEMS[x]} ${esc(SING[x])} from ${nm(a)} for ${price} coins${price > 3 ? ' (overpriced!)' : ''}.`);
        spawnParticles(a.x, a.y - 24, 'coin', 3);
        if (price > 3) seedRumour('unfair', [a.id, b.id], x, [b].filter(() => rnd() < 0.3 + b.traits.gossip * 0.6), () => `felt overcharged by ${a.first}`);
      } else declined(a, b, x, c);
    }
  },
  gift(a, b, t, c) {
    const it = t.item;
    addInv(a, it, -1); addInv(b, it, 1);
    S.stats.gifts++;
    say(c, a, pick([`I brought you ${qty(1, it)}!`, `Here — ${qty(1, it)}, just for you.`, `I thought you might like ${qty(1, it)}.`]));
    say(c, b, b.wants.includes(it) ? pick(['Just what I needed! Thank you!', 'For me? You shouldn\'t have!']) : pick(['Oh! How thoughtful!', 'Thank you, really!']));
    changeOp(b, a, 10, 'gave me a gift'); changeOp(a, b, 3);
    b.needs.happiness += 8; a.needs.happiness += 4;
    addMemory(a, 'gift_given', `I gave ${b.first} ${qty(1, it)} as a gift.`, b.id, 4, { chat: `gave ${b.first} a little gift` });
    addMemory(b, 'gift_got', `${a.first} gave me ${qty(1, it)}!${b.wants.includes(it) ? ' Just what I wanted.' : ''}`, a.id, 6, { chat: `got a lovely gift from ${a.first}` });
    spawnParticles(b.x, b.y - 24, 'heart', 5);
    logEvent('social', '🎁', `${nm(a)} gave ${nm(b)} ${ITEMS[it]} ${esc(qty(1, it))} as a gift.`);
    const romantic = a.op[b.id] > 45;
    seedRumour(romantic ? 'gift' : 'kind', [a.id, b.id], it, witnessesOf(a, b, 6).filter(w => rnd() < 0.35 + w.traits.gossip * 0.6), w => `saw ${a.first} give ${b.first} a gift`);
  },
  argue(a, b, t, c) {
    const reason = t.reason || pickReason(a, b);
    const sev = 7 + (a.traits.temper + b.traits.temper) * 7 + rand(0, 5) + (t.renewed ? 3 : 0);
    say(c, a, t.renewed ? pick([`I'm still angry about ${reason.say}!`, `Don't think I've forgotten ${reason.say}!`]) : pick([`We need to talk about ${reason.say}.`, `I'm fed up with ${reason.say}!`, `Enough with ${reason.say}!`]));
    say(c, b, b.traits.temper > .6 ? pick(['Mind your own business!', 'Oh yeah? Says who?!', 'How dare you!']) : pick(["That's not fair!", 'Oh, here we go again...', "I didn't mean any harm!"]));
    say(c, a, pick(['Hmph!', 'Unbelievable!', 'Forget it!', "We're done here."]));
    changeOp(a, b, -sev * (0.7 + a.traits.temper * 0.5), `argued about ${reason.tell}`);
    changeOp(b, a, -sev * (0.7 + b.traits.temper * 0.5), `argued about ${reason.tell}`);
    a.needs.happiness -= 7; b.needs.happiness -= 7;
    a.grudges[b.id] = { t: S.time, reason: reason.tell }; b.grudges[a.id] = { t: S.time, reason: reason.tell };
    a.counts.args++; b.counts.args++; S.stats.args++; S.today.args++;
    addMemory(a, 'argue', `I argued with ${b.first} about ${reason.tell}.`, b.id, -6, { chat: `had a row with ${b.first}`, reason: reason.tell });
    addMemory(b, 'argue', `${a.first} picked a fight with me about ${reason.tell}.`, a.id, -6, { chat: `had a row with ${a.first}`, reason: reason.tell });
    spawnParticles(a.x, a.y - 26, 'anger', 3); spawnParticles(b.x, b.y - 26, 'anger', 3);
    logEvent('conflict', '⚡', `${nm(a)} and ${nm(b)} argued about ${esc(reason.tell)}!`);
    const place = placeName(a);
    const ws = witnessesOf(a, b, 6).filter(w => rnd() < 0.4 + w.traits.gossip * 0.6);
    ws.forEach(w => addMemory(w, 'witness', `I saw ${a.first} and ${b.first} arguing at ${place}.`, null, -1, { chat: `saw ${a.first} and ${b.first} arguing` }));
    seedRumour('argument', [a.id, b.id], null, ws, () => `saw ${a.first} and ${b.first} arguing at ${place}`);
    // the angrier party may badmouth the other
    const [hot, other] = a.traits.temper >= b.traits.temper ? [a, b] : [b, a];
    if (rnd() < hot.traits.gossip + 0.15) seedRumour('rude', [other.id, hot.id], null, [hot], () => `is telling everyone how rude ${other.first} was`);
  },
  makeup(a, b, t, c) {
    const reason = t.reason;
    const g = b.grudges[a.id] || a.grudges[b.id];
    const age = g ? S.time - g.t : DAY;
    say(c, a, pick([`I'm sorry about ${reason}.`, `Listen... I regret ${reason}.`, `Can we put ${reason} behind us?`]));
    const p = clamp(0.4 + b.traits.forgive * 0.5 + age / DAY * 0.25 + b.op[a.id] / 200, 0.1, 0.97);
    if (rnd() < p) {
      say(c, b, pick(["Let's put it behind us.", 'I was wrong too. Sorry.', 'Water under the bridge.']));
      say(c, a, pick(['Friends again?', 'Thank you. Really.', 'Hug it out?']));
      say(c, b, pick(['Friends again.', 'Come here, you!', 'Of course.']));
      const d1 = rand(15, 25), d2 = rand(15, 25);
      changeOp(a, b, d1, `made up after ${reason}`); changeOp(b, a, d2, `made up after ${reason}`);
      a.op[b.id] = Math.max(a.op[b.id], 4); b.op[a.id] = Math.max(b.op[a.id], 4);
      delete a.grudges[b.id]; delete b.grudges[a.id];
      a.needs.happiness += 10; b.needs.happiness += 10;
      S.stats.makeups++; S.today.makeups++;
      addMemory(a, 'makeup', `I apologised to ${b.first} about ${reason}, and we made up.`, b.id, 7, { chat: `made up with ${b.first}` });
      addMemory(b, 'makeup', `${a.first} apologised to me about ${reason}. We've made up.`, a.id, 7, { chat: `made up with ${a.first}` });
      spawnParticles((a.x + b.x) / 2, (a.y + b.y) / 2 - 22, 'heart', 6);
      logEvent('milestone', '🤝', `${nm(a)} apologised to ${nm(b)} about ${esc(reason)} — they made up!`);
      toast('🤝', `${esc(a.first)} and ${esc(b.first)} made up!`);
      seedRumour('makeup', [a.id, b.id], null, witnessesOf(a, b, 6).filter(w => rnd() < 0.3 + w.traits.gossip * 0.6), () => `saw ${a.first} and ${b.first} make up`);
    } else {
      say(c, b, pick(["Not yet. I'm still hurt.", "Sorry isn't enough.", 'I need more time.']));
      changeOp(a, b, -3, 'refused my apology');
      if (b.grudges[a.id]) b.grudges[a.id].t = S.time - 200;
      addMemory(a, 'makeup_refused', `I tried to apologise to ${b.first}, but ${b.first} wasn't ready to forgive me.`, b.id, -3);
      addMemory(b, 'makeup_refused', `${a.first} tried to apologise. I'm not ready to forgive yet.`, a.id, -1);
      logEvent('conflict', '🙅', `${nm(a)} tried to apologise to ${nm(b)}, but was turned away.`);
    }
  },
};
function declined(a, b, x, c) {
  say(c, b, pick(["That's robbery! No deal.", 'Not at that price!', 'Absolutely not.']));
  changeOp(b, a, -4, 'tried to overcharge me'); changeOp(a, b, -2, 'refused my offer');
  addMemory(b, 'trade_declined', `${a.first} tried to overcharge me for ${PLUR[x]}, so I refused.`, a.id, -3, { item: x });
  addMemory(a, 'trade_declined', `${b.first} refused my offer for ${PLUR[x]}. Stingy!`, b.id, -2, { item: x });
  logEvent('trade', '🚫', `${nm(b)} refused ${nm(a)}'s overpriced ${esc(PLUR[x])}.`);
}

/* ============================== BEHAVIOUR ============================== */
function plan(type, x, y, label, extra) { return Object.assign({ type, x, y, label }, extra || {}); }
function exitHouse(v) { const h = HOUSES[v.home]; v.inside = false; v.x = h.fx * T + T / 2 + v.off[0]; v.y = h.fy * T + T / 2 + v.off[1]; v.facing = 'down'; }
function goTo(v, tx, ty, p) {
  const h = HOUSES[v.home];
  v.plan = p;
  if (v.inside) { if (tx === h.fx && ty === h.fy) { startActivity(v); return; } exitHouse(v); }
  const [sx, sy] = tileOf(v);
  const path = findPath(sx, sy, tx, ty);
  if (!path) { v.path = []; v.state = 'waiting'; v.timer = 10; v.activity = 'Pondering what to do'; return; }
  v.path = path; v.state = 'walking'; v.activity = p.label;
}
function goHome(v, type, label) { const h = HOUSES[v.home]; goTo(v, h.fx, h.fy, plan(type, h.fx, h.fy, label)); }
function seek(v, t, intent, label) { const [x, y] = tileOf(t); goTo(v, x, y, plan('seek', x, y, label, { target: t.id, intent, repath: S.time })); }

function decide(v) {
  const h = hourNow(), hh = h < 4 ? h + 24 : h;
  if ((h >= 4 && h < v.wake) || hh >= v.bed) { goHome(v, 'sleep', 'Heading home to sleep'); return; }
  if (hh >= v.bed - 1) { goHome(v, 'home', 'Heading home for the evening'); return; }
  if (v.needs.energy < 12) { goHome(v, 'nap', 'Heading home for a nap'); return; }
  if (v.needs.hunger < 35) { foodPlan(v); return; }
  if (h < 10 && !v.ate.breakfast && v.needs.hunger < 85 && (v.inside || foodOf(v))) { foodPlan(v); return; }
  const w = PLACES[v.work];
  if ((h >= 8.5 && h < 12 && !v.workedAM) || (h >= 13 && h < 17 && !v.workedPM)) {
    goTo(v, w.x, w.y, plan('work', w.x, w.y, `Heading to ${w.name}`)); return;
  }
  if (h >= 12 && h < 14 && !v.ate.lunch && v.needs.hunger < 75) { foodPlan(v); return; }
  freeTime(v, h, hh);
}
function foodPlan(v) {
  const h = hourNow(), home = HOUSES[v.home];
  const food = foodOf(v);
  const [tx, ty] = tileOf(v);
  const nearHome = v.inside || Math.abs(tx - home.fx) + Math.abs(ty - home.fy) < 7;
  if (food) {
    if (nearHome || h >= 18) goHome(v, 'eat', 'Going home to eat');
    else startEating(v, food, false);
    return;
  }
  if (v.coins >= 3 && h >= 7 && h < 20) { goTo(v, MARKET_SPOT.x, MARKET_SPOT.y, plan('buyfood', MARKET_SPOT.x, MARKET_SPOT.y, 'Off to the market to buy food')); return; }
  goHome(v, 'eat', 'Going home for some porridge');
}
function freeTime(v, h, hh) {
  const w = PLACES[v.work];
  if (h < 19 && !w.stall && (v.inv[v.produce] || 0) >= 6) { goTo(v, MARKET_SPOT.x, MARKET_SPOT.y, plan('sell', MARKET_SPOT.x, MARKET_SPOT.y, `Taking ${PLUR[v.produce]} to sell at the market`)); return; }
  // try to make peace
  for (const id in v.grudges) {
    const g = v.grudges[id], t = V[id];
    if (S.time - g.t > 300 && !t.inside && t.state !== 'sleeping' && rnd() < v.traits.forgive * 0.5) { seek(v, t, 'makeup', `Looking for ${t.first} to apologise`); return; }
  }
  if (v.id === PIP && h >= 19 && h < 22.5) { goTo(v, PERFORM_SPOT.x, PERFORM_SPOT.y, plan('perform', PERFORM_SPOT.x, PERFORM_SPOT.y, 'Heading to the square to play music')); return; }
  if (v.nightOwl && hh >= 21) {
    if (v.id === 7) { const l = PLACES.library; goTo(v, l.x, l.y, plan('relax', l.x, l.y, 'Reading late at the library', { dur: 60, act: 'Reading by lamplight at the library' })); return; }
    if (v.id === 3 && rnd() < 0.6) { const d = PLACES.dock; goTo(v, d.x, d.y, plan('relax', d.x, d.y, 'Off for some night fishing', { dur: 55, act: 'Night fishing under the stars', fish: true })); return; }
    wander(v, 'Strolling under the stars'); return;
  }
  if (v.needs.social < 45) {
    const f = bestFriendOutside(v);
    if (f && rnd() < 0.6) { seek(v, f, 'social', `Looking for ${f.first}`); return; }
    goSquare(v); return;
  }
  const evening = h >= 18;
  const choice = weighted([
    { w: 0.7 + v.traits.friendly * 0.8 + (evening ? 1.2 : 0), v: 'square' },
    { w: 0.9, v: 'relax' },
    { w: 0.6, v: 'wander' },
    { w: h < 19 ? 0.6 : 0.1, v: 'market' },
    { w: 0.6 * v.traits.friendly, v: 'friend' },
  ]);
  if (choice === 'square') goSquare(v);
  else if (choice === 'relax') { const r = pick(RELAX); goTo(v, r.x, r.y, plan('relax', r.x, r.y, `Strolling to ${r.name}`, { dur: rand(30, 75), act: `Relaxing at ${r.name}` })); }
  else if (choice === 'market') goTo(v, randi(17, 24), pick([6, 9]), plan('relax', 0, 0, 'Browsing the market', { dur: rand(20, 45), act: 'Browsing the market stalls' }));
  else if (choice === 'friend') { const f = bestFriendOutside(v); if (f) seek(v, f, 'social', `Looking for ${f.first}`); else wander(v); }
  else wander(v);
}
function goSquare(v) {
  const [x, y] = pick(SQUARE_SPOTS);
  const ev = hourNow() >= 18.5;
  goTo(v, x, y, plan('relax', x, y, 'Heading to the village square', { dur: rand(35, 80), act: ev ? 'Warming up by the bonfire' : 'Hanging out in the village square' }));
}
function wander(v, act) {
  const [tx, ty] = tileOf(v);
  for (let i = 0; i < 12; i++) {
    const x = clamp(tx + randi(-9, 9), 0, W - 1), y = clamp(ty + randi(-7, 7), 0, H - 1);
    if (walkable(x, y)) { goTo(v, x, y, plan('wander', x, y, act || 'Going for a stroll', { act: act || 'Taking in the view' })); return; }
  }
  v.state = 'waiting'; v.timer = 10;
}
function bestFriendOutside(v) {
  const c = V.filter(o => o !== v && !o.inside && o.state !== 'sleeping' && v.op[o.id] > 10).sort((a, b) => v.op[b.id] - v.op[a.id]);
  return c[0] || null;
}

function startActivity(v) {
  const p = v.plan || plan('wander', 0, 0, '');
  const h = HOUSES[v.home];
  const enter = () => { v.inside = true; v.x = h.fx * T + T / 2; v.y = h.fy * T + T / 2; v.path = []; };
  switch (p.type) {
    case 'sleep': enter(); if (v.needs.hunger < 45) startEating(v, foodOf(v) || null, true); else startSleep(v); break;
    case 'home': {
      enter();
      const hh = hourNow() < 4 ? hourNow() + 24 : hourNow();
      if (v.needs.hunger < 65 && foodOf(v)) { startEating(v, foodOf(v), true); break; }
      if (v.needs.hunger < 50) { startEating(v, null, true); break; }
      v.state = 'home'; v.timer = Math.max(10, (v.bed - hh) * 60); v.activity = `Relaxing at ${h.name}`;
      break;
    }
    case 'nap': enter(); v.state = 'sleeping'; v.napUntil = S.time + rand(60, 110); v.sleepQ = 1; v.activity = `Napping at ${h.name}`; break;
    case 'eat': enter(); startEating(v, foodOf(v) || null, true); break;
    case 'buyfood': {
      v.coins -= 3; const it = pick(FOODS);
      if (v.coins >= 8) { const extra = pick(FOODS); v.coins -= 3; addInv(v, extra, 1); }
      v.state = 'eating'; v.timer = 25; v.eat = { item: it, bought: true }; v.activity = `Eating ${MEAL_PHRASE[it]} at the market`;
      break;
    }
    case 'work': {
      const w = PLACES[v.work], end = hourNow() < 12.5 ? 12 * 60 : 17 * 60;
      v.state = 'working'; v.timer = clamp(end - minOfDay(), 30, 230) * rand(0.8, 1); v.activity = cap(v.verb.replace('my ', 'their '));
      v.facing = w.stall ? 'up' : 'down';
      break;
    }
    case 'sell': {
      const n = (v.inv[v.produce] || 0) - 3;
      if (n > 0) {
        v.coins += n * 2; addInv(v, v.produce, -n);
        addMemory(v, 'sale', `I sold ${qty(n, v.produce)} at the market for ${n * 2} coins.`, null, 2, { chat: `sold ${PLUR[v.produce]} at the market` });
        logEvent('trade', '🛒', `${nm(v)} sold ${ITEMS[v.produce]} ${esc(qty(n, v.produce))} at the market for ${n * 2} coins.`);
      }
      v.state = 'shopping'; v.timer = 15; v.activity = 'Selling goods at the market';
      break;
    }
    case 'perform': v.state = 'performing'; v.timer = Math.max(20, 22.5 * 60 - minOfDay()); v.activity = 'Playing the fiddle at the square'; v.facing = 'down'; break;
    case 'relax': v.state = 'relaxing'; v.timer = p.dur || 40; v.activity = p.act || 'Relaxing'; break;
    case 'seek': v.state = 'relaxing'; v.timer = 10; v.activity = 'Looking around'; break;
    default: v.state = 'relaxing'; v.timer = rand(6, 20); v.activity = p.act || 'Taking in the view';
  }
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function startEating(v, item, atHome) {
  if (item) addInv(v, item, -1);
  v.state = 'eating'; v.timer = 25; v.eat = { item, atHome };
  v.activity = item ? `Eating ${MEAL_PHRASE[item]}${atHome ? ' at home' : ''}` : 'Eating plain porridge at home';
}
function startSleep(v) {
  v.state = 'sleeping'; v.napUntil = 0;
  v.sleepQ = clamp(rand(0.65, 1.15) + (v.needs.happiness - 50) / 250, 0.45, 1.2);
  v.activity = `Sleeping at ${HOUSES[v.home].name}`;
}
function finishState(v) {
  const h = hourNow();
  switch (v.state) {
    case 'working': {
      const n = randi(2, 3); addInv(v, v.produce, n);
      if (h < 12.6) v.workedAM = true; else v.workedPM = true;
      addMemory(v, 'work', `I spent the ${h < 12.6 ? 'morning' : 'afternoon'} ${v.verb} and made ${qty(n, v.produce)}.`, null, 1, { chat: `made ${qty(n, v.produce)} at ${PLACES[v.work].name}` });
      v.needs.happiness += 2;
      if (PLACES[v.work].stall && v.inv[v.produce] > 4) { const s = v.inv[v.produce] - 4; v.coins += s * 2; addInv(v, v.produce, -s); }
      break;
    }
    case 'eating': {
      const e = v.eat || {}; const meal = mealName(h);
      v.needs.hunger = clamp(v.needs.hunger + (e.item ? 55 : 42), 0, 100);
      v.needs.happiness += e.item ? 4 : -1;
      if (meal === 'breakfast') v.ate.breakfast = true; else if (meal === 'lunch') v.ate.lunch = true;
      const text = e.bought ? `I bought ${MEAL_PHRASE[e.item]} at the market for ${meal}.` : e.item ? `I had ${MEAL_PHRASE[e.item]} for ${meal}.` : `I had plain porridge for ${meal}. Again.`;
      addMemory(v, 'meal', text, null, e.item ? 1 : -1);
      if (v.inside) {
        const hh = h < 4 ? h + 24 : h;
        if (hh >= v.bed - 1.2) { v.state = 'home'; v.timer = Math.max(10, (v.bed - hh) * 60); v.activity = `Relaxing at ${HOUSES[v.home].name}`; return; }
      }
      break;
    }
    case 'home': startSleep(v); return;
    case 'relaxing':
      if (v.plan && v.plan.fish) { addInv(v, 'fish', 1); addMemory(v, 'work', 'I went night fishing under the stars and caught a fish.', null, 2, { chat: 'went night fishing' }); }
      break;
    case 'performing':
      addMemory(v, 'perform', 'I played the fiddle at the square tonight.', null, 3, { chat: 'played music at the square' });
      break;
  }
  v.state = 'idle'; v.plan = null;
}
function updateSleep(v) {
  if (v.napUntil) { if (S.time >= v.napUntil) { v.napUntil = 0; v.state = 'idle'; } return; }
  const h = hourNow();
  if (h >= v.wake && h < 15) {
    const late = h - v.wake;
    if (v.needs.energy >= 50 || late > 2.5) {
      if (late > 1.1) { addMemory(v, 'overslept', `I overslept this morning and didn't get up until ${fmtTime(S.time)}!`, null, -3); v.needs.happiness -= 4; }
      else if (v.sleepQ < 0.6) addMemory(v, 'slept', 'I tossed and turned all night.', null, -1);
      v.state = 'idle'; v.activity = 'Just woke up';
    }
  }
}
function updateNeeds(v, dm) {
  const n = v.needs;
  if (v.state === 'sleeping') { n.energy += dm * 100 / (7 * 60) * (v.napUntil ? 1 : v.sleepQ); n.hunger -= dm * 0.03; }
  else {
    n.energy -= dm * 100 / (19 * 60) * (v.state === 'working' ? 1.15 : 1);
    n.hunger -= dm * 100 / (10 * 60);
    if (v.state !== 'talking') n.social -= dm * 100 / (9 * 60) * (0.5 + v.traits.friendly * 0.8) * (v.inside ? 0.6 : 1);
    else n.social += dm * 1.2;
  }
  n.energy = clamp(n.energy, 0, 100); n.hunger = clamp(n.hunger, 0, 100); n.social = clamp(n.social, 0, 100);
  const target = 18 + (n.hunger + n.energy + n.social) / 3 * 0.55 + v.traits.friendly * 14;
  n.happiness = clamp(n.happiness + (target - n.happiness) * Math.min(1, dm * 0.004), 0, 100);
}
function updateVillager(v, dm) {
  switch (v.state) {
    case 'talking': return;
    case 'walking':
      if (v.plan && v.plan.type === 'seek' && handleSeek(v)) return;
      if (moveAlong(v, dm)) startActivity(v);
      return;
    case 'sleeping': updateSleep(v); return;
    case 'idle': decide(v); return;
    default:
      v.timer -= dm;
      if (v.state === 'working' && (v.needs.hunger < 20 || v.needs.energy < 10)) v.timer = 0;
      if (v.timer <= 0) finishState(v);
  }
}
function handleSeek(v) {
  const t = V[v.plan.target];
  if (!t || t.inside || t.state === 'sleeping') { v.path = []; v.plan = null; v.state = 'idle'; return true; }
  if (distPx(v, t) < T * 1.5 && isAvailable(t) && pairReady(v, t, 45)) { startConversation(v, t, { intent: v.plan.intent }); return true; }
  if (S.time - v.plan.repath > 12) {
    v.plan.repath = S.time;
    const [x, y] = tileOf(t);
    if (Math.abs(x - v.plan.x) + Math.abs(y - v.plan.y) > 2) {
      const p = findPath(...tileOf(v), x, y);
      if (p) { v.path = p; v.plan.x = x; v.plan.y = y; }
    }
  }
  return false;
}
function moveAlong(v, dm) {
  let budget = WALK * T * dm * v.speedMul;
  while (budget > 0 && v.path.length) {
    const [tx, ty] = v.path[0];
    const px = tx * T + T / 2 + v.off[0], py = ty * T + T / 2 + v.off[1];
    const dx = px - v.x, dy = py - v.y, d = Math.hypot(dx, dy);
    if (d > 0.01) { if (Math.abs(dx) > Math.abs(dy)) v.facing = dx > 0 ? 'right' : 'left'; else v.facing = dy > 0 ? 'down' : 'up'; }
    if (d <= budget) { v.x = px; v.y = py; budget -= d; v.path.shift(); v.walkPhase += d * 0.35; }
    else { v.x += dx / d * budget; v.y += dy / d * budget; v.walkPhase += budget * 0.35; budget = 0; }
  }
  return v.path.length === 0;
}

/* ============================== WORLD TICKS ============================== */
function checkEncounters() {
  for (let i = 0; i < V.length; i++) {
    const a = V[i];
    for (let j = i + 1; j < V.length; j++) {
      if (!isAvailable(a)) break;
      const b = V[j]; if (!isAvailable(b)) continue;
      if (distPx(a, b) > T * 1.6) continue;
      if (!pairReady(a, b, 100)) continue;
      let p = 0.3 + (100 - a.needs.social) / 250 + (100 - b.needs.social) / 250 + (a.op[b.id] + b.op[a.id]) / 600;
      if (a.state === 'working' || b.state === 'working') p *= 0.4;
      if (rnd() < p) { if (rnd() < 0.5) startConversation(a, b); else startConversation(b, a); }
      else S.pairCD[pkey(a, b)] = S.time - 90; // try again in ~30 min
    }
  }
}
function witnessTick() {
  const h = hourNow(), d = dayNum();
  for (const v of V) {
    if (v.inside || v.state === 'sleeping') continue;
    for (const hs of HOUSES) {
      const o = V[hs.id]; if (o === v) continue;
      const dx = Math.abs(v.x / T - hs.fx), dy = Math.abs(v.y / T - (hs.y + 2));
      if (dx > 4 || dy > 4) continue;
      // Seen out late at night from a window
      if ((h >= 22.3 || h < 4.5) && o.inside && o.state === 'home') {
        const key = `night-${v.id}-${d}`;
        if (!o.flags[key] && rnd() < 0.5) {
          o.flags[key] = 1;
          addMemory(o, 'witness', `I spotted ${v.first} wandering past my window late at night. Curious...`, v.id, 0, { chat: `spotted ${v.first} out late at night` });
          seedRumour('night', [v.id], null, [o], () => `spotted ${v.first} outside ${hs.name} late at night`);
        }
      }
      // Still asleep long after their usual hour
      if (o.state === 'sleeping' && !o.napUntil && h > o.wake + 1.3 && h < 12) {
        const key = `lazy-${o.id}-${d}`;
        if (!v.flags[key]) {
          v.flags[key] = 1;
          addMemory(v, 'witness', `I walked past ${hs.name} at ${fmtTime(S.time)} and ${o.first} was still asleep!`, o.id, 0, { chat: `noticed ${o.first} sleeping in` });
          seedRumour('lazy', [o.id], null, [v], () => `noticed ${o.first} was still asleep at ${fmtTime(S.time)}`);
        }
      }
    }
  }
}
function musicTick() {
  const pip = V[PIP];
  if (pip.state !== 'performing') return;
  if (rnd() < 0.5) spawnParticles(pip.x + rand(-4, 4), pip.y - 22, 'note', 1);
  const d = dayNum();
  for (const l of V) {
    if (l === pip || l.inside || l.state === 'sleeping' || distPx(l, pip) > 5 * T) continue;
    const key = `music-${d}`;
    if (l.flags[key]) continue;
    l.flags[key] = 1;
    if (l.op[PIP] >= -10) {
      l.needs.happiness += 6; changeOp(l, pip, 3, 'played lovely music');
      addMemory(l, 'music', `I listened to Pip play the fiddle at the square. Lovely tunes!`, PIP, 3, { chat: 'heard Pip play at the square' });
      logEvent('social', '🎻', `${nm(l)} stopped to enjoy ${nm(pip)}'s fiddle music.`);
    } else {
      l.needs.happiness -= 3; changeOp(l, pip, -3, 'makes a racket');
      addMemory(l, 'music', `Pip's screeching fiddle at the square gave me a headache.`, PIP, -3);
      logEvent('conflict', '🙉', `${nm(l)} grumbled about ${nm(pip)}'s fiddling.`);
    }
  }
}
function minuteTick() {
  checkEncounters();
  witnessTick();
  musicTick();
}
function endOfDay(d) {
  for (const v of V) {
    v.diary.unshift({ day: d, html: composeDiary(v, d, false), mood: mood(v).emoji });
    v.workedAM = false; v.workedPM = false; v.ate = {};
    for (const o of V) if (o !== v) v.op[o.id] += (v.base[o.id] - v.op[o.id]) * 0.03; // slow drift
    for (const k in v.flags) if (!k.endsWith('-' + (d + 1)) && !k.endsWith('-' + d)) delete v.flags[k];
  }
  logEvent('system', '📔', `Day ${d} is over. Every villager wrote a diary entry about it. Good morning, Day ${d + 1}!`);
  toast('📔', `Day ${d} ends — new diary entries written!`);
  S.today = { talks: 0, trades: 0, args: 0, makeups: 0, gossip: 0 };
}

function simStep(dm) {
  const prevDay = Math.floor(S.time / DAY);
  S.time += dm;
  if (Math.floor(S.time / DAY) > prevDay) endOfDay(prevDay + 1);
  for (const v of V) updateNeeds(v, dm);
  for (const c of S.conversations.slice()) { c.timer += dm; if (c.timer >= c.dur) endConversation(c); }
  for (const v of V) updateVillager(v, dm);
  S.minuteAcc += dm;
  while (S.minuteAcc >= 1) { S.minuteAcc -= 1; minuteTick(); }
}

/* ============================== DIARIES ============================== */
const VOICES = {
  warm: { good: ['Dear diary, what a lovely day it has been.', 'Dear diary, my heart feels full tonight.'], ok: ['Dear diary, a gentle, ordinary sort of day.', "Dear diary, nothing grand today, but that's alright."], bad: ["Dear diary, today was harder than I'd like.", 'Dear diary, I could use a warm bun and a hug after today.'], pos: ['How lovely.', 'That warmed my heart.', 'Such a treat!'], neg: ['It left me a bit sad.', 'My heart sank a little.', 'Oh dear.'], sign: 'With love, {me}' },
  gruff: { good: ["Decent day. Won't complain.", "Good day. Don't tell anyone I said that."], ok: ['Another day. Nothing special.', "Day's done. That's that."], bad: ['Rotten day.', 'Bah. What a day.'], pos: ['Not bad.', 'Fair enough.', "I'll allow it."], neg: ['Typical.', 'Bah.', "Should've stayed in."], sign: '— {me}' },
  dreamy: { good: ['Dear diary, today shimmered like dew on clover.', 'Dear diary, the whole village felt soft and golden today.'], ok: ['Dear diary, a quiet day, like a leaf drifting downstream.', 'Dear diary, today passed gently, the way clouds do.'], bad: ["Dear diary, today felt like a storm cloud I couldn't step out from under.", 'Dear diary, my thoughts are tangled like brambles tonight.'], pos: ['Like sunlight through leaves.', 'My heart hummed.', 'The herbs would approve.'], neg: ['I wanted to hide among the ferns.', 'It stung like nettles.', 'I feel a little wilted.'], sign: '— {me}, by candlelight' },
  witty: { good: ['Diary! Today was a catch and a half.', 'Great day. Even the fish were smiling.'], ok: ['Diary, today was... a day. Things happened. Probably.', "Not much to report. The river's still wet."], bad: ['Diary, today was the one that got away.', 'Well, today sank like a stone.'], pos: ['Ha!', 'Reel-y good stuff.', "Can't complain, won't complain."], neg: ['Well, that stank worse than old bait.', 'Oof.', 'Not my finest hour.'], sign: '— {me}, still the best fisher around' },
  dramatic: { good: ['Darling diary, today was an absolute TRIUMPH!', 'Oh diary, what a dazzling, glittering day!'], ok: ['Diary, today was tolerable. Barely a scandal.', 'A dull day, diary. Positively drab.'], bad: ['Diary, today was a TRAGEDY of the highest order.', 'Oh, the drama, diary. The sheer drama!'], pos: ['Simply MAGNIFICENT!', 'I nearly swooned!', 'Divine!'], neg: ['I shall never recover!', 'The horror!', 'Utterly scandalous!'], sign: 'Forever fabulous, {me}' },
  shrewd: { good: ['Ledger of the day: a profitable one.', "Today's accounts balance nicely in my favour."], ok: ['Ledger of the day: break-even.', 'An unremarkable day for business.'], bad: ['Ledger of the day: losses all round.', "A poor return on today, I'm afraid."], pos: ['A sound investment.', 'Most profitable.', 'Excellent value.'], neg: ['A bad bargain.', 'That cost me.', 'Poor returns.'], sign: '— {me}, merchant' },
  earnest: { good: ['Good honest day today.', 'Today went right, start to finish.'], ok: ['Plain sort of day. Work got done.', "Nothing fancy today, and that's fine."], bad: ['Today was a hard row to hoe.', "Rough day, I won't lie."], pos: ["That's how it should be.", 'Honest and good.', 'Glad of it.'], neg: ["That wasn't right.", "Hurt more than I'd admit.", 'Sour as unripe apples.'], sign: '— {me}' },
  formal: { good: ['Journal entry. Today proved unexpectedly agreeable.', 'Journal entry. A most satisfactory day.'], ok: ['Journal entry. Little of note transpired.', 'Journal entry. An ordinary day, duly recorded.'], bad: ['Journal entry. A regrettable day, all things considered.', 'Journal entry. Today tested my patience considerably.'], pos: ['Most satisfactory.', 'Duly appreciated.', 'Noted with pleasure.'], neg: ['Deeply regrettable.', 'Most vexing.', 'I shall note this for future reference.'], sign: '— {me}, Librarian' },
  cheerful: { good: ['Dear diary!! Today was SO sweet, like fresh honey!', 'Dear diary, love is in the air — and so are my bees!'], ok: ['Dear diary, a buzzy little day!', 'Dear diary, nothing big today, but the flowers were pretty!'], bad: ['Dear diary, today was a bit of a sticky mess.', 'Dear diary, even my bees seemed sad today.'], pos: ['How sweet!', 'My heart is buzzing!', 'Adorable!'], neg: ['Poor thing...', 'That made me sniffle.', 'Not very sweet at all.'], sign: 'Hugs, {me} ♥' },
  cheeky: { good: ['Diary! Today was brilliant, absolutely brilliant!', 'What a day, diary — worth writing a song about!'], ok: ['Diary, today needed more mischief.', 'Bit boring today. Must fix that tomorrow.'], bad: ['Diary, today hit a sour note.', 'Today was a flat tune, diary.'], pos: ['Ha! Brilliant!', 'Wonderful!', "That's going in a song."], neg: ['Ugh, sour note.', 'Booo.', 'Not funny. Well, a little funny.'], sign: '— {me} ♪' },
  wise: { good: ['Dear diary, a fine day. The village is in good spirits.', 'Dear diary, days like this remind me why I love this village.'], ok: ['Dear diary, the village turns as it always has.', 'Dear diary, a quiet day. I watched, as I do.'], bad: ['Dear diary, troubled times in our little village.', 'Dear diary, I worry about these young folk.'], pos: ['As it should be.', 'Lovely to see.', 'Mark my words, good will come of it.'], neg: ['Tsk, tsk.', "I've seen this before.", 'Foolishness.'], sign: '— {me}, former Mayor' },
};
function reflect(v, who, seed) {
  const o = v.op[who], N = V[who].first;
  const sets = o >= 60 ? [`${N} is one of my dearest friends.`, `I'm so lucky to have ${N} around.`]
    : o >= 30 ? [`I'm growing rather fond of ${N}.`, `${N} is good company.`]
      : o >= 10 ? [`${N} seems nice enough.`, `Maybe ${N} and I could be friends.`]
        : o > -10 ? [`I still can't quite read ${N}.`, `${N} is... fine, I suppose.`]
          : o > -30 ? [`${N} gets on my nerves sometimes.`, `I'm wary of ${N}.`]
            : [`I can hardly stand ${N} these days.`, `${N} and I just don't get along.`];
  return hpick(sets, seed);
}
function periodOf(min) { return min < 300 ? 'night' : min < 720 ? 'morning' : min < 1020 ? 'afternoon' : min < 1320 ? 'evening' : 'night'; }
const PERIOD_PHRASE = { morning: ['This morning, ', 'Early on, '], afternoon: ['In the afternoon, ', 'After lunch, '], evening: ['This evening, ', 'As the sun went down, '], night: ['Late at night, ', 'Late on, '] };
function composeDiary(v, d, live) {
  const voice = VOICES[v.voice];
  const all = v.memories.filter(m => m.day === d);
  const sum = all.reduce((s, m) => s + m.val, 0);
  const seedBase = d * 131 + v.id * 17;
  const openSet = sum >= 8 ? voice.good : sum <= -4 ? voice.bad : voice.ok;
  const parts = [hpick(openSet, seedBase)];
  if (!all.length) {
    parts.push(live ? 'The day is still young. Nothing much has happened yet.' : 'A quiet day. I mostly kept to myself.');
  } else {
    const ranked = all.map(m => ({ m, s: Math.abs(m.val) + (m.kind === 'meal' || m.kind === 'work' ? 0 : 1.5) + (m.kind === 'meal' ? -1 : 0) }))
      .sort((a, b) => b.s - a.s).slice(0, 6).map(o => o.m).sort((a, b) => a.t - b.t);
    let lastPeriod = '', reflections = 0;
    const reflected = new Set();
    ranked.forEach((m, i) => {
      const per = periodOf(m.min);
      let prefix = '';
      if (per !== lastPeriod) prefix = hpick(PERIOD_PHRASE[per], m.t + i);
      else prefix = hpick(['Later, ', 'Then ', '', 'After that, ', ''], m.t + 3);
      lastPeriod = per;
      let s = prefix + m.text;
      if (Math.abs(m.val) >= 3) s += ' ' + hpick(m.val > 0 ? voice.pos : voice.neg, m.t + v.id);
      if (m.who != null && Math.abs(m.val) >= 3 && !reflected.has(m.who) && reflections < 2) {
        s += ' ' + reflect(v, m.who, m.t * 3 + v.id); reflected.add(m.who); reflections++;
      }
      parts.push(s);
    });
  }
  // closing thoughts, grounded in current state
  const close = [];
  const gIds = Object.keys(v.grudges);
  if (gIds.length) {
    const g = v.grudges[gIds[0]], N = V[gIds[0]].first;
    const tried = all.some(m => m.kind === 'makeup_refused' && m.who === +gIds[0] && m.text.startsWith('I tried'));
    const refused = all.some(m => m.kind === 'makeup_refused' && m.who === +gIds[0] && !m.text.startsWith('I tried'));
    close.push(tried ? `I tried to make things right with ${N}. It's up to ${N} now.`
      : refused ? `${N} wants to make up, but I'm not ready. Maybe tomorrow.`
        : v.traits.forgive > 0.55 ? `I should try to make peace with ${N} about ${g.reason}.` : `I won't be the first to apologise to ${N}. Not after ${g.reason}.`);
  }
  const heard = all.filter(m => m.kind === 'gossip_heard').length;
  if (heard >= 2) close.push(hpick([`So much gossip today — ${heard} stories! I hardly know what to believe.`, `The village is buzzing with talk. I heard ${heard} different stories today.`], seedBase + 5));
  if (live) {
    if (v.needs.energy < 30) close.push("I'm so tired I can barely hold this pen.");
    else if (v.needs.hunger < 30) close.push('My stomach is grumbling as I write this.');
  }
  if (sum <= -4) {
    const bf = V.filter(o => o !== v).sort((a, b) => v.op[b.id] - v.op[a.id])[0];
    if (bf && v.op[bf.id] >= 40) close.push(`At least I can always count on ${bf.first}.`);
  }
  if (close.length) parts.push(close.join(' '));
  return parts.map(p => `<p>${esc(p)}</p>`).join('') + `<p class="sign">${esc(voice.sign.replace('{me}', v.first))}</p>`;
}

/* ============================== INIT VILLAGERS ============================== */
function initVillagers() {
  for (const a of V) for (const b of V) {
    if (a === b) continue;
    const ns = mulberry32(a.id * 31 + b.id * 7 + 99)();
    a.base[b.id] = Math.round((compat(a, b) - 0.3) * 24 + (ns - 0.5) * 14);
  }
  for (const [i, j, o] of PRESET) { V[i].base[j] = o + randi(-3, 3); V[j].base[i] = o + randi(-3, 3); }
  for (const a of V) for (const b of V) if (a !== b) { a.op[b.id] = a.base[b.id]; a.note[b.id] = PRESET.some(([i, j]) => (i === a.id && j === b.id) || (j === a.id && i === b.id)) ? (a.base[b.id] > 0 ? 'old friends' : 'long-standing tension') : 'neighbours'; }
  for (const a of V) for (const b of V) if (a.id < b.id) S.pairTier[pkey(a, b)] = tierOf(a, b);
  // A couple of lingering grudges to start the story
  const seedG = (i, j, reason) => { V[i].grudges[j] = { t: START_TIME - 500, reason }; V[j].grudges[i] = { t: START_TIME - 500, reason }; };
  seedG(5, 6, 'the price of vegetables'); seedG(1, 10, 'the late-night fiddling');
  addMemory(V[6], 'backstory', "I woke up still annoyed with Oswin about the price of vegetables.", 5, -2);
  addMemory(V[5], 'backstory', 'Hazel still refuses to accept my perfectly reasonable vegetable prices.', 6, -2);
  addMemory(V[1], 'backstory', "Pip's fiddling kept me up again. I've had enough.", 10, -2);
  for (const v of V) {
    const h = HOUSES[v.home];
    v.x = h.fx * T + T / 2; v.y = h.fy * T + T / 2;
    if (v.wake <= START_TIME / 60) { v.state = 'idle'; v.activity = 'Just woke up'; }
  }
}

/* ============================== RENDERING ============================== */
const canvas = $('#world'), ctx = canvas.getContext('2d');
const staticCanvas = document.createElement('canvas'), sctx = staticCanvas.getContext('2d');
const lightCanvas = document.createElement('canvas'), lctx = lightCanvas.getContext('2d');
const view = { scale: 1, cssW: WW, cssH: WH };

function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }

function resize() {
  const wrap = $('#canvasWrap'), stage = wrap.parentElement, roster = $('#roster');
  const ww = stage.clientWidth;
  const wh = window.innerWidth <= 1100 ? ww * 0.62 : stage.clientHeight - roster.offsetHeight - 10;
  if (!ww || wh <= 0) return;
  const aspect = WW / WH;
  let cssW = Math.min(ww - 14, (wh - 14) * aspect);
  cssW = Math.max(320, cssW);
  const cssH = cssW / aspect;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  wrap.style.height = (cssH + 14) + 'px';
  const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
  if (canvas.width === pw && canvas.height === ph) return;
  canvas.width = staticCanvas.width = lightCanvas.width = pw;
  canvas.height = staticCanvas.height = lightCanvas.height = ph;
  view.scale = pw / WW; view.cssW = cssW; view.cssH = cssH;
  drawStatic();
}

/* ---------- static layer ---------- */
function drawStatic() {
  const c = sctx;
  c.setTransform(view.scale, 0, 0, view.scale, 0, 0);
  c.imageSmoothingEnabled = false;
  drawTiles(c);
  const objs = [...props, ...trees.map(t => ({ kind: 'tree', t, by: t.by }))].sort((a, b) => a.by - b.by);
  for (const o of objs) drawProp(c, o);
  for (const b of benches) drawBench(c, b.x, b.y);
}
function drawTiles(c) {
  const BASE = { [G.GRASS]: null, [G.ROAD]: '#dcc08f', [G.WATER]: '#4f9fd6', [G.BRIDGE]: '#4f9fd6', [G.PLAZA]: '#b3a78f', [G.SOIL]: '#9a6844', [G.SAND]: '#ead7a2', [G.DOCK]: '#4f9fd6', [G.FLOWERS]: '#86c06a' };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y), t = tiles[i], s = tileSeed[i];
    c.fillStyle = BASE[t] || (s < .33 ? '#86c06a' : s < .66 ? '#7fba63' : '#8ac66e');
    c.fillRect(x * T, y * T, T + 0.6, T + 0.6);
  }
  const at = (x, y) => (inB(x, y) ? tiles[idx(x, y)] : G.GRASS);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y), t = tiles[i], X = x * T, Y = y * T, r = mulberry32(i * 7919 + 1);
    if (t === G.GRASS || t === G.FLOWERS) {
      for (let k = 0; k < 5; k++) { c.fillStyle = r() < .5 ? '#73ab58' : '#9cd47f'; c.fillRect(X + r() * 22, Y + r() * 22, 2, 2); }
      if (r() < .2) { c.fillStyle = '#5f9a48'; const tx = X + 4 + r() * 14, ty = Y + 6 + r() * 12; c.fillRect(tx, ty, 1, 3); c.fillRect(tx + 2, ty - 1, 1, 4); c.fillRect(tx + 4, ty, 1, 3); }
      if (t === G.GRASS && r() < .07) { c.fillStyle = pickR(r, ['#fff4f4', '#ffd84d', '#ff8fb1', '#b9a2ff']); const fx = X + 3 + r() * 17, fy = Y + 3 + r() * 17; c.fillRect(fx, fy, 2, 2); }
      if (t === G.GRASS && r() < .035) { c.fillStyle = '#9a9a8f'; const rx = X + 4 + r() * 14, ry = Y + 6 + r() * 12; c.fillRect(rx, ry, 4, 3); c.fillStyle = '#c0c0b4'; c.fillRect(rx, ry, 3, 1); }
      if (t === G.FLOWERS) for (let k = 0; k < 7; k++) { const fx = X + 2 + r() * 19, fy = Y + 2 + r() * 19; c.fillStyle = pickR(r, ['#ff7aa8', '#ffd84d', '#ffffff', '#b98cff', '#ff9a4d']); c.fillRect(fx, fy, 3, 3); c.fillStyle = '#ffef9a'; c.fillRect(fx + 1, fy + 1, 1, 1); }
    } else if (t === G.ROAD) {
      for (let k = 0; k < 3; k++) { c.fillStyle = r() < .5 ? '#c9aa78' : '#ead1a4'; c.fillRect(X + r() * 21, Y + r() * 21, 3, 2); }
      c.fillStyle = 'rgba(120,90,50,0.22)';
      for (const [dx, dy] of DIRS) {
        const n = at(x + dx, y + dy);
        if (n === G.GRASS || n === G.FLOWERS || n === G.SAND) {
          if (dx === 1) c.fillRect(X + T - 2, Y, 2, T); if (dx === -1) c.fillRect(X, Y, 2, T);
          if (dy === 1) c.fillRect(X, Y + T - 2, T, 2); if (dy === -1) c.fillRect(X, Y, T, 2);
        }
      }
    } else if (t === G.PLAZA) {
      for (let row = 0; row < 3; row++) {
        const o = row % 2 ? 4 : 0;
        for (let k = -1; k < 3; k++) {
          const sx = X + o + k * 8 + 1, sy = Y + row * 8 + 1;
          const x0 = Math.max(sx, X), x1 = Math.min(sx + 6.5, X + T);
          if (x1 <= x0) continue;
          c.fillStyle = r() < .5 ? '#d2c7af' : '#ddd3bf'; c.fillRect(x0, sy, x1 - x0, 6.5);
        }
      }
    } else if (t === G.SOIL) {
      c.fillStyle = '#84573a'; for (let k = 0; k < 4; k++) c.fillRect(X, Y + k * 6 + 4, T + .6, 2);
      const crop = (y + x) % 3;
      for (let k = 0; k < 2; k++) {
        const cx = X + 6 + k * 12, cy = Y + 9 + (k ? 6 : 0);
        if (crop === 0) { c.fillStyle = '#5aa64a'; circle(c, cx, cy, 4); c.fillStyle = '#7cc864'; circle(c, cx - 1, cy - 1, 2); }
        else if (crop === 1) { c.fillStyle = '#e8832e'; c.fillRect(cx - 1, cy, 3, 3); c.fillStyle = '#4f9a3a'; c.fillRect(cx - 2, cy - 4, 1, 4); c.fillRect(cx, cy - 5, 1, 5); c.fillRect(cx + 2, cy - 4, 1, 4); }
        else { c.fillStyle = '#e0b84a'; for (let q = -3; q <= 3; q += 2) c.fillRect(cx + q, cy - 5, 1, 7); c.fillStyle = '#f2d36a'; c.fillRect(cx - 3, cy - 6, 7, 2); }
      }
    } else if (t === G.SAND) {
      for (let k = 0; k < 4; k++) { c.fillStyle = r() < .5 ? '#dcc68c' : '#f4e6bd'; c.fillRect(X + r() * 22, Y + r() * 22, 2, 1); }
    } else if (t === G.WATER || t === G.BRIDGE || t === G.DOCK) {
      c.fillStyle = '#3f8cc2';
      if (at(x - 1, y) !== G.WATER && at(x - 1, y) !== G.BRIDGE && at(x - 1, y) !== G.DOCK) c.fillRect(X, Y, 3, T + .6);
      if (at(x + 1, y) !== G.WATER && at(x + 1, y) !== G.BRIDGE && at(x + 1, y) !== G.DOCK) c.fillRect(X + T - 3, Y, 3, T + .6);
      c.fillStyle = '#62b0e3'; c.fillRect(X + 5 + r() * 10, Y + 4 + r() * 14, 5, 1);
      if (t === G.BRIDGE) {
        const top = y === 12;
        c.fillStyle = '#b07a45'; c.fillRect(X, Y + (top ? 3 : 0), T + .6, T - 3);
        c.fillStyle = '#8f5f32'; for (let k = 0; k < T; k += 4) c.fillRect(X + k, Y + (top ? 3 : 0), 1, T - 3);
        c.fillStyle = '#6e4626'; c.fillRect(X, top ? Y : Y + T - 3, T + .6, 3);
        c.fillStyle = '#5a3818'; c.fillRect(X + 2, top ? Y - 2 : Y + T - 4, 3, 5);
      }
      if (t === G.DOCK) {
        c.fillStyle = '#5a3818'; c.fillRect(X + 2, Y + 1, 3, T - 1); c.fillRect(X + T - 5, Y + 1, 3, T - 1);
        c.fillStyle = '#a87445'; c.fillRect(X, Y + 4, T + .6, T - 8);
        c.fillStyle = '#8a5a32'; for (let k = 4; k < T - 4; k += 4) c.fillRect(X, Y + k, T + .6, 1);
      }
    }
  }
  // farm fence
  c.fillStyle = '#8a5a32';
  const fence = (x, y, horiz) => {
    const X = x * T, Y = y * T;
    if (horiz) { c.fillStyle = '#9b6a3c'; c.fillRect(X, Y + 10, T + .6, 2); c.fillRect(X, Y + 15, T + .6, 2); c.fillStyle = '#6e4626'; c.fillRect(X + 2, Y + 7, 3, 12); c.fillRect(X + 14, Y + 7, 3, 12); }
    else { c.fillStyle = '#9b6a3c'; c.fillRect(X + 10, Y, 2, T + .6); c.fillRect(X + 14, Y, 2, T + .6); c.fillStyle = '#6e4626'; c.fillRect(X + 9, Y + 4, 8, 3); c.fillRect(X + 9, Y + 16, 8, 3); }
  };
  for (let x = FARM.x; x < FARM.x + FARM.w; x++) { fence(x, 17, true); fence(x, 23, true); }
  for (let y = 18; y <= 22; y++) { fence(1, y, false); if (y !== 20) fence(8, y, false); }
}
function pickR(r, arr) { return arr[Math.floor(r() * arr.length)]; }

function drawProp(c, o) {
  switch (o.kind) {
    case 'house': return drawHouse(c, o.h);
    case 'tree': return drawTree(c, o.t);
    case 'library': return drawLibrary(c, o.x * T, o.y * T);
    case 'stall': return drawStall(c, o);
    case 'forge': return drawForge(c, o.x * T, o.y * T);
    case 'fountain': return drawFountainBase(c);
    case 'well': return drawWell(c, o.x * T, o.y * T);
    case 'logs': return drawLogs(c, o.x * T, o.y * T);
    case 'hive': return drawHive(c, o.x * T, o.y * T);
    case 'bonfire': return drawBonfireBase(c, o.x * T, o.y * T);
    case 'teatable': return drawTeaTable(c, o.x * T, o.y * T);
    case 'lamp': return drawLamp(c, o.x * T, o.y * T);
    case 'sign': return drawSign(c, o.x * T, o.y * T, o.text);
  }
}
function shadow(c, x, y, w, h) { c.fillStyle = 'rgba(0,0,0,0.18)'; c.beginPath(); c.ellipse(x, y, w, h, 0, 0, Math.PI * 2); c.fill(); }

function drawHouse(c, h) {
  const x = h.x * T, y = h.y * T, w = 3 * T, hh = 3 * T, wy = y + 32;
  c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(x + 6, y + 14, w - 2, hh - 12);
  // walls
  c.fillStyle = h.wall; c.fillRect(x + 4, wy, w - 8, y + hh - wy - 2);
  c.fillStyle = shade(h.wall, -18); c.fillRect(x + 4, y + hh - 7, w - 8, 5);
  c.fillStyle = shade(h.wall, -60); c.fillRect(x + 4, wy, 3, y + hh - wy - 2); c.fillRect(x + w - 7, wy, 3, y + hh - wy - 2);
  // windows
  h.win = [];
  for (const wx of [x + 10, x + w - 23]) {
    c.fillStyle = '#5a3b22'; c.fillRect(wx - 1, wy + 8, 15, 14);
    c.fillStyle = '#2c3d5a'; c.fillRect(wx + 1, wy + 10, 11, 10);
    c.fillStyle = '#4a6a90'; c.fillRect(wx + 1, wy + 10, 5, 4);
    c.fillStyle = '#5a3b22'; c.fillRect(wx + 6, wy + 10, 1, 10); c.fillRect(wx + 1, wy + 14, 11, 1);
    c.fillStyle = '#7a4b2a'; c.fillRect(wx - 2, wy + 22, 17, 3);
    c.fillStyle = pickR(mulberry32(wx), ['#ff7aa8', '#ffd84d', '#ff6a4d', '#b98cff']); c.fillRect(wx, wy + 20, 3, 2); c.fillRect(wx + 6, wy + 20, 3, 2); c.fillRect(wx + 11, wy + 20, 3, 2);
    h.win.push({ x: wx + 1, y: wy + 10, w: 11, h: 10 });
  }
  // door
  const dx = x + w / 2 - 6, dy = y + hh - 21;
  c.fillStyle = '#5a3418'; c.fillRect(dx - 1, dy - 1, 14, 20);
  c.fillStyle = '#8a5a34'; c.fillRect(dx + 1, dy + 1, 10, 18);
  c.fillStyle = '#6e4626'; c.fillRect(dx + 1, dy + 7, 10, 1);
  c.fillStyle = '#f0c75e'; c.fillRect(dx + 8, dy + 10, 2, 2);
  c.fillStyle = '#a9a39a'; c.fillRect(dx - 3, y + hh - 2, 18, 3);
  // roof
  const rTop = y - 4, rBot = wy + 5;
  c.fillStyle = shade(h.roof, -50);
  c.beginPath(); c.moveTo(x - 3, rBot + 2); c.lineTo(x + w + 3, rBot + 2); c.lineTo(x + w - 8, rTop); c.lineTo(x + 8, rTop); c.closePath(); c.fill();
  c.fillStyle = h.roof;
  c.beginPath(); c.moveTo(x - 2, rBot); c.lineTo(x + w + 2, rBot); c.lineTo(x + w - 8, rTop + 1); c.lineTo(x + 8, rTop + 1); c.closePath(); c.fill();
  for (let ry = rTop + 6, k = 0; ry < rBot; ry += 6, k++) {
    const t = (ry - rTop) / (rBot - rTop), lx = lerp(x + 8, x - 2, t), rx2 = lerp(x + w - 8, x + w + 2, t);
    c.fillStyle = shade(h.roof, -28); c.fillRect(lx, ry, rx2 - lx, 1);
    for (let sx = lx + (k % 2 ? 3 : 7); sx < rx2 - 2; sx += 8) c.fillRect(sx, ry - 5, 1, 5);
  }
  c.fillStyle = shade(h.roof, 35); c.fillRect(x + 9, rTop + 1, w - 18, 2);
  // chimney
  const cx = x + w - 22;
  c.fillStyle = '#8b5e4a'; c.fillRect(cx, y - 12, 9, 14);
  c.fillStyle = '#5a3b2f'; c.fillRect(cx - 1, y - 14, 11, 3);
  h.chimney = { x: cx + 4.5, y: y - 15 };
}
function drawTree(c, t) {
  const cx = t.x * T + T / 2, by = t.y * T + T - 3;
  shadow(c, cx + 3, by, 11, 4);
  if (t.kind === 'pine') {
    c.fillStyle = '#6b4423'; c.fillRect(cx - 2, by - 6, 4, 6);
    const layers = [[by - 6, 11], [by - 13, 9], [by - 20, 6]];
    for (const [ly, lw] of layers) {
      c.fillStyle = '#2f6b3a'; c.beginPath(); c.moveTo(cx - lw, ly); c.lineTo(cx + lw, ly); c.lineTo(cx, ly - 12); c.closePath(); c.fill();
      c.fillStyle = '#3f8a4a'; c.beginPath(); c.moveTo(cx - lw, ly); c.lineTo(cx, ly); c.lineTo(cx, ly - 12); c.closePath(); c.fill();
    }
  } else {
    c.fillStyle = '#7a4e2c'; c.fillRect(cx - 3, by - 9, 6, 9);
    c.fillStyle = '#5c3a1e'; c.fillRect(cx + 1, by - 9, 2, 9);
    c.fillStyle = '#3b7a38'; circle(c, cx, by - 17, 12);
    c.fillStyle = '#4c9a43'; circle(c, cx - 3, by - 19, 9.5);
    c.fillStyle = '#66b452'; circle(c, cx - 5, by - 22, 4.5);
    c.fillStyle = '#2f6b30'; c.fillRect(cx + 4, by - 13, 3, 2); c.fillRect(cx - 8, by - 12, 2, 2);
    if (t.kind === 'fruit') { c.fillStyle = '#e84a3c'; for (const [fx, fy] of [[-6, -16], [4, -20], [1, -12], [7, -15]]) c.fillRect(cx + fx, by + fy, 3, 3); }
  }
}
function drawLibrary(c, x, y) {
  const w = 4 * T, h = 3 * T, wy = y + 30;
  c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(x + 6, y + 12, w - 2, h - 10);
  c.fillStyle = '#d6ccb8'; c.fillRect(x + 3, wy, w - 6, y + h - wy - 2);
  c.fillStyle = '#bfb39c'; for (let k = 0; k < 4; k++) c.fillRect(x + 3, wy + 6 + k * 9, w - 6, 1);
  for (const px of [x + 8, x + 30, x + 58, x + 80]) { c.fillStyle = '#f4efe4'; c.fillRect(px, wy + 2, 6, y + h - wy - 4); c.fillStyle = '#d0c7b4'; c.fillRect(px + 4, wy + 2, 2, y + h - wy - 4); }
  c.fillStyle = '#4a2f1b'; c.fillRect(x + 40, y + h - 22, 16, 20); c.fillStyle = '#7a4e2c'; c.fillRect(x + 42, y + h - 20, 5, 18); c.fillRect(x + 49, y + h - 20, 5, 18);
  c.fillStyle = '#2c3d5a'; c.fillRect(x + 17, wy + 8, 9, 14); c.fillRect(x + 68, wy + 8, 9, 14);
  // roof (pediment)
  c.fillStyle = '#24395a'; c.beginPath(); c.moveTo(x - 3, wy + 4); c.lineTo(x + w + 3, wy + 4); c.lineTo(x + w / 2, y - 6); c.closePath(); c.fill();
  c.fillStyle = '#34507a'; c.beginPath(); c.moveTo(x, wy + 2); c.lineTo(x + w, wy + 2); c.lineTo(x + w / 2, y - 3); c.closePath(); c.fill();
  c.fillStyle = '#f0c75e'; rr(c, x + w / 2 - 22, wy - 14, 44, 11, 3); c.fill();
  c.fillStyle = '#4a2f1b'; c.font = 'bold 7px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('LIBRARY', x + w / 2, wy - 8.3);
  c.fillText('📚', x + w / 2, y + 6);
}
function drawStall(c, s) {
  const x = s.x * T, y = s.y * T, w = 2 * T;
  shadow(c, x + w / 2 + 2, y + T - 1, w / 2, 4);
  c.fillStyle = '#6e4626'; c.fillRect(x + 3, y - 10, 3, 30); c.fillRect(x + w - 6, y - 10, 3, 30);
  c.fillStyle = '#9a6a3d'; c.fillRect(x + 1, y + 7, w - 2, 15);
  c.fillStyle = '#b98552'; c.fillRect(x + 1, y + 7, w - 2, 4);
  c.fillStyle = '#7a4e2c'; for (let k = x + 6; k < x + w - 2; k += 8) c.fillRect(k, y + 12, 1, 10);
  // goods
  const gx = x + 6, gy = y + 3;
  for (let k = 0; k < 4; k++) {
    const px = gx + k * 9;
    if (s.goods === 'bread') { c.fillStyle = '#d99a4a'; rr(c, px, gy + 1, 8, 5, 2); c.fill(); c.fillStyle = '#f0c27a'; c.fillRect(px + 2, gy + 2, 4, 1); }
    else if (s.goods === 'cloth') { c.fillStyle = ['#c86bb0', '#5fa0d8', '#f2b134', '#7fae6a'][k]; c.fillRect(px, gy, 7, 6); c.fillStyle = 'rgba(255,255,255,.4)'; c.fillRect(px, gy + 1, 7, 1); }
    else if (s.goods === 'spices') { c.fillStyle = '#e8dcc0'; c.fillRect(px + 1, gy, 6, 6); c.fillStyle = ['#d9532e', '#e8b43a', '#7a9a3a', '#8a4a2a'][k]; c.fillRect(px + 1, gy + 2, 6, 4); }
    else { c.fillStyle = '#fff6dc'; c.fillRect(px + 2, gy - 2, 3, 8); c.fillStyle = '#ffb347'; c.fillRect(px + 3, gy - 4, 1, 2); }
  }
  // awning
  for (let k = 0; k < 8; k++) { c.fillStyle = k % 2 ? s.c2 : s.c1; c.fillRect(x + k * 6, y - 14, 6, 10); }
  for (let k = 0; k < 8; k++) { c.fillStyle = k % 2 ? s.c2 : s.c1; c.beginPath(); c.arc(x + k * 6 + 3, y - 4, 3, 0, Math.PI); c.fill(); }
  c.fillStyle = 'rgba(0,0,0,.15)'; c.fillRect(x, y - 14, w, 2);
}
function drawForge(c, x, y) {
  shadow(c, x + 26, y + 46, 24, 5);
  c.fillStyle = '#6f6f72'; c.fillRect(x + 4, y + 8, 40, 38);
  c.fillStyle = '#858589'; for (let r2 = 0; r2 < 5; r2++) for (let k = 0; k < 4; k++) c.fillRect(x + 5 + k * 10 + (r2 % 2 ? 5 : 0), y + 9 + r2 * 7, 8, 5);
  c.fillStyle = '#2a1a12'; rr(c, x + 14, y + 26, 20, 16, 6); c.fill();
  c.fillStyle = '#5c5c60'; c.fillRect(x + 30, y - 8, 10, 18);
  c.fillStyle = '#3e3e42'; c.fillRect(x + 29, y - 10, 12, 3);
  // anvil
  c.fillStyle = '#3a3a40'; c.fillRect(x + 2, y + 40, 12, 4); c.fillRect(x + 5, y + 44, 6, 3); c.fillRect(x + 3, y + 47, 10, 2);
}
function drawFountainBase(c) {
  const cx = 19 * T, cy = 18 * T;
  shadow(c, cx + 2, cy + 18, 24, 6);
  c.fillStyle = '#a69c88'; circle(c, cx, cy + 2, 23);
  c.fillStyle = '#c9bfa9'; circle(c, cx, cy, 22);
  c.fillStyle = '#4f9fd6'; circle(c, cx, cy, 17);
  c.fillStyle = '#6ab7e6'; circle(c, cx - 3, cy - 3, 11);
  c.fillStyle = '#d8d0c0'; circle(c, cx, cy, 5); c.fillStyle = '#efe9dc'; circle(c, cx - 1, cy - 2, 3);
}
function drawWell(c, x, y) {
  const cx = x + 12, cy = y + 14;
  shadow(c, cx + 2, cy + 8, 11, 4);
  c.fillStyle = '#8f877a'; circle(c, cx, cy, 10); c.fillStyle = '#2a3d55'; circle(c, cx, cy, 6);
  c.fillStyle = '#6e4626'; c.fillRect(cx - 11, cy - 16, 2, 16); c.fillRect(cx + 9, cy - 16, 2, 16);
  c.fillStyle = '#a33b3b'; c.beginPath(); c.moveTo(cx - 14, cy - 14); c.lineTo(cx + 14, cy - 14); c.lineTo(cx, cy - 23); c.closePath(); c.fill();
}
function drawLogs(c, x, y) {
  shadow(c, x + 36, y + 44, 34, 6);
  for (let r2 = 0; r2 < 3; r2++) for (let k = 0; k < 6 - r2; k++) {
    const lx = x + 8 + k * 11 + r2 * 5.5, ly = y + 38 - r2 * 10;
    c.fillStyle = '#7a4e2c'; circle(c, lx, ly, 6); c.fillStyle = '#d9b07a'; circle(c, lx, ly, 4.5); c.fillStyle = '#b98552'; circle(c, lx, ly, 2);
  }
  c.fillStyle = '#9a6a3d'; c.fillRect(x + 4, y + 2, 60, 5); c.fillStyle = '#6e4626'; c.fillRect(x + 4, y + 6, 60, 1);
}
function drawHive(c, x, y) {
  shadow(c, x + 13, y + 22, 9, 3);
  c.fillStyle = '#e8c25a'; c.fillRect(x + 5, y + 4, 15, 17);
  c.fillStyle = '#c99a30'; c.fillRect(x + 5, y + 9, 15, 2); c.fillRect(x + 5, y + 15, 15, 2);
  c.fillStyle = '#8a5a35'; c.fillRect(x + 3, y + 1, 19, 4);
  c.fillStyle = '#3a2616'; c.fillRect(x + 11, y + 18, 3, 2);
}
function drawBonfireBase(c, x, y) {
  const cx = x + 12, cy = y + 15;
  c.fillStyle = '#7d756a'; for (let a = 0; a < 8; a++) circle(c, cx + Math.cos(a / 8 * 6.28) * 9, cy + Math.sin(a / 8 * 6.28) * 5, 3);
  c.fillStyle = '#6e4626'; c.save(); c.translate(cx, cy); c.rotate(.5); c.fillRect(-8, -1.5, 16, 3); c.rotate(-1); c.fillRect(-8, -1.5, 16, 3); c.restore();
}
function drawTeaTable(c, x, y) {
  const cx = x + 12, cy = y + 14;
  shadow(c, cx + 2, cy + 6, 11, 4);
  c.fillStyle = '#7a4e2c'; c.fillRect(cx - 1, cy, 3, 8);
  c.fillStyle = '#a0703f'; c.beginPath(); c.ellipse(cx, cy, 10, 6, 0, 0, 7); c.fill();
  c.fillStyle = '#c08a52'; c.beginPath(); c.ellipse(cx, cy - 1, 8, 4, 0, 0, 7); c.fill();
  c.fillStyle = '#f6f1e6'; c.fillRect(cx - 4, cy - 6, 7, 5); c.fillRect(cx + 3, cy - 5, 2, 2); c.fillStyle = '#7a5aa0'; c.fillRect(cx - 4, cy - 4, 7, 1);
  c.fillStyle = '#ffffff'; c.fillRect(cx + 5, cy - 2, 3, 2);
}
function drawLamp(c, x, y) {
  shadow(c, x + 13, y + 22, 5, 2);
  c.fillStyle = '#3b3b3b'; c.fillRect(x + 11, y + 4, 3, 19); c.fillRect(x + 8, y + 21, 9, 2);
  c.fillStyle = '#2f2f2f'; c.fillRect(x + 7, y - 4, 11, 9);
  c.fillStyle = '#d8c48a'; c.fillRect(x + 9, y - 2, 7, 5);
  c.fillStyle = '#2f2f2f'; c.fillRect(x + 8, y - 6, 9, 2);
}
function drawSign(c, x, y, text) {
  c.fillStyle = '#6e4626'; c.fillRect(x + 11, y + 6, 3, 17);
  c.font = 'bold 6.5px "Segoe UI", sans-serif';
  const w = Math.max(22, c.measureText(text).width + 8);
  c.fillStyle = '#5a3818'; rr(c, x + 12.5 - w / 2 - 1, y - 1, w + 2, 11, 2); c.fill();
  c.fillStyle = '#c99a62'; rr(c, x + 12.5 - w / 2, y, w, 9, 2); c.fill();
  c.fillStyle = '#3a2616'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x + 12.5, y + 4.8);
}
function drawBench(c, x, y) {
  const X = x * T, Y = y * T;
  c.fillStyle = 'rgba(0,0,0,.15)'; c.fillRect(X + 3, Y + 18, 19, 3);
  c.fillStyle = '#6e4626'; c.fillRect(X + 4, Y + 12, 2, 7); c.fillRect(X + 18, Y + 12, 2, 7);
  c.fillStyle = '#a8743f'; c.fillRect(X + 2, Y + 11, 20, 3); c.fillRect(X + 2, Y + 5, 20, 3);
  c.fillStyle = '#6e4626'; c.fillRect(X + 4, Y + 5, 2, 7); c.fillRect(X + 18, Y + 5, 2, 7);
}

/* ---------- villagers ---------- */
function drawSprite(c, v, x, y, facing, phase, moving) {
  const L = v.look;
  const bob = moving ? Math.abs(Math.sin(phase)) * 1.2 : 0;
  const sw = moving ? Math.sin(phase) * 2 : 0;
  c.save(); c.translate(Math.round(x), Math.round(y));
  c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.ellipse(0, 0, 6, 2.4, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = L.pants;
  c.fillRect(-4, -6, 3, 6 - Math.max(0, sw)); c.fillRect(1, -6, 3, 6 - Math.max(0, -sw));
  c.fillStyle = '#2b1d14'; c.fillRect(-4, -1 - Math.max(0, sw), 3, 1); c.fillRect(1, -1 - Math.max(0, -sw), 3, 1);
  c.translate(0, -bob);
  // arms behind/side
  c.fillStyle = shade(L.shirt, -20);
  c.fillRect(-7, -13 + sw * 0.5, 2, 6); c.fillRect(5, -13 - sw * 0.5, 2, 6);
  c.fillStyle = L.skin; c.fillRect(-7, -7 + sw * 0.5, 2, 2); c.fillRect(5, -7 - sw * 0.5, 2, 2);
  // body
  c.fillStyle = L.shirt; c.fillRect(-5, -14, 10, 9);
  c.fillStyle = shade(L.shirt, -30); c.fillRect(2, -14, 3, 9);
  c.fillStyle = shade(L.shirt, 30); c.fillRect(-5, -14, 10, 1);
  if (L.acc === 'apron') { c.fillStyle = '#6b4a2e'; c.fillRect(-4, -12, 8, 8); c.fillStyle = '#4a3220'; c.fillRect(-4, -12, 8, 1); }
  if (L.acc === 'shawl') { c.fillStyle = '#b48ac8'; c.fillRect(-6, -14, 12, 4); c.fillStyle = '#8f63a8'; c.fillRect(-2, -10, 4, 2); }
  if (L.acc === 'chef') { c.fillStyle = '#ffffff'; c.fillRect(-4, -11, 8, 6); }
  // head
  c.fillStyle = L.skin; c.fillRect(-4, -22, 8, 8);
  c.fillStyle = shade(L.skin, -25); c.fillRect(-4, -15, 8, 1);
  const up = facing === 'up';
  // hair
  c.fillStyle = L.hair;
  switch (L.style) {
    case 'short': c.fillRect(-4, -23, 8, 3); c.fillRect(-4, -21, 1, 3); c.fillRect(3, -21, 1, 3); if (up) c.fillRect(-4, -23, 8, 7); break;
    case 'long': c.fillRect(-4, -23, 8, 3); c.fillRect(-5, -21, 2, 9); c.fillRect(3, -21, 2, 9); if (up) c.fillRect(-5, -23, 10, 11); break;
    case 'bun': c.fillRect(-4, -23, 8, 3); c.fillRect(-4, -21, 1, 3); c.fillRect(3, -21, 1, 3); c.fillRect(-2, -26, 4, 3); if (up) c.fillRect(-4, -23, 8, 7); break;
    case 'messy': c.fillRect(-5, -24, 10, 3); c.fillRect(-3, -25, 2, 1); c.fillRect(1, -25, 2, 1); c.fillRect(-5, -21, 1, 3); c.fillRect(4, -21, 1, 3); if (up) c.fillRect(-5, -24, 10, 8); break;
    case 'braid': c.fillRect(-4, -23, 8, 3); c.fillRect(-5, -21, 1, 4); c.fillRect(3, -21, 2, 4); c.fillRect(4, -17, 2, 8); if (up) c.fillRect(-4, -23, 8, 8); break;
    case 'pigtails': c.fillRect(-4, -23, 8, 3); c.fillRect(-7, -21, 3, 6); c.fillRect(4, -21, 3, 6); if (up) c.fillRect(-4, -23, 8, 7); break;
  }
  // face
  if (!up) {
    c.fillStyle = '#2b1d14';
    if (facing === 'down') { c.fillRect(-2, -19, 1, 2); c.fillRect(1, -19, 1, 2); }
    else if (facing === 'left') c.fillRect(-3, -19, 1, 2);
    else c.fillRect(2, -19, 1, 2);
    if (L.beard) { c.fillStyle = L.hair; c.fillRect(-4, -16, 8, 2); c.fillRect(-3, -15, 6, 2); }
    if (L.mustache) { c.fillStyle = L.hair; c.fillRect(-2, -16, 4, 1); }
    if (L.acc === 'glasses') { c.fillStyle = '#222'; if (facing === 'down') { c.fillRect(-3, -20, 3, 1); c.fillRect(0, -20, 3, 1); c.fillRect(-3, -18, 3, 1); c.fillRect(0, -18, 3, 1); } else c.fillRect(facing === 'left' ? -4 : 1, -20, 3, 1); }
    if (v.id === 8) { c.fillStyle = 'rgba(255,120,140,.6)'; c.fillRect(-4, -17, 1, 1); c.fillRect(3, -17, 1, 1); }
  }
  // hats / accessories
  switch (L.acc) {
    case 'chef': c.fillStyle = '#ffffff'; c.fillRect(-4, -26, 8, 4); c.fillRect(-5, -29, 10, 4); c.fillStyle = '#e6e6e6'; c.fillRect(-4, -23, 8, 1); break;
    case 'buckethat': c.fillStyle = '#7a8a4a'; c.fillRect(-6, -24, 12, 2); c.fillRect(-4, -27, 8, 3); break;
    case 'tophat': c.fillStyle = '#2a2230'; c.fillRect(-6, -24, 12, 2); c.fillRect(-4, -30, 8, 6); c.fillStyle = '#8a5ab8'; c.fillRect(-4, -26, 8, 1); break;
    case 'strawhat': c.fillStyle = '#e8c66a'; c.fillRect(-7, -24, 14, 2); c.fillRect(-4, -27, 8, 3); c.fillStyle = '#c0392b'; c.fillRect(-4, -25, 8, 1); break;
    case 'bandana': c.fillStyle = '#d64535'; c.fillRect(-4, -24, 8, 2); c.fillRect(4, -23, 2, 2); break;
    case 'feather': c.fillStyle = '#1f6f66'; c.fillRect(-4, -25, 8, 3); c.fillRect(-5, -23, 10, 1); c.fillStyle = '#e84a3c'; c.fillRect(3, -29, 1, 5); c.fillRect(4, -28, 1, 3); break;
    case 'flowercrown': for (let k = 0; k < 4; k++) { c.fillStyle = ['#ff7aa8', '#ffd84d', '#ffffff', '#b98cff'][k]; c.fillRect(-4 + k * 2.3, -24, 2, 2); } break;
    case 'ribbon': c.fillStyle = '#ff5c9a'; c.fillRect(1, -25, 2, 2); c.fillRect(4, -25, 2, 2); c.fillRect(3, -24, 1, 1); break;
    case 'flower': c.fillStyle = '#ff6fa0'; c.fillRect(2, -25, 3, 3); c.fillStyle = '#ffe14d'; c.fillRect(3, -24, 1, 1); break;
    case 'shawl': c.fillStyle = '#6e4626'; c.fillRect(7, -9, 1, 10); break;
  }
  c.restore();
}

function drawWater(c, tt) {
  c.fillStyle = 'rgba(255,255,255,0.22)';
  for (const [x, y, s] of waterTiles) {
    const oy = (tt * 9 + s * 24) % T, oy2 = (tt * 9 + s * 24 + 12) % T;
    c.fillRect(x * T + 3 + s * 13, y * T + oy, 5, 1.2);
    c.fillRect(x * T + 14 - s * 8, y * T + oy2, 4, 1.2);
  }
  // fountain sparkle
  const cx = 19 * T, cy = 18 * T;
  c.fillStyle = 'rgba(255,255,255,0.75)';
  for (let k = 0; k < 6; k++) {
    const a = tt * 1.6 + k * 1.05, r = 8 + ((tt * 7 + k * 3) % 8);
    c.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 1.5, 1.5);
  }
  c.fillStyle = 'rgba(200,235,255,0.8)';
  const sp = (tt * 3) % 1; c.fillRect(cx - 1, cy - 8 - sp * 4, 2, 4);
}
function drawClouds(c, tt, dark) {
  const a = 0.07 * (1 - Math.min(1, dark * 2));
  if (a <= 0.005) return;
  c.fillStyle = `rgba(20,30,40,${a})`;
  for (let k = 0; k < 3; k++) {
    const x = ((tt * 7 + k * 420) % (WW + 360)) - 180, y = 90 + k * 190 + Math.sin(tt * 0.1 + k) * 20;
    c.beginPath(); c.ellipse(x, y, 90, 34, 0, 0, 7); c.ellipse(x + 60, y + 14, 60, 26, 0, 0, 7); c.ellipse(x - 55, y + 10, 50, 22, 0, 0, 7); c.fill();
  }
}
function lightAt(h) {
  const keys = [[0, .66], [4.5, .66], [5.5, .46], [6.5, .2], [7.5, 0], [17, 0], [18.5, .14], [19.5, .38], [20.5, .58], [24, .66]];
  let dark = 0;
  for (let i = 0; i < keys.length - 1; i++) if (h >= keys[i][0] && h <= keys[i + 1][0]) { dark = lerp(keys[i][1], keys[i + 1][1], (h - keys[i][0]) / (keys[i + 1][0] - keys[i][0])); break; }
  const warm = Math.max(0, 0.16 - Math.abs(h - 6.4) * 0.12) + Math.max(0, 0.2 - Math.abs(h - 18.8) * 0.12);
  return { dark, warm };
}
const bonfireLit = h => h >= 18.5 || h < 0.5;

function collectLights(h, tt) {
  const L = [];
  for (const l of lamps) L.push({ x: l.x * T + 12.5, y: l.y * T, r: 58, a: 0.95, warm: 1 });
  for (const hs of HOUSES) {
    const o = V[hs.id];
    if (o.inside && o.state !== 'sleeping' && hs.win) for (const w of hs.win) L.push({ x: w.x + w.w / 2, y: w.y + w.h, r: 30, a: 0.85, warm: 1 });
  }
  if (bonfireLit(h)) L.push({ x: BONFIRE.x * T + 12, y: BONFIRE.y * T + 10, r: 100 + Math.sin(tt * 9) * 4, a: 1, warm: 1.6 });
  const bram = V[1];
  L.push({ x: 11 * T + 24, y: 5 * T + 34, r: bram.state === 'working' ? 55 : 22, a: 0.9, warm: 1.2 });
  for (const v of V) if (!v.inside) L.push({ x: v.x, y: v.y - 8, r: 30, a: 0.75, warm: 0.6 });
  const tob = V[7];
  if (tob.state === 'relaxing' && Math.abs(tob.x - PLACES.library.x * T) < 40) L.push({ x: 25 * T, y: 16 * T + 20, r: 45, a: 0.9, warm: 1 });
  return L;
}
function drawLighting(c, h, tt) {
  const { dark, warm } = lightAt(h);
  if (dark > 0.01) {
    const lights = collectLights(h, tt);
    const lc = lctx, s = view.scale;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, lightCanvas.width, lightCanvas.height);
    lc.fillStyle = `rgba(14,20,58,${dark})`;
    lc.fillRect(0, 0, lightCanvas.width, lightCanvas.height);
    lc.setTransform(s, 0, 0, s, 0, 0);
    lc.globalCompositeOperation = 'destination-out';
    for (const l of lights) {
      const g = lc.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      g.addColorStop(0, `rgba(0,0,0,${l.a})`); g.addColorStop(0.5, `rgba(0,0,0,${l.a * 0.6})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g; lc.beginPath(); lc.arc(l.x, l.y, l.r, 0, Math.PI * 2); lc.fill();
    }
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(lightCanvas, 0, 0); c.restore();
    c.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      const g = c.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 0.7);
      g.addColorStop(0, `rgba(255,170,80,${0.22 * dark * l.warm})`); g.addColorStop(1, 'rgba(255,170,80,0)');
      c.fillStyle = g; c.beginPath(); c.arc(l.x, l.y, l.r * 0.7, 0, Math.PI * 2); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }
  if (warm > 0.01) { c.fillStyle = `rgba(255,140,60,${warm})`; c.fillRect(0, 0, WW, WH); }
  return dark;
}
function drawEmissive(c, h, tt, dark) {
  // bonfire flames
  if (bonfireLit(h)) {
    const x = BONFIRE.x * T + 12, y = BONFIRE.y * T + 14;
    for (let k = 0; k < 5; k++) {
      const f = Math.sin(tt * 12 + k * 2) * 1.5, hgt = 9 + Math.sin(tt * 8 + k) * 3;
      c.fillStyle = k % 2 ? '#ffb02e' : '#ff6a1f';
      c.beginPath(); c.moveTo(x - 6 + k * 3, y); c.lineTo(x - 4 + k * 3 + f, y - hgt); c.lineTo(x - 2 + k * 3, y); c.closePath(); c.fill();
    }
    c.fillStyle = '#fff2a8'; c.beginPath(); c.moveTo(x - 3, y); c.lineTo(x + Math.sin(tt * 10), y - 7); c.lineTo(x + 3, y); c.closePath(); c.fill();
    if (Math.random() < 0.15) S.particles.push({ x: x + rand(-3, 3), y: y - 8, vx: rand(-4, 4), vy: rand(-20, -12), life: 0, max: rand(0.6, 1.2), type: 'ember' });
  }
  // forge mouth
  const fx = 11 * T + 24, fy = 5 * T + 34, working = V[1].state === 'working';
  c.fillStyle = working ? `rgba(255,${120 + Math.sin(tt * 10) * 30 | 0},40,0.95)` : 'rgba(180,70,30,0.6)';
  rr(c, fx - 8, fy - 6, 16, 10, 4); c.fill();
  if (working && Math.random() < 0.2) S.particles.push({ x: fx + rand(-4, 4), y: fy - 2, vx: rand(-10, 10), vy: rand(-25, -10), life: 0, max: rand(0.4, 0.8), type: 'ember' });
  if (dark > 0.08) {
    const a = Math.min(1, dark * 1.8);
    c.fillStyle = `rgba(255,214,120,${a})`;
    for (const l of lamps) c.fillRect(l.x * T + 9, l.y * T - 2, 7, 5);
    for (const hs of HOUSES) {
      const o = V[hs.id];
      if (o.inside && o.state !== 'sleeping' && hs.win) { c.fillStyle = `rgba(255,205,110,${a})`; for (const w of hs.win) c.fillRect(w.x, w.y, w.w, w.h); }
    }
    // fireflies
    for (const f of fireflies) {
      const fxx = f.x + Math.sin(tt * 0.7 + f.ph) * f.r, fyy = f.y + Math.cos(tt * 0.5 + f.ph * 1.3) * f.r * 0.6;
      const al = (0.5 + 0.5 * Math.sin(tt * 3 + f.ph)) * Math.min(1, (dark - 0.08) * 3);
      c.fillStyle = `rgba(220,255,120,${al * 0.35})`; circle(c, fxx, fyy, 3);
      c.fillStyle = `rgba(240,255,170,${al})`; c.fillRect(fxx - 0.8, fyy - 0.8, 1.6, 1.6);
    }
  }
  // Zzz over sleeping homes
  c.font = 'bold 8px "Segoe UI", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const hs of HOUSES) {
    const o = V[hs.id];
    if (o.state === 'sleeping' && hs.chimney) {
      for (let k = 0; k < 3; k++) {
        const p = ((tt * 0.5 + k / 3 + hs.id * 0.13) % 1);
        c.fillStyle = `rgba(255,255,255,${(1 - p) * 0.9})`;
        c.font = `bold ${6 + p * 5}px "Segoe UI", sans-serif`;
        c.fillText('z', hs.x * T + 22 + Math.sin(p * 6 + k) * 4 + p * 8, hs.y * T + 8 - p * 20);
      }
    }
  }
}
let smokeAcc = 0;
function updateParticles(dt, tt, h) {
  smokeAcc += dt;
  if (smokeAcc > 0.35) {
    smokeAcc = 0;
    for (const hs of HOUSES) {
      const o = V[hs.id];
      if (hs.chimney && o.inside && o.state !== 'sleeping' && (o.state === 'eating' || h < 9 || h > 17)) S.particles.push({ x: hs.chimney.x, y: hs.chimney.y, vx: rand(2, 6), vy: rand(-9, -6), life: 0, max: rand(2.2, 3.2), type: 'smoke' });
    }
    if (V[1].state === 'working') S.particles.push({ x: 11 * T + 35, y: 5 * T - 10, vx: rand(2, 6), vy: rand(-10, -7), life: 0, max: 2.6, type: 'smoke' });
  }
  for (const p of S.particles) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.type !== 'smoke') p.vy += 6 * dt; }
  S.particles = S.particles.filter(p => p.life < p.max);
  if (S.particles.length > 400) S.particles.splice(0, S.particles.length - 400);
}
function drawParticles(c, front) {
  for (const p of S.particles) {
    const isSmoke = p.type === 'smoke';
    if (isSmoke === front) continue;
    const a = 1 - p.life / p.max;
    switch (p.type) {
      case 'smoke': c.fillStyle = `rgba(230,230,235,${a * 0.45})`; circle(c, p.x, p.y, 2.5 + p.life * 2.2); break;
      case 'ember': c.fillStyle = `rgba(255,${150 + (a * 80 | 0)},60,${a})`; c.fillRect(p.x, p.y, 1.5, 1.5); break;
      case 'heart': textP(c, '♥', p, '#ff4f7a', a, 9); break;
      case 'note': textP(c, Math.floor(p.x) % 2 ? '♪' : '♫', p, '#7b4bd0', a, 10); break;
      case 'anger': textP(c, '💢', p, '#e0402e', a, 8); break;
      case 'coin': c.fillStyle = `rgba(245,190,40,${a})`; circle(c, p.x, p.y, 2.2); c.fillStyle = `rgba(255,240,150,${a})`; c.fillRect(p.x - 0.8, p.y - 1, 1, 1); break;
      case 'gasp': textP(c, '!?', p, '#b03fd0', a, 9); break;
      case 'doubt': textP(c, '…', p, '#6b5a44', a, 10); break;
    }
  }
}
function textP(c, ch, p, col, a, size) { c.globalAlpha = a; c.fillStyle = col; c.font = `bold ${size}px "Segoe UI", "Segoe UI Emoji", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, p.x, p.y); c.globalAlpha = 1; }

function wrapText(c, text, maxW) {
  const words = text.split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  if (lines.length > 3) { lines.length = 3; lines[2] += '…'; }
  return lines;
}
function drawBubble(c, x, y, text, kind) {
  c.font = '600 8.5px "Segoe UI", Tahoma, sans-serif';
  const lines = wrapText(c, text, 112);
  const lh = 10, w = Math.max(...lines.map(l => c.measureText(l).width)) + 10, h = lines.length * lh + 6;
  const bx = clamp(x - w / 2, 2, WW - w - 2), by = Math.max(2, y - h);
  const border = kind === 'argue' ? '#c7402e' : kind === 'gossip' ? '#8a4fb0' : kind === 'makeup' || kind === 'gift' || kind === 'deep' ? '#e0567e' : kind === 'trade' ? '#c98a1e' : '#3a2616';
  c.fillStyle = 'rgba(0,0,0,0.18)'; rr(c, bx + 1, by + 2, w, h, 5); c.fill();
  c.fillStyle = '#fffdf6'; rr(c, bx, by, w, h, 5); c.fill();
  c.strokeStyle = border; c.lineWidth = 1; rr(c, bx + .5, by + .5, w - 1, h - 1, 5); c.stroke();
  c.fillStyle = '#fffdf6'; c.beginPath(); c.moveTo(x - 3, by + h - 0.5); c.lineTo(x + 3, by + h - 0.5); c.lineTo(x, by + h + 4); c.closePath(); c.fill();
  c.strokeStyle = border; c.beginPath(); c.moveTo(x - 3, by + h); c.lineTo(x, by + h + 4); c.lineTo(x + 3, by + h); c.stroke();
  c.fillStyle = '#2b1d14'; c.textAlign = 'left'; c.textBaseline = 'top';
  lines.forEach((l, i) => c.fillText(l, bx + 5, by + 3.5 + i * lh));
}
function drawTag(c, v, tt) {
  const sel = S.selected === v;
  c.font = `bold ${sel ? 9.5 : 8.5}px "Segoe UI", Tahoma, sans-serif`;
  const w = c.measureText(v.first).width, x = v.x, y = v.y - 34;
  rr(c, x - w / 2 - 8, y - 6.5, w + 13, 13, 6);
  c.fillStyle = sel ? 'rgba(255,200,80,0.97)' : 'rgba(43,29,20,0.78)'; c.fill();
  c.fillStyle = mood(v).color; circle(c, x - w / 2 - 3, y, 2.3);
  c.fillStyle = sel ? '#2b1d14' : '#fff3dc'; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillText(v.first, x - w / 2 + 1.5, y + 0.3);
  if (v.state === 'sleeping') return;
  const icon = v.state === 'working' ? v.icon : v.state === 'performing' ? '🎻' : v.state === 'eating' ? '🍽️' : null;
  if (icon && !v.conv) { c.font = '8px "Segoe UI Emoji", sans-serif'; c.textAlign = 'center'; c.fillText(icon, x + w / 2 + 9, y); }
}

let lastFrame = performance.now(), hover = null, lastClockMin = -1;
function frame(now) {
  const dtReal = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  if (S.running) {
    let gm = dtReal * MIN_PER_SEC * S.speed;
    while (gm > 0) { const st = Math.min(gm, 0.5); simStep(st); gm -= st; }
  }
  render(now / 1000, dtReal);
  if (Math.floor(S.time) !== lastClockMin) { lastClockMin = Math.floor(S.time); updateClock(); }
  requestAnimationFrame(frame);
}
function render(tt, dt) {
  const c = ctx, s = view.scale, h = hourNow();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(staticCanvas, 0, 0);
  c.setTransform(s, 0, 0, s, 0, 0);
  drawWater(c, tt);
  const { dark } = lightAt(h);
  updateParticles(dt, tt, h);
  drawParticles(c, false);
  drawClouds(c, tt, dark);
  // selected path
  const sel = S.selected;
  if (sel && !sel.inside && sel.path.length) {
    c.strokeStyle = 'rgba(255,214,90,0.85)'; c.lineWidth = 1.5; c.setLineDash([3, 3]); c.lineDashOffset = -tt * 10;
    c.beginPath(); c.moveTo(sel.x, sel.y);
    for (const [px, py] of sel.path) c.lineTo(px * T + T / 2 + sel.off[0], py * T + T / 2 + sel.off[1]);
    c.stroke(); c.setLineDash([]);
    const [ex, ey] = sel.path[sel.path.length - 1];
    c.strokeStyle = 'rgba(255,214,90,0.9)'; c.beginPath(); c.arc(ex * T + T / 2, ey * T + T / 2, 4 + Math.sin(tt * 5), 0, 7); c.stroke();
  }
  const vis = V.filter(v => !v.inside).sort((a, b) => a.y - b.y);
  for (const v of vis) {
    if (v === sel || v === hover) {
      c.strokeStyle = v === sel ? `rgba(255,205,60,${0.7 + Math.sin(tt * 6) * 0.3})` : 'rgba(255,255,255,0.7)';
      c.lineWidth = 1.5; c.beginPath(); c.ellipse(v.x, v.y, 9 + Math.sin(tt * 6) * (v === sel ? 1 : 0), 4, 0, 0, 7); c.stroke();
    }
    const moving = v.state === 'walking';
    const perf = v.state === 'performing';
    drawSprite(c, v, v.x, v.y, v.facing, moving ? v.walkPhase : perf ? tt * 8 : 0, moving || perf);
    if (perf) { c.fillStyle = '#8a4a1e'; c.fillRect(v.x + 3, v.y - 14, 6, 4); c.fillStyle = '#3a2616'; c.fillRect(v.x + 2, v.y - 17 + Math.sin(tt * 10) * 1.5, 9, 1); }
  }
  const d = drawLighting(c, h, tt);
  drawEmissive(c, h, tt, d);
  drawParticles(c, true);
  for (const v of vis) drawTag(c, v, tt);
  for (const conv of S.conversations) {
    const i = Math.min(conv.lines.length - 1, Math.floor(conv.timer / LINE));
    const line = conv.lines[i];
    if (line) drawBubble(c, line.s.x, line.s.y - 44, line.text, conv.type);
  }
}

/* ============================== UI ============================== */
function updateClock() {
  const h = hourNow();
  $('#clockDay').textContent = `Day ${dayNum()}`;
  $('#clockTime').textContent = fmtTime(S.time);
  const phase = h < 5 ? ['Night', '🌙'] : h < 7.5 ? ['Dawn', '🌅'] : h < 12 ? ['Morning', '☀️'] : h < 17 ? ['Afternoon', '🌤️'] : h < 20.5 ? ['Evening', '🌇'] : ['Night', '🌙'];
  $('#clockPhase').textContent = phase[0];
  $('#clockIcon').textContent = phase[1];
  $('#daybarSun').style.left = (h / 24 * 100) + '%';
}

function drawPortrait(cv, v, facing = 'down') {
  const c = cv.getContext('2d'), P = cv.width;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, P, P);
  const k = P / 20;
  c.imageSmoothingEnabled = false;
  c.setTransform(k, 0, 0, k, P / 2, P / 2 + 17 * k);
  drawSprite(c, v, 0, 0, facing, 0, false);
}

function buildRoster() {
  const r = $('#roster');
  r.innerHTML = V.map(v => `<button class="chip" data-id="${v.id}" title="${esc(v.name)} — ${esc(v.prof)}"><span class="chip-mood"></span><canvas width="68" height="68"></canvas><span class="chip-name">${esc(v.first)}</span><span class="chip-act"></span></button>`).join('');
  r.querySelectorAll('.chip').forEach(ch => drawPortrait(ch.querySelector('canvas'), V[+ch.dataset.id]));
}
const STATE_ICON = { walking: '🚶', working: '🛠️', talking: '💬', sleeping: '💤', eating: '🍽️', home: '🏠', relaxing: '🌿', shopping: '🛒', performing: '🎻', waiting: '🤔', idle: '🙂' };
function updateRoster() {
  document.querySelectorAll('#roster .chip').forEach(ch => {
    const v = V[+ch.dataset.id];
    ch.querySelector('.chip-act').textContent = STATE_ICON[v.state] || '🙂';
    ch.querySelector('.chip-mood').style.background = mood(v).color;
    ch.classList.toggle('selected', S.selected === v);
    ch.title = `${v.name} — ${v.prof}\n${v.activity}`;
  });
}

function select(v) {
  S.selected = v;
  setTab('villager');
  renderVillager(true);
  updateRoster();
}
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t));
  renderActiveTab(true);
}
function renderActiveTab(force) {
  if (S.tab === 'villager') renderVillager(force);
  else if (S.tab === 'rumours') renderRumourMill();
  else if (S.tab === 'village') renderVillage();
}

const needColor = n => (n > 60 ? '#6abf69' : n > 30 ? '#f0b44c' : '#e06c5a');
function needRow(label, n) { return `<div class="need"><span>${label}</span><div class="bar"><i style="width:${n.toFixed(0)}%;background:${needColor(n)}"></i></div><span class="need-val">${n.toFixed(0)}</span></div>`; }
function thought(v) {
  if (v.state === 'sleeping') { const bf = V.filter(o => o !== v).sort((a, b) => v.op[b.id] - v.op[a.id])[0]; return `Zzz… dreaming about ${bf.first} and ${PLUR[v.produce]}…`; }
  if (v.conv) { const o = v.conv.a === v ? v.conv.b : v.conv.a; return v.conv.type === 'argue' ? `${o.first} is driving me up the wall!` : v.conv.type === 'gossip' ? 'Ooh, juicy news…' : `Nice to talk with ${o.first}.`; }
  if (v.needs.hunger < 25) return 'My stomach is rumbling…';
  if (v.needs.energy < 25) return 'I can barely keep my eyes open.';
  const g = Object.entries(v.grudges).sort((a, b) => b[1].t - a[1].t)[0];
  if (g) return `Still upset with ${V[g[0]].first} about ${g[1].reason}.`;
  const heard = v.rumours.filter(k => k.from != null && S.time - k.t < 300).slice(-1)[0];
  if (heard) return `Could it really be true that ${rText(heard)}?`;
  if (v.needs.social < 35) return "It's been lonely. I should find someone to talk to.";
  if (v.state === 'working') return hpick([`Nothing beats a good day of ${PROD_NOUN[v.produce]}.`, 'Focus, focus…', 'Almost done for now.'], Math.floor(S.time / 60) + v.id);
  const bf = V.filter(o => o !== v).sort((a, b) => v.op[b.id] - v.op[a.id])[0];
  return v.op[bf.id] > 30 ? `I wonder what ${bf.first} is up to.` : 'What a lovely little village this is.';
}

function renderVillager(force) {
  const el = $('#tab-villager');
  const v = S.selected;
  if (!v) {
    if (force || !el.dataset.empty) {
      el.dataset.empty = '1'; el.dataset.vid = '';
      el.innerHTML = `<div class="empty-state"><span class="big">🧑‍🌾</span><h3>Pick a villager</h3><p>Click anyone on the map or in the roster below it to see their needs, friendships, memories, diary and the rumours they've heard.</p></div>`;
    }
    return;
  }
  el.dataset.empty = '';
  if (el.dataset.vid !== String(v.id)) {
    el.dataset.vid = String(v.id);
    el.innerHTML = `
      <div class="vp-head">
        <button class="vp-close" id="vpClose" title="Close">✕</button>
        <canvas class="vp-avatar" width="128" height="128"></canvas>
        <div>
          <h3 class="vp-name">${esc(v.name)}</h3>
          <div class="vp-prof">${v.icon} ${esc(v.prof)} · 🏠 ${esc(HOUSES[v.home].name)}</div>
          <div class="vp-tags">${v.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        </div>
      </div>
      <p class="vp-personality">“${esc(v.personality)}”</p>
      <div class="vp-status" id="vpStatus"></div>
      <div class="subtabs" id="subtabs">
        ${[['overview', '📋 Overview'], ['relations', '💞 Relations'], ['memories', '🧠 Memories'], ['diary', '📔 Diary'], ['rumours', '🗣️ Rumours']].map(([k, l]) => `<button data-sub="${k}" class="${S.subtab === k ? 'active' : ''}">${l}</button>`).join('')}
      </div>
      <div id="vpBody"></div>`;
    drawPortrait(el.querySelector('.vp-avatar'), v);
    $('#vpClose').onclick = () => { S.selected = null; renderVillager(true); updateRoster(); };
    el.querySelectorAll('#subtabs button').forEach(b => b.onclick = () => { S.subtab = b.dataset.sub; el.querySelectorAll('#subtabs button').forEach(x => x.classList.toggle('active', x === b)); renderVillagerBody(v); });
  }
  const m = mood(v);
  $('#vpStatus').innerHTML = `<div class="status-pill"><b>Mood</b>${m.emoji} ${m.label}</div><div class="status-pill" style="flex:2"><b>Right now</b>${STATE_ICON[v.state] || ''} ${esc(v.activity)}</div>`;
  renderVillagerBody(v);
}
function renderVillagerBody(v) {
  const body = $('#vpBody'); if (!body) return;
  let html = '';
  switch (S.subtab) {
    case 'overview': {
      html += `<div class="section-title">❤️ Needs</div>` + needRow('🍞 Fed', v.needs.hunger) + needRow('⚡ Energy', v.needs.energy) + needRow('👥 Social', v.needs.social) + needRow('😊 Happiness', v.needs.happiness);
      html += `<div class="thought">${esc(thought(v))}</div>`;
      const inv = Object.entries(v.inv).filter(([, n]) => n > 0);
      html += `<div class="section-title">🎒 Inventory</div><div class="inv"><span>🪙 ${v.coins} coins</span>${inv.map(([k, n]) => `<span>${ITEMS[k]} ${n} ${esc(n === 1 ? SING[k] : PLUR[k])}</span>`).join('')}</div>`;
      html += `<div class="section-title">🧬 Personality</div><div class="traits">${Object.entries(v.traits).map(([k, n]) => `<div class="trait"><span>${cap(k)}</span><div class="bar"><i style="width:${n * 100}%;background:#c58b4a"></i></div></div>`).join('')}</div>`;
      const bf = V.filter(o => o !== v).sort((a, b) => v.op[b.id] - v.op[a.id]);
      html += `<div class="section-title">📅 Routine & stats</div><dl class="kv">
        <dt>Wakes</dt><dd>${fmtTime(v.wake * 60)}</dd><dt>Bedtime</dt><dd>${fmtTime((v.bed % 24) * 60)}${v.nightOwl ? ' 🦉' : ''}</dd>
        <dt>Works at</dt><dd>${esc(PLACES[v.work].name)}</dd><dt>Wants</dt><dd>${v.wants.map(w => ITEMS[w]).join(' ')}</dd>
        <dt>Favourite</dt><dd>${nm(bf[0])} (${bf[0] ? Math.round(v.op[bf[0].id]) : 0})</dd><dt>Least fond of</dt><dd>${nm(bf[bf.length - 1])} (${Math.round(v.op[bf[bf.length - 1].id])})</dd>
        <dt>Conversations</dt><dd>${v.counts.talks}</dd><dt>Trades · Rows</dt><dd>${v.counts.trades} · ${v.counts.args}</dd>
        <dt>Rumours known</dt><dd>${v.rumours.length} (spread ${v.counts.gossip})</dd></dl>`;
      break;
    }
    case 'relations': {
      html += `<div class="intro-note">How ${esc(v.first)} feels about everyone (−100 to +100), and why. The small number shows how they feel back.</div>`;
      const list = V.filter(o => o !== v).sort((a, b) => v.op[b.id] - v.op[a.id]);
      for (const o of list) {
        const op = v.op[o.id], [lab, cls] = relLabel(op), g = v.grudges[o.id];
        html += `<div class="rel"><div class="rel-name"><span class="rel-dot" style="background:${o.look.shirt}"></span>${nm(o)} <span class="badge b-${cls}">${lab}</span>${g ? ' <span title="Holding a grudge">😤</span>' : ''}</div>
          <div><div class="rbar">${op >= 0 ? `<i class="pos" style="width:${op / 2}%"></i>` : `<i class="neg" style="width:${-op / 2}%"></i>`}</div><div class="rel-num">${Math.round(op)} · they: ${Math.round(o.op[v.id])}</div></div>
          <div class="rel-note">${g ? `Grudge: ${esc(g.reason)}` : `Last: ${esc(v.note[o.id] || 'neighbours')}`}</div></div>`;
      }
      break;
    }
    case 'memories': {
      const mems = v.memories.slice(-30).reverse();
      html += `<div class="intro-note">Real events ${esc(v.first)} lived through or witnessed — newest first.</div>`;
      if (!mems.length) html += '<p class="empty-state">No memories yet — the day has only just begun.</p>';
      for (const m of mems) html += `<div class="mem ${m.val > 0 ? 'pos' : m.val < 0 ? 'neg' : ''}"><span>${memIcon(m)}</span><div>${esc(m.text)}<small>Day ${m.day} · ${fmtTime(m.min)}</small></div></div>`;
      break;
    }
    case 'diary': {
      html += `<div class="diary live"><h4>Day ${dayNum()} <em>today, so far</em></h4>${composeDiary(v, dayNum(), true)}</div>`;
      for (const e of v.diary) html += `<div class="diary"><h4>Day ${e.day} <em>${e.mood}</em></h4>${e.html}</div>`;
      break;
    }
    case 'rumours': {
      html += `<div class="intro-note">Gossip ${esc(v.first)} knows, who told them, and whether they believe it. Stories change as they travel!</div>`;
      const ks = v.rumours.slice().reverse();
      if (!ks.length) html += '<p class="empty-state">Hasn\'t heard any rumours yet.</p>';
      for (const k of ks) {
        const fam = S.rumours.find(f => f.id === k.fid);
        const orig = fam ? rText({ kind: fam.kind, subj: fam.subj, level: 0, item: fam.item }) : '';
        const txt = rText(k);
        html += `<div class="rum"><span class="rt">“${esc(txt)}”</span>${k.from == null ? '<span class="pill self">saw it first-hand</span>' : k.believed ? '<span class="pill">believes it</span>' : '<span class="pill doubt">doubts it</span>'}
          <small>${k.from == null ? 'Witnessed personally' : `Heard from ${nm(V[k.from])}`} · Day ${Math.floor(k.t / DAY) + 1}, ${fmtTime(k.t)}${orig && orig !== txt ? ` · 🌀 originally: “${esc(orig)}”` : ''}</small></div>`;
      }
      break;
    }
  }
  body.innerHTML = html;
}
function memIcon(m) {
  return ({ chat: '💬', deep: '💞', compliment: '🌟', cold: '🧊', gossip_told: '🗣️', gossip_heard: '👂', rumour_about_me: '😱', trade_fair: '🔁', trade_unfair: '💸', trade_gain: '💰', trade_declined: '🚫', sale: '🪙', gift_given: '🎁', gift_got: '🎁', argue: '⚡', makeup: '🤝', makeup_refused: '🙅', witness: '👀', work: '🛠️', meal: '🍽️', overslept: '😴', slept: '🛌', music: '🎻', perform: '🎻', milestone: '💛', backstory: '📜' })[m.kind] || '•';
}

function renderRumourMill() {
  const el = $('#tab-rumours');
  const fams = S.rumours.slice().sort((a, b) => (b.hops.length ? b.hops[b.hops.length - 1].t : b.t) - (a.hops.length ? a.hops[a.hops.length - 1].t : a.t)).slice(0, 14);
  let html = `<div class="intro-note">🗣️ <b>The Rumour Mill.</b> Every rumour starts from a real event someone witnessed. As it passes from villager to villager it may get <b>exaggerated</b>, <b>blamed on someone else</b>, or have details changed (🌀).</div>`;
  if (!fams.length) html += '<p class="empty-state">No rumours yet… give it a little time. Someone is bound to see something!</p>';
  for (const f of fams) {
    const knowers = V.filter(v => knows(v, f.id)).length;
    const versions = Object.keys(f.texts).length;
    html += `<div class="fam"><div class="fam-head">Started Day ${f.day}, ${fmtTime(f.t)} — ${f.origin.map(id => nm(V[id])).join(' & ')} ${esc(f.how)}</div>
      <div class="fam-origin">“${esc(rText({ kind: f.kind, subj: f.subj, level: 0, item: f.item }))}”</div>
      <div class="fam-meta"><span>👥 Known by <b>${knowers}</b>/12</span><span>🔁 Told <b>${f.hops.length}</b>×</span><span>🌀 <b>${versions}</b> version${versions > 1 ? 's' : ''}</span></div>
      ${f.hops.length ? `<ul class="chain">${f.hops.slice(-6).map(hp => `<li class="${hp.mutated ? 'm' : ''}">${nm(V[hp.from])} → ${nm(V[hp.to])}: “${esc(hp.text)}”</li>`).join('')}</ul>` : '<div class="fam-meta"><i>Not spread yet…</i></div>'}</div>`;
  }
  el.innerHTML = html;
}
function opColor(o) {
  const t = Math.min(1, Math.abs(o) / 70);
  const from = [243, 230, 204], to = o >= 0 ? [95, 174, 90] : [217, 83, 79];
  return `rgb(${from.map((f, i) => Math.round(lerp(f, to[i], t))).join(',')})`;
}
function renderVillage() {
  const el = $('#tab-village');
  let friends = 0, rivals = 0;
  for (const a of V) for (const b of V) if (a.id < b.id) { const t = tierOf(a, b); if (t >= 2) friends++; if (t === -1) rivals++; }
  const pop = V.map(v => ({ v, s: V.reduce((s, o) => s + (o === v ? 0 : o.op[v.id]), 0) / 11 })).sort((a, b) => b.s - a.s);
  const gossip = V.slice().sort((a, b) => b.counts.gossip - a.counts.gossip)[0];
  const feisty = V.slice().sort((a, b) => b.counts.args - a.counts.args)[0];
  const happy = V.slice().sort((a, b) => b.needs.happiness - a.needs.happiness)[0];
  let html = `<div class="section-title">📊 Village at a glance — Day ${dayNum()}</div>
    <div class="stats">
      <div class="stat"><b>${friends}</b><span>Friendships</span></div><div class="stat"><b>${rivals}</b><span>Rivalries</span></div><div class="stat"><b>${S.rumours.length}</b><span>Rumours</span></div>
      <div class="stat"><b>${S.stats.talks}</b><span>Conversations</span></div><div class="stat"><b>${S.stats.trades}</b><span>Trades</span></div><div class="stat"><b>${S.stats.mutations}</b><span>Twisted tales</span></div>
      <div class="stat"><b>${S.stats.args}</b><span>Arguments</span></div><div class="stat"><b>${S.stats.makeups}</b><span>Make-ups</span></div><div class="stat"><b>${S.stats.gifts}</b><span>Gifts</span></div>
    </div>
    <div class="section-title">🏅 Village awards</div>
    <div class="award"><span class="ai">👑</span><div>Most liked: ${nm(pop[0].v)} <small>(avg ${pop[0].s.toFixed(0)})</small></div></div>
    <div class="award"><span class="ai">🌧️</span><div>Least liked: ${nm(pop[pop.length - 1].v)} <small>(avg ${pop[pop.length - 1].s.toFixed(0)})</small></div></div>
    <div class="award"><span class="ai">🗣️</span><div>Biggest gossip: ${nm(gossip)} <small>(${gossip.counts.gossip} rumours spread)</small></div></div>
    <div class="award"><span class="ai">⚡</span><div>Most quarrelsome: ${nm(feisty)} <small>(${feisty.counts.args} arguments)</small></div></div>
    <div class="award"><span class="ai">😄</span><div>Happiest right now: ${nm(happy)} <small>${mood(happy).emoji}</small></div></div>
    <div class="section-title">🕸️ Who likes whom</div>
    <div class="intro-note">Row = how that villager feels about each column. Click a name to inspect them.</div>
    <table class="matrix"><tr><th></th>${V.map(v => `<th title="${esc(v.name)}" style="color:${v.color}">${esc(v.first.slice(0, 2))}</th>`).join('')}</tr>`;
  for (const a of V) {
    html += `<tr><th data-id="${a.id}" style="color:${a.color};text-align:right">${esc(a.first)}</th>`;
    for (const b of V) {
      if (a === b) { html += '<td class="self"></td>'; continue; }
      const o = a.op[b.id];
      html += `<td style="background:${opColor(o)}" title="${esc(a.first)} → ${esc(b.first)}: ${Math.round(o)} (${relLabel(o)[0]})">${a.grudges[b.id] ? '😤' : ''}</td>`;
    }
    html += '</tr>';
  }
  html += `</table><div class="legend-row"><span><i style="background:${opColor(-70)}"></i>Dislike</span><span><i style="background:${opColor(0)}"></i>Neutral</span><span><i style="background:${opColor(70)}"></i>Like</span><span>😤 grudge</span></div>`;
  el.innerHTML = html;
}

/* ---------- input ---------- */
function worldPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * WW, y: (e.clientY - r.top) / r.height * WH, cx: e.clientX - r.left, cy: e.clientY - r.top };
}
function hitVillager(p) {
  let best = null, bd = 1e9;
  for (const v of V) {
    if (v.inside) continue;
    const dx = p.x - v.x, dy = p.y - (v.y - 12);
    if (Math.abs(dx) < 9 && Math.abs(dy) < 17) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = v; } }
  }
  return best;
}
function hitHouse(p) {
  for (const h of HOUSES) if (p.x >= h.x * T && p.x < (h.x + 3) * T && p.y >= h.y * T - 8 && p.y < (h.y + 3) * T) return h;
  return null;
}
function setupInput() {
  const tip = $('#tooltip');
  canvas.addEventListener('mousemove', e => {
    const p = worldPos(e);
    const v = hitVillager(p);
    hover = v;
    let html = '';
    if (v) html = `<b style="color:${v.color}">${esc(v.name)}</b> ${mood(v).emoji}<br><span class="tt-sub">${v.icon} ${esc(v.prof)}</span><br>${esc(v.activity)}`;
    else {
      const h = hitHouse(p);
      if (h) { const o = V[h.id]; html = `<b>🏠 ${esc(h.name)}</b><br><span class="tt-sub">Home of ${esc(o.name)}</span><br>${o.inside ? (o.state === 'sleeping' ? '💤 Asleep inside' : '🕯️ Home right now') : '🚪 Out and about'}`; }
    }
    canvas.classList.toggle('pointer', !!v || !!(html && !v));
    if (html) {
      tip.innerHTML = html; tip.classList.remove('hidden');
      const wrap = $('#canvasWrap').getBoundingClientRect(), cr = canvas.getBoundingClientRect();
      let left = cr.left - wrap.left + p.cx + 14, top = cr.top - wrap.top + p.cy + 14;
      if (left + 230 > wrap.width) left -= 250;
      if (top + 80 > wrap.height) top -= 100;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    } else tip.classList.add('hidden');
  });
  canvas.addEventListener('mouseleave', () => { hover = null; tip.classList.add('hidden'); });
  canvas.addEventListener('click', e => {
    const p = worldPos(e);
    const v = hitVillager(p);
    if (v) { select(v); return; }
    const h = hitHouse(p);
    if (h) select(V[h.id]);
  });
  // Any element with data-id selects that villager (log names, roster, relations, matrix)
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest('[data-id]');
    if (!el || e.button !== 0) return;
    const id = +el.dataset.id;
    if (V[id]) select(V[id]);
  });
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
  $('#logFilters').addEventListener('click', e => {
    const b = e.target.closest('button[data-filter]'); if (!b) return;
    S.logFilter = b.dataset.filter;
    document.querySelectorAll('#logFilters button').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('#logList .log-item').forEach(li => { li.style.display = S.logFilter === 'all' || li.dataset.type === S.logFilter ? '' : 'none'; });
  });
  $('#btnPause').addEventListener('click', togglePause);
  $('#speedGroup').addEventListener('click', e => { const b = e.target.closest('button[data-speed]'); if (b) setSpeed(+b.dataset.speed); });
  $('#btnHelp').addEventListener('click', () => $('#intro').classList.remove('hidden'));
  $('#btnStart').addEventListener('click', () => $('#intro').classList.add('hidden'));
  $('#intro').addEventListener('click', e => { if (e.target.id === 'intro') $('#intro').classList.add('hidden'); });
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    else if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) setSpeed([1, 2, 4, 8][+e.code.slice(-1) - 1]);
    else if (e.code === 'Escape') { if (!$('#intro').classList.contains('hidden')) $('#intro').classList.add('hidden'); else { S.selected = null; renderVillager(true); updateRoster(); } }
  });
  new ResizeObserver(resize).observe($('#canvasWrap').parentElement);
  window.addEventListener('resize', resize);
}
function togglePause() {
  S.running = !S.running;
  const b = $('#btnPause');
  b.textContent = S.running ? '⏸ Pause' : '▶ Resume';
  b.classList.toggle('paused', !S.running);
  $('#pausedBadge').classList.toggle('hidden', S.running);
}
function setSpeed(n) {
  S.speed = n;
  document.querySelectorAll('#speedGroup button').forEach(b => b.classList.toggle('active', +b.dataset.speed === n));
}

/* ============================== BOOT ============================== */
function boot() {
  buildMap();
  verifyMap();
  initVillagers();
  buildRoster();
  setupInput();
  resize();
  updateClock();
  renderVillager(true);
  logEvent('system', '🌅', 'Dawn breaks over VillageVerse. The early risers are stirring…');
  setInterval(() => { updateRoster(); renderActiveTab(false); }, 600);
  requestAnimationFrame(frame);
}
// Small debug/test hook (handy for demos too: VillageVerse.simulate(600) fast-forwards 10 hours)
window.VillageVerse = {
  S, V, HOUSES, verifyMap,
  simulate(min) { for (let t = 0; t < min; t += 0.5) simStep(0.5); updateClock(); renderActiveTab(true); },
  diary: (i, d) => composeDiary(V[i], d || dayNum(), true),
};
boot();
})();
