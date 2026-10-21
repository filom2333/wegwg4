// What the car radio can pick up out here. Music stations play the albums "live": what is on
// depends on the time of day, so tuning in lands you mid-song. 98.1 is Haven's own broadcast
// (the story's bulletins between slow plucked music), 640 AM the emergency system on a loop, and
// at 88.3 someone reads numbers into the static.

export const STATIONS = [
  { id: 'numbers', freq: 'FM 88.3', name: '· · ·', kind: 'numbers' },
  { id: 'haven', freq: 'FM 98.1', name: 'HAVEN', kind: 'haven' },
  { id: 'kdrt', freq: 'FM 101.7', name: 'KDRT ROCK', kind: 'music', albums: [1, 0, 4] },
  { id: 'klow', freq: 'FM 104.5', name: 'KLOW', kind: 'music', albums: [2, 3, 5] },
  { id: 'ebs', freq: 'AM 640', name: 'EMERGENCY', kind: 'ebs' },
];

export const EBS_LINES = [
  'This is the Emergency Broadcast System. This is not a test. Residents of the southern counties are advised to travel north on Route 9 to the Haven relief zone.',
  'Do not travel after dark. Keep your headlights on. Do not stop for anyone on the road.',
  'Fuel is rationed at Haven. Bring what you can carry. Vehicles must be in running order at the gate.',
  'Boil all water before drinking. Avoid the salt flats and the dry lakes.',
  'If you are hearing this message, keep heading north. Stay on the paved road.',
];

export const NUMBERS = ['four', 'seven', 'two', 'nine', 'zero', 'six', 'one', 'eight', 'three', 'five'];

// Which album and track a music station is playing at a game time (seconds), and how far in.
export function stationProgram(st, seconds) {
  const SLOT = 210;
  const slot = Math.floor(seconds / SLOT);
  const album = st.albums[slot % st.albums.length];
  const track = (slot * 7 + st.id.length) % 3;
  return { slot, album, track, pos: seconds - slot * SLOT };
}
