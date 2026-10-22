// The story: what happened out here, told through notes left along the road, radio broadcasts
// and a destination (Haven) far to the north. Notes are handed out in order as you find them, so
// the story reads front to back whichever places you search.

import { STATIONS, EBS_LINES, NUMBERS } from '../audio/stations.js';

export const HAVEN_KM = 150;

export const NOTES = [
  {
    id: 'n01',
    title: 'Note on the kitchen table',
    by: 'R.',
    text: `If you're reading this you made it back to the house. I took the Corolla's spare and the good jack. Don't wait for me.

The radio says Haven is still taking people. North, all the way up the 9. I'll leave notes where I stop so you know I got that far.

Fill every can you find. The pumps that still work won't for long.`,
  },
  {
    id: 'n02',
    title: 'Diner receipt, written on the back',
    by: 'R.',
    text: `Coffee was cold but the grill still lit. Man at the counter said the lights started three weeks ago, out past the salt. Green flashes, then the noise.

He says the things only come out after dark. Says they don't like engines, or light. I asked him why he stays. He didn't answer.

Took two cans of beans. Left money. Habit.`,
  },
  {
    id: 'n03',
    title: 'Page torn from a logbook',
    by: 'Unknown',
    text: `Day 6. Generator dead. Water down to one jug.
Day 7. Heard them walking on the roof again. Kept the lantern lit all night.
Day 8. Ellen says we go north. I say we wait for the Guard.
Day 9. Nobody's coming. Packing the truck.`,
  },
  {
    id: 'n04',
    title: 'Postcard from Haven (unsent)',
    by: 'Mara',
    text: `Dear Mom — they built a wall out of shipping containers and old buses. There's a well, a doctor, kids running around like nothing happened.

They check everyone at the gate. Lights on your face, a long time. Nobody says what they're looking for.

Tell Danny the road is fine in the daytime. Just don't stop at night.`,
  },
  {
    id: 'n05',
    title: 'Note under a windscreen wiper',
    by: 'R.',
    text: `Car died here. Fan belt let go and the engine cooked itself in twenty minutes. Carry a spare belt before the dunes.

I'm walking to the next station. It's maybe ten kilometres. I've done worse.

If you see a red jerry can with my name on it, it's yours.`,
  },
  {
    id: 'n06',
    title: 'Crumpled flyer',
    by: 'Civil Defence',
    text: `NOTICE TO MOTORISTS

Route 9 North remains open to civilian traffic.
Travel during daylight hours only.
Keep headlights on at all times after 6 PM.
Do not approach persons on foot after dark.
Report to Haven checkpoint for screening.

THIS NOTICE SUPERSEDES ALL PREVIOUS NOTICES`,
  },
  {
    id: 'n07',
    title: 'Letter in a motel drawer',
    by: 'T.',
    text: `They're not animals. I watched one for an hour from the bathroom window. It stood in the parking lot looking at the sign. Just looking. Like it remembered something.

When the sun came up it walked into the desert. Didn't run. Walked.

I keep thinking about what it was before.`,
  },
  {
    id: 'n08',
    title: 'Note taped to a gas pump',
    by: 'R.',
    text: `Pump two still works if you prime it. Hold the handle, count to ten.

Got a ride with a couple from Tucson. Good people. Their boy doesn't talk.

Haven is 80 km from here, they say. We'll be there by dark if the car holds.`,
  },
  {
    id: 'n09',
    title: 'Radio log, tower shack',
    by: 'Operator',
    text: `0400 — Haven relay on 98.1 still strong.
0430 — Lost contact with Station 4 (salt flats).
0600 — Two travellers came through. Gave them water and the shotgun.
1900 — Lights out over the flats again. Counted fourteen.
2300 — Something on the ladder. Not answering the door.`,
  },
  {
    id: 'n10',
    title: 'Child\'s drawing',
    by: 'Unsigned',
    text: `A house with a car outside. Big yellow sun. A wall with a gate.
Tall white people standing outside the wall with their arms very long.

On the back, in an adult's hand: "He says they wave at him."`,
  },
  {
    id: 'n11',
    title: 'Note in a glovebox',
    by: 'R.',
    text: `Tucson couple turned back. Said the checkpoint wasn't letting people in anymore. I don't believe it.

I've got the boy. His name is Eli. He holds the flashlight at night and doesn't sleep.

40 km. If I don't make it, Eli, keep driving. Don't stop for anyone.`,
  },
  {
    id: 'n12',
    title: 'Sign at the last station',
    by: 'Haven Gate',
    text: `HAVEN — 20 KM

Gate opens at dawn. Gate closes at sunset.
Vehicles will be searched.
Anyone arriving after dark will wait outside until morning.

WE ARE STILL HERE.`,
  },
];

// Broadcasts heard on the car radio (98.1), unlocked by distance travelled north.
export const BROADCASTS = [
  { km: 0, text: 'This is Haven on 98.1. If you can hear this, drive north on Route 9. Daylight only.' },
  { km: 4, text: '…repeating. Fuel is available at the checkpoint for those who arrive. Bring water.' },
  { km: 12, text: 'Weather service: dust over the dune sea this afternoon. Headlights on, slow down.' },
  { km: 25, text: 'Families arriving today: the Okafors, the Delgados, two from Station 4. Welcome home.' },
  { km: 40, text: '…if you are out there after dark, keep your engine running and your lights on. They don\'t like the light.' },
  { km: 60, text: 'The salt flats relay is down. If anyone passes the tower at mile 40, the door is open. Leave it open.' },
  { km: 80, text: 'Gate hours are dawn to sunset. We can\'t open after dark. I\'m sorry. We can\'t.' },
  { km: 100, text: 'Eli, if you can hear this — R. made it. She\'s at the gate every morning. Keep driving.' },
  { km: 130, text: 'You can see our lights from the ridge. Twenty more minutes. Don\'t stop now.' },
];

export class Story {
  constructor(game) {
    this.game = game;
    this.found = []; // note ids in the order found
    this.heard = new Set();
    this.radioT = 20;
    this.markers = new Set();
    this.ended = false;
  }

  // Next unread note id (for loot spawns), or null when the story is told.
  nextNote() {
    const n = NOTES.find((x) => !this.found.includes(x.id) && !this.pendingSpawn?.has(x.id));
    return n ? n.id : null;
  }

  noteById(id) {
    return NOTES.find((n) => n.id === id);
  }

  collect(id) {
    if (!this.found.includes(id)) this.found.push(id);
    this.game.stats.notesFound = this.found.length;
  }

  km() {
    const g = this.game;
    return Math.max(0, (g.focusPoint().z + g.origin.z) / 1000);
  }

  update(dt) {
    const g = this.game;
    const km = this.km();
    // radio broadcasts while the radio plays
    const car = g.car;
    const on = car && car.radioOn && g.player.seat && car.ignition && car.isInstalled('battery') && car.battery > 0.03 && !(car.stereo && car.stereo.mode === 'cd');
    const station = on ? STATIONS[car.stereo.station ?? 1] : null;
    // the other stations' voices
    if (station && station.kind !== this.lastStation) {
      this.lastStation = station.kind;
      this.voiceT = 1.5;
    }
    if (!station) this.lastStation = null;
    if (station && (station.kind === 'ebs' || station.kind === 'numbers')) {
      this.voiceT = (this.voiceT ?? 1.5) - dt;
      if (this.voiceT <= 0) {
        if (station.kind === 'ebs') {
          this.voiceT = 26;
          this.ebsLine = ((this.ebsLine ?? -1) + 1) % EBS_LINES.length;
          g.audio && g.audio.ebsTone();
          setTimeout(() => g.hud && g.hud.subtitle && g.hud.subtitle('AM 640 · Emergency Broadcast', EBS_LINES[this.ebsLine], 11), 2400);
        } else {
          this.voiceT = 16 + Math.random() * 8;
          const grp = Array.from({ length: 5 }, () => NUMBERS[Math.floor(Math.random() * NUMBERS.length)]);
          const text = grp.map((w) => w[0].toUpperCase() + w.slice(1)).join('. ') + '.';
          g.audio && [0, 0.55, 1.1].forEach((t) => setTimeout(() => g.audio.pip(t > 1), t * 1000));
          setTimeout(() => g.hud && g.hud.subtitle && g.hud.subtitle('FM 88.3', text, 6), 1200);
        }
      }
    }
    if (station && station.kind === 'haven') {
      this.radioT -= dt;
      if (this.radioT <= 0) {
        this.radioT = 45 + Math.random() * 40;
        const b = BROADCASTS.filter((x) => x.km <= km && !this.heard.has(x.km)).pop() || BROADCASTS.filter((x) => x.km <= km)[Math.floor(Math.random() * BROADCASTS.filter((x) => x.km <= km).length)];
        if (b) {
          this.heard.add(b.km);
          g.hud && g.hud.subtitle && g.hud.subtitle('98.1 FM', b.text, 9);
        }
      }
    }
    // milestones
    const step = 10;
    const m = Math.floor(km / step) * step;
    if (m > 0 && !this.markers.has(m)) {
      this.markers.add(m);
      if (m < HAVEN_KM) g.hud && g.hud.toast(`${m} km north · Haven ${HAVEN_KM - m} km`);
    }
    if (!this.ended && km >= HAVEN_KM) {
      this.ended = true;
      g.ui && g.ui.showEnding && g.ui.showEnding();
    }
  }

  serialize() {
    return { found: this.found, heard: [...this.heard], markers: [...this.markers], ended: this.ended, lures: this.game.lures ? this.game.lures.serialize() : null };
  }

  restore(d) {
    if (!d) return;
    this.found = d.found || [];
    this.heard = new Set(d.heard || []);
    this.markers = new Set(d.markers || []);
    this.ended = !!d.ended;
  }
}
