// Pulls the track list (file, length, vocals, prompt) out of the music sheet page into jobs.json.
import fs from 'fs';
const html = fs.readFileSync(process.argv[2], 'utf8');
const js = html.slice(html.indexOf('<script>') + 8, html.indexOf('const store = {'));
const GROUPS = new Function(js + '; return GROUPS;')();
const jobs = GROUPS.flatMap((g) => g.items.map((it) => {
  const [m, s] = it.len.split(':').map(Number);
  return { file: it.file, group: g.title, ms: (m * 60 + s) * 1000, vocals: it.vocals, prompt: it.prompt };
}));
fs.writeFileSync(process.argv[3], JSON.stringify(jobs, null, 1));
console.log(jobs.length, 'tracks,', Math.round(jobs.reduce((a, j) => a + j.ms, 0) / 60000), 'min');
