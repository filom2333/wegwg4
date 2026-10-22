# Generates music sheet tracks through the ElevenLabs music API (key from EL_KEY), one at a time
# in the order given, logging what each track cost in credits, and stops before the credits fall
# under a reserve. Usage:
#   EL_KEY=... python3 -I musicgen.py <jobs.json> <out dir> <reserve credits> <file> [<file> ...]
import json, os, subprocess, sys, time

JOBS, OUT, RESERVE = sys.argv[1], sys.argv[2], int(sys.argv[3])
ORDER = sys.argv[4:]
K = os.environ['EL_KEY']
jobs = {j['file']: j for j in json.load(open(JOBS))}
os.makedirs(OUT, exist_ok=True)

def credits():
    r = subprocess.run(['curl', '-sS', '-m', '20', '-H', 'xi-api-key: ' + K, 'https://api.elevenlabs.io/v1/user/subscription'], capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
        return d['character_limit'] - d['character_count']
    except Exception:
        return None

def generate(j, out):
    body = {'prompt': j['prompt'], 'music_length_ms': j['ms']}
    if not j['vocals']:
        body['force_instrumental'] = True
    for attempt in range(2):
        r = subprocess.run(['curl', '-sS', '-m', '600', '-o', out + '.part', '-w', '%{http_code}', '-H', 'xi-api-key: ' + K, '-H', 'Content-Type: application/json',
                            '-X', 'POST', 'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', '-d', json.dumps(body)], capture_output=True, text=True)
        code = r.stdout.strip()
        if code == '200':
            os.replace(out + '.part', out)
            return code, b''
        err = open(out + '.part', 'rb').read()[:400] if os.path.exists(out + '.part') else b''
        # an older API without the instrumental switch: once more without it
        if code == '422' and b'force_instrumental' in err:
            body.pop('force_instrumental', None)
            continue
        return code, err
    return code, err

left = credits()
print('credits at start', left, flush=True)
for f in ORDER:
    j = jobs[f]
    out = os.path.join(OUT, f + '.mp3')
    if os.path.exists(out) and os.path.getsize(out) > 10000:
        continue
    t0 = time.time()
    code, err = generate(j, out)
    now = credits()
    cost = (left - now) if left is not None and now is not None else None
    if code != '200':
        print('FAIL', f, code, err.decode('utf8', 'replace'), flush=True)
        if code in ('401', '402', '403') or b'quota' in err or b'credits' in err:
            break
        continue
    print(f'ok {f} {j["ms"] // 1000}s in {time.time() - t0:.0f}s, cost {cost}, left {now}', flush=True)
    left = now
    if left is not None and cost and left - cost < RESERVE:
        print('next track would go under the reserve, stopping', flush=True)
        break
print('done, credits left', credits(), flush=True)
