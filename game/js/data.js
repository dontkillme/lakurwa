// La Kurwa - game data tables. Edit freely: prices are in Mariuszki (M).
'use strict';

LK.SKILLS = ['bartending', 'cooking', 'tinkering', 'electric', 'fighting', 'vendor'];
LK.TASKS = ['idle', 'bartender', 'cook', 'maintenance', 'security'];

// Ingredients, goods and furniture live in data/items.js and data/furniture.js (editable with editor.html).
// Client taste types are collected from the ingredients at start-up (LK.finalizeData in core.js).

LK.NAMES_M = ['Mariusz', 'Zbyszek', 'Janusz', 'Rysiek', 'Grzegorz', 'Stach', 'Bogdan', 'Waldek', 'Heniek', 'Kazik', 'Mietek', 'Rex', 'Dusty', 'Gutter', 'Brick', 'Spike', 'Tomek', 'Lech'];
LK.NAMES_F = ['Grażyna', 'Halina', 'Jadzia', 'Krysia', 'Bożena', 'Wanda', 'Ash', 'Rusty', 'Vex', 'Zosia', 'Ela', 'Dana', 'Iza', 'Moth'];
LK.SURNAMES = ['the Rat', 'Kowalski', 'Two-Fingers', 'Nowak', 'Scrapper', 'the Quiet', 'Wiśniewski', 'Dustwalker', 'Rad-Eye', 'Mazur', 'Bonesaw', 'the Fat'];

// starting recipes (amounts per portion, 0.1..2 of an ingredient)
LK.START_RECIPES = [
  { id: 'beer',    name: 'Cold beer',       kind: 'drink', price: 20, parts: { beer: 1 } },
  { id: 'mule',    name: 'Wasteland mule',  kind: 'drink', price: 30, parts: { moonshine: 0.3, cactus: 0.5 } },
  { id: 'radshot', name: 'Rad shot',        kind: 'drink', price: 18, parts: { moonshine: 0.2 } },
  { id: 'water',   name: 'Clean water',     kind: 'drink', price: 6,  parts: { water: 0.5 } },
  { id: 'mash',    name: 'Potato mash',     kind: 'dish',  price: 15, parts: { potatoes: 0.4, lard: 0.1, spices: 0.1 } },
  { id: 'stew',    name: 'Rat stew',        kind: 'dish',  price: 30, parts: { rat: 0.3, potatoes: 0.3, cabbage: 0.3 } },
  { id: 'beans',   name: 'Beans on bread',  kind: 'dish',  price: 16, parts: { beans: 1, bread: 0.3 } }
];
// Storage: the bare storage room holds STORAGE_BASE items; furniture with `capacity` (data/furniture.js)
// standing inside a storage room adds its capacity. 1 item = 1 bottle / kg / piece / building material / furniture item.
LK.STORAGE_BASE = 80;
// What the travelling merchant carries per visit (random picks): [min, max] kinds
// Visits: one merchant comes every game day between the `arrive` hours; after him another one follows `extraDelay`
// game minutes later with the chance extra[0] (a third with extra[1] ...), so several may wait at the same time
// (each with his own goods and spot, at most `max`). Each waits `stay` game minutes.
LK.MERCHANT = { ingredients: [3, 6], furniture: [1, 3], qty: [3, 14], materialsChance: 0.7, specialChance: 0.35,
  arrive: [8, 14], stay: 240, extra: [0.4, 0.2], extraDelay: [0, 120], max: 3, firstAt: 10 * 60 };
// Order of the Holy Flame (Zakon Świętego Płomienia): rent collectors
// daily wage: at least `min`, plus `perSkill` M per point of the skill the employee's task uses
// (only that skill counts: a great cook working as security is paid for his fighting). Skills grow with work,
// so wages grow too; recalculated every morning before paying (LK.wageFor).
// chance that a traveller on the road stops at the bar: base + reputation + decor (inside the building) + size of the
// building; decor and size have diminishing returns (bonus = max × (1 − e^(−x / scale)))
LK.APPEAL = { base: 0.2, perRep: 0.005, decorMax: 0.2, decorScale: 6, sizeMax: 0.2, sizeFrom: 30, sizeScale: 80, min: 0.05, max: 0.95 };
LK.TIP = { max: 0.15 };   // a bartender with vendor skill 100 earns guests' tips up to 15 % of the price (to the owner)
LK.CLAIM_COST = 5000;   // Mariuszki for claiming 6 more rows/columns of land (build mode)
LK.WAGE = { min: 60, perSkill: 3 };
// how fast skills grow: every gainXp amount is multiplied by this (1 = the original speed; 0.5 = half)
LK.XP_RATE = 0.5;
LK.TASK_SKILLS = { bartender: ['bartending'], cook: ['cooking'], maintenance: ['tinkering', 'electric'], security: ['fighting'], idle: [] };
LK.RENT = {
  perTile: 8,           // Mariuszki per 1x1 tile of the bar building (bar room, kitchen, storage)
  perTent: 40,          // ... plus this per (built) rental tent
  everyDays: 3,         // they come on day 3, 6, 9 ...
  hour: 12,             // at noon
  maxWarnings: 3,       // the 3rd warning closes the bar
  clearAfter: 2,        // paying this many visits in a row clears the warnings
  demandWait: 5,        // seconds the leader's demand is shown before they collect
  heresyRange: 3,       // a rat altar this close to one of the soldiers gets smashed
  seizeShare: 0.5       // when the money is not enough they take supplies worth the rest, at most this share of the stock
};
LK.START_STOCK = { beer: 24, moonshine: 4, cactus: 6, water: 10, cola: 6, potatoes: 10, lard: 3, spices: 3, rat: 4, cabbage: 5, beans: 6, bread: 4 };
LK.START_GOODS = { materials: 10 };
LK.START_MONEY = 300;
