# Second pass: concrete, exclusive prompts for the sounds that came out tinkly, ringing, busy or
# unsteady; three candidates of each, picked afterwards by their features.
import json, sys
NO = 'no metal clinking, no glass, no jingling, no ringing, no music'
P = [
 ('pickup', 0.5, False, f'A hand quickly picks up a small cardboard box from a wooden table: one soft short scuff of cardboard and skin, dry close-up foley, {NO}'),
 ('pocket', 0.6, False, f'Stuffing a small item into a canvas backpack: one short soft fabric rustle, muffled, dry close-up foley, no zipper, {NO}'),
 ('pickupHeavy', 0.8, False, f'A heavy car part lifted off a dusty concrete floor: one low dull scrape and a soft muffled thud, dry close-up foley, no clatter, no voice, {NO}'),
 ('click', 0.5, False, 'One single short dry click of a plastic switch on a car dashboard, close-up, no echo, no ringing, no other sounds'),
 ('ratchet', 0.5, False, 'One short burst of a socket wrench ratchet turning a bolt: three quick dry tight clicks, close-up foley, muted, no ringing, no other sounds'),
 ('install', 1.0, False, f'A heavy car part pushed into place on an engine: one solid dull muffled clunk, close-up foley, dry, no clatter, no tools dropping, {NO}'),
 ('remove', 1.0, False, f'A heavy car part pulled free from an engine: a short dull scrape and a soft muffled clunk, close-up foley, dry, no clatter, no tools dropping, {NO}'),
 ('keys', 0.8, False, 'A car ignition key turned in the lock: one short dry mechanical click-clack, close-up, no keyring rattle, no jingling, no ringing, no other sounds'),
 ('tick', 0.5, False, 'One faint dull tick of a hot car exhaust pipe contracting as it cools, a single tiny muffled knock, very short, close, no ringing, no other sounds'),
 ('ping', 0.5, False, 'A small pebble thrown up by a tyre knocks once against the underside of a car: one short dull tock with a slight metallic edge, no ringing, no other sounds'),
 ('squeak', 0.5, False, 'An old car suspension creaks once going over a bump: one short low rubbery creak, dry, not musical, no squeal, no other sounds'),
 ('floorCreak', 0.6, False, 'One slow low creak of an old wooden floorboard under a boot: a single smooth creak, dry indoor, not musical, no stutter, no squeal, no other sounds'),
 ('hitMetal', 0.5, False, 'A crowbar hits a rusty car door: one heavy dull thunk of thick dented sheet steel, short and damped, no ringing, no bell tone, no clang tail'),
 ('hitFlesh', 0.5, False, 'A single hard punch to a body: one short dull smack of a fist on a leather jacket, close-up foley, dry, no echo, no rumble'),
 ('drink', 1.5, False, 'A man takes two gulps of water from a plastic bottle: wet swallowing sounds and a soft plastic crackle, close-up, no glass, no clinking, no music'),
 ('eat', 1.5, False, 'A man bites into a dry cracker and chews a few times: crisp crunch and soft chewing, close-up mouth foley, no utensils, no clinking, no music'),
 ('reloadRevolver', 1.8, False, 'A revolver reloaded: the cylinder clicks open, cartridges slide quietly into the chambers with soft dull clicks, the cylinder snaps shut, close-up, dry, no dropped shells, no jingling, no ringing'),
 ('chime', 2.0, False, 'A hollow wooden bamboo wind chime knocking softly in a light breeze: a few low gentle wooden clonks, distant, no glass, no metal bells, no tinkling, no music'),
 ('wind', 20.0, True, 'Steady dry wind blowing across open desert scrubland, airy hiss through dry grass and bushes, continuous, no microphone rumble, no birds, no voices, no music'),
 ('tyreRoll', 8.0, True, 'Constant tyre road noise of a car driving at a steady 60 km/h on rough asphalt, steady rumble and hiss at an unchanging level, no engine, no wind, no music'),
 ('skid', 3.0, True, 'Continuous tyre squeal of a car skidding on asphalt: one sustained unchanging screech at a constant level, no crash, no engine, no music'),
]
jobs = []
for name, dur, loop, text in P:
    for c in (1, 2, 3):
        jobs.append({'file': f'{name}_c{c}', 'name': name, 'text': text, 'dur': dur, 'loop': loop, 'pi': 0.75})
json.dump(jobs, open(sys.argv[1], 'w'), indent=1)
print(len(jobs), 'jobs,', sum(j['dur'] for j in jobs), 's')
