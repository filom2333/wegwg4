# Builds the generation job list from the sound sheet page (names, lengths, prompts, loops, variants).
import re, json, sys
html = open(sys.argv[1]).read()
jobs = []
def secs(s):
    m = re.match(r'([\d.]+)', s)
    return max(0.5, min(22.0, float(m.group(1)))) if m else 3.0
for m in re.finditer(r"S\('([^']+)', '([^']+)', '((?:[^'\\]|\\.)*)', '[^']*'(?:, \{([^}]*)\})?\)", html):
    name, ln, prompt, opts = m.group(1), m.group(2), m.group(3), m.group(4) or ''
    loop = 'loop: true' in opts
    n = int(re.search(r'n: (\d+)', opts).group(1)) if 'n:' in opts else 1
    for i in range(n):
        jobs.append({'file': name + (f'_{i+1}' if n > 1 else ''), 'name': name, 'text': prompt, 'dur': secs(ln), 'loop': loop})
steps = re.findall(r"STEP\('([^']+)', '([^']+)'\)", html)
for s, d in steps:
    jobs.append({'file': 'step_' + s, 'name': 'step_' + s, 'text': f'Four separate footsteps of a man in leather work boots walking on {d}, evenly spaced with short gaps, close-up foley, dry, no reverb, no music', 'dur': 3.0, 'loop': False})
order = ['engine_', 'starter', 'engineStart', 'stall', 'wind', 'rain', 'tyreRoll', 'skid', 'doorOpen', 'doorClose', 'hood', 'trunk', 'crash', 'step_', 'cicadas', 'crickets', 'crackle', 'stream', 'pant', 'breath', 'heartbeat', 'hurt', 'revolver', 'shotgun']
def rank(j):
    for i, p in enumerate(order):
        if j['file'].startswith(p): return i
    return len(order)
jobs.sort(key=rank)
json.dump(jobs, open(sys.argv[2], 'w'), indent=0)
print(len(jobs), 'jobs,', round(sum(j['dur'] for j in jobs)), 's of audio')
