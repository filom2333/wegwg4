// The albums on the CDs found along Route 9 (fictional artists). Rendering lives in arrange.js.

export const ALBUMS = [
  { id: 'neon', artist: 'Desert Neon', title: 'Route 9 Nights', style: 'synthwave', year: 2009, colors: ['#1b0f3a', '#ff4f9a', '#ffb347'], tracks: ['Mileage', 'Neon Mesa', 'After Hours'] },
  { id: 'rattlers', artist: 'The Rattlers', title: 'Dust & Diesel', style: 'rock', year: 2004, colors: ['#2a1a12', '#d9612c', '#f2e2c4'], tracks: ['Gasoline Halo', 'Rattlesnake Road', 'Burnout'] },
  { id: 'june', artist: 'June Calloway', title: 'Lonesome Mile', style: 'country', year: 1998, colors: ['#e9dcc0', '#8a4b2a', '#3c5a6e'], tracks: ['Lonesome Mile', 'Porch Light', 'Last Diner Open'] },
  { id: 'salt', artist: 'Salt Flats', title: 'Heat Mirage', style: 'ambient', year: 2011, colors: ['#dfe7ea', '#9fb7c4', '#f0c9a0'], tracks: ['Mirage I', 'White Distance', 'Evening Glass'] },
  { id: 'eddie', artist: 'Big Eddie Lowe', title: 'Juke Joint Radio', style: 'blues', year: 1979, colors: ['#121a2a', '#c99a3b', '#e8e0cf'], tracks: ['Low Down Highway', 'Busted Radiator Blues', 'Midnight Shuffle'] },
  { id: 'kr9', artist: 'KR-9', title: 'Night Shift', style: 'lofi', year: 2016, colors: ['#22303a', '#7fc4b8', '#f2a65a'], tracks: ['Coffee at 3am', 'Motel Lights', 'Slow Exit'] },
];

// Display name for a disc.
export function albumName(i) {
  const a = ALBUMS[i % ALBUMS.length];
  return `${a.artist} – ${a.title}`;
}
