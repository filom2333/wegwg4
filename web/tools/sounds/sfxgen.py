# Generates the job list through the ElevenLabs sound-generation API (key from EL_KEY), four at a
# time, skipping files already made; logs one line per job and stops early when credits run low.
import json, os, sys, subprocess, threading
from concurrent.futures import ThreadPoolExecutor
D = sys.argv[1]
jobs = json.load(open(os.path.join(D, 'jobs.json')))
K = os.environ['EL_KEY']
lock = threading.Lock()
stop = False

def credits():
    r = subprocess.run(['curl', '-sS', '-m', '20', '-H', 'xi-api-key: ' + K, 'https://api.elevenlabs.io/v1/user/subscription'], capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
        return d['character_limit'] - d['character_count']
    except Exception:
        return None

def run(j):
    global stop
    out = os.path.join(D, 'raw', j['file'] + '.mp3')
    if stop or (os.path.exists(out) and os.path.getsize(out) > 2000):
        return
    body = {'text': j['text'], 'duration_seconds': j['dur'], 'prompt_influence': j.get('pi', 0.55), 'model_id': 'eleven_text_to_sound_v2'}
    if j['loop']:
        body['loop'] = True
    for attempt in range(3):
        r = subprocess.run(['curl', '-sS', '-m', '150', '-o', out + '.part', '-w', '%{http_code}', '-H', 'xi-api-key: ' + K, '-H', 'Content-Type: application/json', '-X', 'POST',
                            'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', '-d', json.dumps(body)], capture_output=True, text=True)
        code = r.stdout.strip()
        if code == '200':
            os.replace(out + '.part', out)
            break
        err = open(out + '.part', 'rb').read()[:300] if os.path.exists(out + '.part') else b''
        with lock:
            print('FAIL', j['file'], code, err.decode('utf8', 'replace'), flush=True)
        if code in ('401', '402', '403') or b'quota' in err or b'credits' in err:
            stop = True
            return
    with lock:
        print('ok', j['file'], os.path.getsize(out) if os.path.exists(out) else 0, flush=True)

print('credits at start', credits(), flush=True)
with ThreadPoolExecutor(4) as ex:
    for i in range(0, len(jobs), 12):
        list(ex.map(run, jobs[i:i + 12]))
        c = credits()
        print('-- after', i + 12, 'credits left', c, flush=True)
        if c is not None and c < 400:
            print('low on credits, stopping', flush=True)
            break
print('done', flush=True)
