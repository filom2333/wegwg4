import { albumName } from '../audio/music/albums.js';
import { paintOf } from '../vehicle/paints.js';

// Item catalogue: physical properties, contents and what using the item does.
// Liquids are tracked in litres; food values are in need points (0-100 scale).

export const ITEMS = {
  jerryCan: { name: 'Jerry can', model: ['jerryCan', 'red'], mass: 1.6, liquid: { type: 'fuel', cap: 20, density: 0.74 }, bulky: true, hold: 'side', desc: 'Holds 20 l of fuel. Pour into the car filler.' },
  jerryCanGreen: { name: 'Jerry can (water)', model: ['jerryCan', 'green'], mass: 1.6, liquid: { type: 'water', cap: 20, density: 1 }, bulky: true, hold: 'side', desc: '20 l of water. Drinkable; keep it for the long dry stretches.' },
  waterBottle: { name: 'Water bottle', model: ['waterBottle'], mass: 0.05, liquid: { type: 'water', cap: 1.5, density: 1 }, drinkable: true, hold: 'hand', desc: 'Drink to quench thirst.' },
  waterJug: { name: 'Water jug', model: ['waterJug'], mass: 0.2, liquid: { type: 'water', cap: 5, density: 1 }, drinkable: true, bulky: true, hold: 'side', desc: '5 l of water. Drinkable.' },
  sodaCan: { name: 'Soda', model: ['sodaCan'], mass: 0.36, consume: { water: 22, food: 6, energy: 4 }, hold: 'hand', desc: 'Sugary, fizzy, warm.', variants: 3 },
  cannedBeans: { name: 'Canned beans', model: ['cannedFood', 'beans'], mass: 0.45, consume: { food: 34, water: -2 }, hold: 'hand' },
  cannedMeat: { name: 'Corned beef', model: ['cannedFood', 'meat'], mass: 0.38, consume: { food: 40, water: -6 }, hold: 'hand' },
  cannedSoup: { name: 'Tomato soup', model: ['cannedFood', 'soup'], mass: 0.42, consume: { food: 24, water: 10 }, hold: 'hand' },
  cannedPeaches: { name: 'Canned peaches', model: ['cannedFood', 'peaches'], mass: 0.42, consume: { food: 20, water: 12 }, hold: 'hand' },
  chips: { name: 'Crisps', model: ['snackBag', 'chips'], mass: 0.15, consume: { food: 14, water: -6 }, hold: 'hand' },
  jerky: { name: 'Beef jerky', model: ['snackBag', 'jerky'], mass: 0.1, consume: { food: 22, water: -7 }, hold: 'hand' },
  chocolate: { name: 'Chocolate bar', model: ['chocolate'], mass: 0.08, consume: { food: 12, energy: 6 }, hold: 'hand' },
  mre: { name: 'MRE ration', model: ['mre'], mass: 0.6, consume: { food: 55, water: -4, energy: 6 }, hold: 'hand', desc: 'A full military meal.' },
  medkit: { name: 'First aid kit', model: ['medkit'], mass: 0.8, consume: { health: 45, bleeding: 99, poison: 99 }, hold: 'hand', desc: 'Restores health and stops bleeding.' },
  bandage: { name: 'Bandage', model: ['bandage'], mass: 0.05, consume: { health: 8, bleeding: 99 }, hold: 'hand', desc: 'Stops bleeding.' },
  painkillers: { name: 'Painkillers', model: ['pillBottle'], mass: 0.06, consume: { health: 18, poison: 0.8 }, hold: 'hand' },
  oilBottle: { name: 'Motor oil', model: ['oilBottle'], mass: 0.15, liquid: { type: 'oil', cap: 1, density: 0.88 }, hold: 'hand', desc: 'Pour into the oil filler with the hood open.' },
  coolantJug: { name: 'Coolant', model: ['coolantJug'], mass: 0.2, liquid: { type: 'coolant', cap: 2, density: 1.07 }, hold: 'hand', desc: 'Pour into the coolant reservoir.' },
  repairKit: { name: 'Repair kit', model: ['repairKit'], mass: 3.2, charges: 2, bulky: true, hold: 'side', desc: 'Use on the engine to patch it up.' },
  tyreKit: { name: 'Tyre repair kit', model: ['repairKit'], mass: 1.2, charges: 2, hold: 'hand', desc: 'Use on a wheel to fix a puncture.' },
  wrench: { name: 'Wrench', model: ['wrench'], mass: 0.6, melee: { damage: 22, range: 1.7 }, hold: 'tool' },
  extinguisher: { name: 'Fire extinguisher', model: ['extinguisher'], mass: 4.5, charges: 1, bulky: true, hold: 'side', desc: 'Puts out an engine fire.' },
  lantern: { name: 'Lantern', model: ['lantern'], mass: 1.1, light: true, liquid: { type: 'fuel', cap: 0.4, density: 0.74 }, hold: 'side', desc: 'Use to switch on. Burns lamp fuel.' },
  revolver: { name: 'Revolver .38', model: ['revolver'], mass: 0.9, weapon: { ammo: '38', mag: 6, damage: 48, spread: 0.008, rate: 0.35, reload: 2.2, range: 120 }, hold: 'pistol' },
  shotgun: { name: 'Double-barrel shotgun', model: ['shotgun'], mass: 3.2, weapon: { ammo: '12', mag: 2, damage: 14, pellets: 9, spread: 0.05, rate: 0.3, reload: 2.6, range: 45 }, hold: 'rifle' },
  ammo38: { name: '.38 cartridges', model: ['ammoBox', '38'], mass: 0.15, stack: 6, ammo: { type: '38', count: 12 }, hold: 'hand', desc: 'Use to put them in your pouch.' },
  ammo12: { name: '12 ga shells', model: ['ammoBox', '12'], mass: 0.4, stack: 6, ammo: { type: '12', count: 8 }, hold: 'hand' },
  sponge: { name: 'Sponge', model: ['sponge'], mass: 0.03, clean: true, hold: 'hand', desc: 'Hold LMB on the car to wash off the dust.' },
  sprayPaint: { name: 'Spray paint', model: ['sprayPaint'], mass: 0.4, paint: true, charges: 5, variants: 15, hold: 'hand', desc: 'Aim at a car part and hold LMB to paint it. Enough for about five panels.' },
  cigarettes: { name: 'Cigarettes', model: ['cigarettes'], mass: 0.03, consume: { energy: 6, food: -3, water: -5, smoke: true }, charges: 5, hold: 'hand', desc: 'Calms the nerves. Makes you thirsty.' },
  coffee: { name: 'Canned coffee', model: ['coffee'], mass: 0.3, consume: { energy: 28, water: 6, food: 2 }, hold: 'hand', desc: 'Keeps you awake on long drives.' },
  cd: { name: 'CD', model: ['cdCase'], mass: 0.1, disc: true, hold: 'hand', variants: 6, desc: 'Put it in the car stereo (look at the radio, LMB).' },
  note: { name: 'Note', model: ['note'], mass: 0.01, readable: true, hold: 'hand', desc: 'Someone left this for whoever came next.' },
  // bolt-on car accessories (see vehicle/accessories.js) and ballast
  roofRack: { name: 'Roof rack', model: ['accessory', 'roofRack'], mass: 14, accessory: 'roofRack', bulky: true, hold: 'side', desc: 'Fits any car roof. Strap cargo on top; it raises the centre of gravity.' },
  roofBox: { name: 'Roof box', model: ['accessory', 'roofBox'], mass: 17, accessory: 'roofBox', bulky: true, hold: 'side', desc: 'A 50 kg boot that clamps on the roof. High weight rolls easier.' },
  bullBar: { name: 'Bull bar', model: ['accessory', 'bullBar'], mass: 26, accessory: 'bullBar', bulky: true, hold: 'side', desc: 'Bolts across the nose and takes the worst of a head-on hit. Heavy on the front axle.' },
  winchBar: { name: 'Winch bar', model: ['accessory', 'winchBar'], mass: 44, accessory: 'winchBar', bulky: true, hold: 'side', desc: 'A bull bar with an electric winch. Pull the cable out (E at the drum), hook it round a tree or onto another car, wind in from the seat (Y) or at the drum (LMB).' },
  carbKit: { name: 'Twin carburettor kit', model: ['carbKit'], mass: 4.6, tune: { part: 'engine', tune: 'twin' }, hold: 'side', desc: 'Two carbs with chrome pancake filters on a manifold. Open the engine lid and bolt them on (LMB): more pull up top, an intake roar, a fifth more fuel. A wrench takes them off again.' },
  jack: { name: 'Scissor jack', model: ['jack'], mass: 3.4, jack: true, bulky: true, hold: 'side', desc: 'Set it under the sill beside a wheel (E), crank with LMB, lower with RMB. A wheel carrying the car only comes off with that corner jacked up.' },
  rearRack: { name: 'Rear carrier', model: ['accessory', 'rearRack'], mass: 11, accessory: 'rearRack', bulky: true, hold: 'side', desc: 'A hitch tray behind the bumper for cans and crates.' },
  // sheets and boards that bolt on anywhere (see vehicle/plates.js)
  steelPlate: { name: 'Steel plate', model: ['plate', 'steelPlate'], mass: 8.5, plate: 'steelPlate', bulky: true, hold: 'side', desc: 'Bolt it anywhere on a car. Steel over the nose or tail takes some of a crash.' },
  steelSheet: { name: 'Steel sheet', model: ['plate', 'steelSheet'], mass: 15.5, plate: 'steelSheet', bulky: true, hold: 'side', desc: 'A big sheet of steel: armour for a window or a whole end of the car.' },
  plank: { name: 'Plank', model: ['plate', 'plank'], mass: 2.3, plate: 'plank', bulky: true, hold: 'side', desc: 'Bolt it to the car: a step, a shelf, a ramp, a fence.' },
  plankWide: { name: 'Wide board', model: ['plate', 'plankWide'], mass: 2.8, plate: 'plankWide', bulky: true, hold: 'side', desc: 'A scaffold board. Bolts on anywhere.' },
  plywood: { name: 'Plywood sheet', model: ['plate', 'plywood'], mass: 3.4, plate: 'plywood', bulky: true, hold: 'side', desc: 'Light and wide: board up a broken window, build a roof deck.' },
  plasticPanel: { name: 'Plastic panel', model: ['plate', 'plasticPanel'], mass: 1.7, plate: 'plasticPanel', bulky: true, variants: 5, hold: 'side', desc: 'Light, keeps the rain and dust out. Bolts on anywhere.' },
  plasticSheet: { name: 'Plastic sheet', model: ['plate', 'plasticSheet'], mass: 3.2, plate: 'plasticSheet', bulky: true, variants: 5, hold: 'side', desc: 'A big light panel. Bolts on anywhere.' },
  sandbag: { name: 'Sandbag', model: ['sandbag'], mass: 20, bulky: true, hold: 'side', desc: '20 kg of sand. Put it in the car low and over the driven wheels for grip and a steadier car.' },
  meat: { name: 'Raw meat', model: ['meatChunk', false], mass: 0.5, consume: { food: 26, water: -4 }, raw: true, cooksTo: 'cookedMeat', hold: 'hand', desc: 'Cook it over a fire. Eaten raw it may make you sick.' },
  cookedMeat: { name: 'Cooked meat', model: ['meatChunk', true], mass: 0.45, consume: { food: 48, water: -2, energy: 6, warmth: 6 }, hold: 'hand', desc: 'Hot from the fire.' },
  fish: { name: 'Fish', model: ['fish', false], mass: 0.6, consume: { food: 18, water: -2 }, raw: true, cooksTo: 'cookedFish', hold: 'hand', desc: 'Fresh from the river. Cook it over a fire.' },
  cookedFish: { name: 'Grilled fish', model: ['fish', true], mass: 0.5, consume: { food: 40, water: 2, warmth: 5 }, hold: 'hand', desc: 'Crisp skin, flaky and hot.' },
  fishingRod: { name: 'Fishing rod', model: ['fishingRod'], mass: 0.6, fishing: true, hold: 'hand', desc: 'Cast into a river or lake, wait for the float to dip, strike.' },
  thermos: { name: 'Thermos of coffee', model: ['thermos'], mass: 1.1, consume: { water: 14, energy: 14, warmth: 22 }, charges: 3, hold: 'hand', desc: 'Hot coffee. Warms you up on a cold night.' },
  blanket: { name: 'Wool blanket', model: ['blanket'], mass: 1.4, wrap: 34, hold: 'side', desc: 'Wrap up in it when the night gets cold. Sleeping with one keeps you warm.' },
  tent: { name: 'Tent', model: ['tentBag'], mass: 4.6, tent: true, bulky: true, hold: 'side', variants: 4, desc: 'A canvas ridge tent in its bag. Pitch it on open, level ground (LMB), crawl in out of the wind and rain and sleep the night through. Hold R on it to pack it up again.' },
  campfireKit: { name: 'Fire kit', model: ['campfireKit'], mass: 1.2, campfire: true, hold: 'side', desc: 'Kindling and matches. Lights a campfire on open ground: warmth, light, cooking.' },
};

// Loot tables by spot kind: [itemId, weight]
export const LOOT = {
  any: [
    ['waterBottle', 3],
    ['sodaCan', 3],
    ['cannedBeans', 2],
    ['chips', 2],
    ['bandage', 1],
  ],
  kitchen: [
    ['thermos', 0.5],
    ['coffee', 1],
    ['sponge', 0.6],
    ['cannedBeans', 3],
    ['cannedSoup', 3],
    ['cannedPeaches', 2],
    ['cannedMeat', 2],
    ['waterBottle', 2],
    ['sodaCan', 1],
  ],
  cupboard: [
    ['cannedBeans', 3],
    ['cannedSoup', 2],
    ['chips', 1],
    ['painkillers', 1],
  ],
  fridge: [
    ['sodaCan', 3],
    ['waterBottle', 3],
    ['cannedPeaches', 1],
  ],
  table: [
    ['cd', 0.6],
    ['cigarettes', 1],
    ['coffee', 0.8],
    ['sodaCan', 2],
    ['chips', 2],
    ['chocolate', 2],
    ['waterBottle', 1],
    ['ammo38', 0.4],
  ],
  small: [
    ['painkillers', 2],
    ['bandage', 2],
    ['chocolate', 1],
    ['ammo38', 0.6],
    ['revolver', 0.15],
  ],
  shelf: [
    ['cd', 0.5],
    ['cannedBeans', 1],
    ['oilBottle', 1],
    ['bandage', 1],
  ],
  medicine: [
    ['painkillers', 3],
    ['bandage', 3],
    ['medkit', 1],
  ],
  bed: [
    ['blanket', 1.5],
    ['cd', 0.3],
    ['ammo38', 0.6],
    ['revolver', 0.2],
    ['chocolate', 1],
  ],
  clothes: [
    ['fishingRod', 0.3],
    ['blanket', 1.0],
    ['bandage', 1],
    ['ammo12', 0.5],
    ['shotgun', 0.12],
  ],
  couch: [
    ['cd', 0.7],
    ['chips', 1],
    ['sodaCan', 1],
  ],
  desk: [
    ['cd', 0.5],
    ['chocolate', 1],
    ['ammo38', 0.5],
    ['painkillers', 1],
  ],
  office: [
    ['cd', 0.3],
    ['ammo38', 1],
    ['revolver', 0.25],
    ['bandage', 1],
  ],
  storage: [
    ['tent', 0.4],
    ['fishingRod', 0.6],
    ['campfireKit', 0.8],
    ['blanket', 0.6],
    ['plank', 0.6],
    ['plasticPanel', 0.6],
    ['oilBottle', 3],
    ['part:fanbelt', 1.2],
    ['part:sparkplugs', 0.9],
    ['part:oilfilter', 0.9],
    ['part:wheel_RL:offroad', 0.25],
    ['carbKit', 0.1],
    ['jerryCan', 1.2],
    ['waterJug', 1.4],
    ['tyreKit', 0.8],
    ['repairKit', 0.5],
    ['cannedBeans', 1],
  ],
  tools: [
    ['jack', 0.7],
    ['carbKit', 0.25],
    ['part:exhaust:sport', 0.2],
    ['part:wheel_RL:offroad', 0.35],
    ['sprayPaint', 0.8],
    ['sponge', 0.8],
    ['wrench', 2],
    ['oilBottle', 2],
    ['part:alternator', 0.4],
    ['part:starter', 0.35],
    ['part:waterpump', 0.35],
    ['part:sparkplugs', 0.7],
    ['part:oilfilter', 0.7],
    ['tyreKit', 1],
    ['repairKit', 0.7],
    ['lantern', 0.8],
  ],
  shop: [
    ['tent', 0.25],
    ['fishingRod', 0.5],
    ['thermos', 0.6],
    ['campfireKit', 0.8],
    ['cd', 0.6],
    ['cigarettes', 1.2],
    ['coffee', 1.2],
    ['sprayPaint', 0.4],
    ['chips', 3],
    ['chocolate', 3],
    ['jerky', 2],
    ['cannedBeans', 2],
    ['oilBottle', 1.5],
    ['part:fanbelt', 0.5],
    ['part:sparkplugs', 0.4],
    ['part:oilfilter', 0.5],
    ['waterBottle', 2],
  ],
  drinks: [
    ['sodaCan', 4],
    ['waterBottle', 3],
  ],
  counter: [
    ['thermos', 0.4],
    ['ammo38', 0.8],
    ['chocolate', 1],
    ['painkillers', 1],
    ['revolver', 0.2],
  ],
  crate: [
    ['mre', 2],
    ['ammo12', 1.4],
    ['ammo38', 1.2],
    ['medkit', 0.8],
    ['shotgun', 0.25],
    ['waterJug', 1],
  ],
  tent: [
    ['tent', 0.9],
    ['fishingRod', 0.8],
    ['campfireKit', 1.5],
    ['blanket', 1],
    ['mre', 1],
    ['waterBottle', 2],
    ['lantern', 1],
    ['jerky', 1],
  ],
  camp: [
    ['tent', 0.7],
    ['fishingRod', 1.2],
    ['campfireKit', 2],
    ['blanket', 1],
    ['thermos', 0.6],
    ['cd', 0.4],
    ['sodaCan', 2],
    ['waterBottle', 2],
    ['cannedBeans', 1],
    ['jerky', 1],
  ],
  ruin: [
    ['plank', 1],
    ['plywood', 0.6],
    ['steelPlate', 0.3],
    ['ammo38', 0.6],
    ['jerky', 1],
    ['waterBottle', 1],
  ],
  gear: [
    ['steelPlate', 0.9],
    ['steelSheet', 0.5],
    ['plywood', 0.8],
    ['plank', 1],
    ['plasticSheet', 0.5],
    ['roofRack', 1],
    ['roofBox', 0.6],
    ['bullBar', 0.7],
    ['winchBar', 0.45],
    ['jack', 0.6],
    ['rearRack', 0.8],
    ['sandbag', 1.4],
    ['jerryCan', 0.5],
  ],
  wreck: [
    ['steelPlate', 0.4],
    ['cd', 0.9],
    ['jerryCan', 1.2],
    ['oilBottle', 1],
    ['waterBottle', 1],
    ['repairKit', 0.3],
  ],
};

// spawn chance per spot kind (before difficulty multiplier)
export const SPOT_CHANCE = { any: 0.3, kitchen: 0.45, cupboard: 0.35, fridge: 0.55, table: 0.4, small: 0.35, shelf: 0.25, medicine: 0.6, bed: 0.15, clothes: 0.2, couch: 0.15, desk: 0.35, office: 0.4, storage: 0.55, tools: 0.6, shop: 0.5, drinks: 0.5, counter: 0.6, crate: 0.7, tent: 0.6, camp: 0.6, ruin: 0.5, wreck: 0.45, gear: 0.75 };

export function initialState(id, rnd) {
  const d = ITEMS[id];
  const s = {};
  if (d.liquid) {
    const t = d.liquid.type;
    s.liquid = t === 'fuel' && id === 'jerryCan' ? Math.round(d.liquid.cap * (0.15 + rnd() * 0.85) * 10) / 10 : d.liquid.cap * (0.5 + rnd() * 0.5);
    s.liquidType = t;
  }
  if (d.charges) s.charges = d.charges;
  if (d.weapon) s.loaded = Math.floor(rnd() * (d.weapon.mag + 1));
  if (d.variants) s.variant = Math.floor(rnd() * d.variants);
  return s;
}

export function itemMass(id, state) {
  const d = ITEMS[id];
  if (!d) return 1;
  let m = d.mass;
  if (d.liquid && state && state.liquid) m += state.liquid * d.liquid.density;
  return m;
}

// Name shown for a particular item (discs carry their album).
export function itemLabel(id, state = {}) {
  const d = ITEMS[id];
  if (!d) return id;
  if (d.disc) return 'CD: ' + albumName(state.variant || 0);
  if (d.paint) return 'Spray paint · ' + paintOf(state.variant).name;
  return d.name;
}
