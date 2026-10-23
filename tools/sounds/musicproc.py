# Turns the music files from the music sheet (menu_theme, score_*, music_<album>_<n>, haven_<n>,
# jingle_<station>; any format ffmpeg reads) into public/music/: silence trimmed, levelled by one
# gain (songs and IDs -16 LUFS, the menu -18, the background score quieter at -20) with a limiter
# on the peaks, stereo mp3 at 96 kbit/s, and music/index.json listing what is there (see src/audio/music.js).
# Usage: python3 -I musicproc.py <incoming dir> <public/music dir>
import json, os, re, subprocess, sys

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
# the score's file names and the moment each one is for
SCORE = {'score_day_1': 'day', 'score_day_2': 'day', 'score_dawn': 'dawn', 'score_dusk': 'dusk', 'score_night_1': 'night',
         'score_night_2': 'campfire', 'score_rain': 'rain', 'score_north': 'north'}
ALBUMS = ['neon', 'rattlers', 'june', 'salt', 'eddie', 'kr9']

index_path = os.path.join(OUT, 'index.json')
index = json.load(open(index_path)) if os.path.exists(index_path) else {}

def level(name):
    if name.startswith('score_'):
        return -20
    if name == 'menu_theme':
        return -18
    return -16

# silence off both ends
TRIM = ('silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.05,'
        'areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.3,areverse')

def loudness(src):
    # integrated loudness (LUFS) of the trimmed file
    r = subprocess.run(['ffmpeg', '-v', 'info', '-nostats', '-nostdin', '-i', src, '-af', TRIM + ',ebur128', '-f', 'null', '-'], capture_output=True, text=True)
    m = re.findall(r'I:\s+(-?[\d.]+) LUFS', r.stderr)
    return float(m[-1]) if m else -20.0

def convert(src, name):
    # one static gain to the target loudness (no pumping), a limiter keeping peaks under -1 dB
    out = os.path.join(OUT, name + '.mp3')
    gain = level(name) - loudness(src)
    af = f'{TRIM},volume={gain:.2f}dB,alimiter=limit=0.89:level=false'
    subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', src, '-af', af, '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '96k', out], check=True)
    return name + '.mp3'

for fn in sorted(os.listdir(SRC)):
    name, ext = os.path.splitext(fn)
    if ext.lower() not in ('.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus'):
        continue
    name = name.strip().lower().replace(' ', '_').replace('-', '_')
    f = convert(os.path.join(SRC, fn), name)
    if name == 'menu_theme':
        index['menu'] = f
    elif name in SCORE or name.startswith('score_'):
        kind = SCORE.get(name) or re.sub(r'^score_|_\d+$', '', name)
        lst = index.setdefault('score', {}).setdefault(kind, [])
        if f not in lst:
            lst.append(f)
    elif (m := re.match(r'music_(\w+?)_(\d)$', name)) and m.group(1) in ALBUMS:
        lst = index.setdefault('albums', {}).setdefault(m.group(1), [None, None, None])
        lst[int(m.group(2)) - 1] = f
    elif re.match(r'haven_\d+$', name):
        lst = index.setdefault('haven', [])
        if f not in lst:
            lst.append(f)
            lst.sort()
    elif name.startswith('jingle_'):
        index.setdefault('jingles', {})[name[7:]] = f
    else:
        print('not a music sheet name, left out:', fn)
        os.remove(os.path.join(OUT, f))
        continue
    print('ok', fn, '->', f)
json.dump(index, open(index_path, 'w'), indent=1)
