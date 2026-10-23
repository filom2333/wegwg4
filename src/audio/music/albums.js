// The albums on the CDs found along Route 9 (fictional artists). Each track is a recording in
// public/music/ (music/index.json: albums.<id>[track]).

export const ALBUMS = [
  { id: 'neon', artist: 'Desert Neon', title: 'Route 9 Nights', style: 'synthwave', year: 2009, colors: ['#1b0f3a', '#ff4f9a', '#ffb347'], tracks: ['Mileage'] },
  { id: 'rattlers', artist: 'The Rattlers', title: 'Dust & Diesel', style: 'rock', year: 2004, colors: ['#2a1a12', '#d9612c', '#f2e2c4'], tracks: ['Gasoline Halo'] },
  { id: 'june', artist: 'June Calloway', title: 'Lonesome Mile', style: 'country', year: 1998, colors: ['#e9dcc0', '#8a4b2a', '#3c5a6e'], tracks: ['Lonesome Mile'] },
  { id: 'salt', artist: 'Salt Flats', title: 'Heat Mirage', style: 'ambient', year: 2011, colors: ['#dfe7ea', '#9fb7c4', '#f0c9a0'], tracks: ['Mirage I'] },
  { id: 'eddie', artist: 'Big Eddie Lowe', title: 'Juke Joint Radio', style: 'blues', year: 1979, colors: ['#121a2a', '#c99a3b', '#e8e0cf'], tracks: ['Low Down Highway'] },
  { id: 'kr9', artist: 'KR-9', title: 'Night Shift', style: 'lofi', year: 2016, colors: ['#22303a', '#7fc4b8', '#f2a65a'], tracks: ['Coffee at 3am'] },
];

// A track number that exists on the album (saves may hold one from before).
export function trackOn(album, track) {
  const a = ALBUMS[album % ALBUMS.length];
  return ((track % a.tracks.length) + a.tracks.length) % a.tracks.length;
}

// Display name for a disc.
export function albumName(i) {
  const a = ALBUMS[i % ALBUMS.length];
  return `${a.artist} – ${a.title}`;
}
