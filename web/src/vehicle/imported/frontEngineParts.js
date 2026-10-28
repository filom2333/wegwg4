// Part catalogue shared by the front-engined, water-cooled cars. `o` names the engine, gives
// masses and descriptions; lids: 'hood' is the bonnet over the engine, 'trunk' the boot lid.

export function frontEngineParts(o) {
  const PARTS = {
    chassis: { label: 'Floor pan & subframes', mass: o.chassisMass, requires: [], fixed: true, desc: 'Monocoque floor, subframes and suspension arms.' },
    body: { label: 'Body shell', mass: o.bodyMass, requires: ['chassis'], desc: 'Roof, pillars and inner panels. Everything else hangs on it.' },
    door_FL: { label: 'Front door (left)', mass: o.doorMass, requires: ['body'] },
    door_FR: { label: 'Front door (right)', mass: o.doorMass, requires: ['body'] },
    door_RL: { label: 'Rear door (left)', mass: o.doorMass * 0.85, requires: ['body'] },
    door_RR: { label: 'Rear door (right)', mass: o.doorMass * 0.85, requires: ['body'] },
    hood: { label: 'Bonnet', mass: 14, requires: ['body'], desc: 'Over the engine bay.' },
    trunk: { label: 'Boot lid', mass: 11, requires: ['body'], desc: 'Covers the boot and the spare wheel.' },
    bumper_F: { label: 'Front bumper', mass: 7, requires: ['body'], desc: 'Takes the knocks before the radiator does.' },
    bumper_R: { label: 'Rear bumper', mass: 6, requires: ['body'] },
    headlight_L: { label: 'Headlight (left)', mass: 2.2, requires: ['body'] },
    headlight_R: { label: 'Headlight (right)', mass: 2.2, requires: ['body'] },
    taillight_L: { label: 'Tail light (left)', mass: 0.8, requires: ['body'] },
    taillight_R: { label: 'Tail light (right)', mass: 0.8, requires: ['body'] },
    engine: { label: o.engineLabel, mass: o.engineMass, requires: ['chassis'], needsOpen: 'hood', desc: o.engineDesc },
    radiator: { label: 'Radiator', mass: 6, requires: ['body'], needsOpen: 'hood', desc: 'Water cooling. Keep it topped up with water.' },
    // ancillaries bolted to the engine; the belt runs over the alternator and water pump pulleys
    alternator: { label: 'Alternator', mass: 5.5, requires: ['engine'], needsOpen: 'hood', desc: 'Charges the battery while the engine runs. Without it the car runs on the battery until that is flat.' },
    waterpump: { label: 'Water pump', mass: 2.4, requires: ['engine'], needsOpen: 'hood', desc: 'Pushes the coolant round. A worn one weeps and the engine runs hot; with none the coolant pours out.' },
    starter: { label: 'Starter motor', mass: 4.5, requires: ['engine'], needsOpen: 'hood', desc: 'Turns the engine over. Without one, roll it: key on, a gear in, let it run downhill.' },
    sparkplugs: { label: o.plugs === 6 ? 'Spark plugs & leads (6)' : 'Spark plugs & coils (4)', mass: 0.6, requires: ['engine'], needsOpen: 'hood', desc: 'Worn plugs misfire, lose power and start hard. No plugs, no spark.' },
    oilfilter: { label: 'Oil filter', mass: 0.6, requires: ['engine'], needsOpen: 'hood', desc: 'A clogged one wears the engine; without one the oil pumps out on the road.' },
    fanbelt: { label: 'Accessory belt', mass: 0.3, requires: ['engine', 'alternator', 'waterpump'], needsOpen: 'hood', desc: 'Turns the water pump and the alternator.' },
    airfilter: { label: 'Air filter box', mass: 2, requires: ['engine'], needsOpen: 'hood', desc: 'Keeps dust out of the intake.' },
    exhaust: { label: 'Exhaust', mass: 11, requires: ['engine'] },
    battery: { label: 'Battery 12 V', mass: 15, requires: ['body'], needsOpen: 'hood', desc: 'Starts the engine and powers the lights.' },
    fueltank: { label: `Fuel tank ${o.tank} l`, mass: 12, requires: ['chassis'], desc: 'Under the rear seat.' },
    spare: { label: 'Spare wheel', mass: o.wheelMass, requires: ['body'], needsOpen: 'trunk', desc: 'Fits any corner of this car.' },
    seat_FL: { label: 'Driver seat', mass: 17, requires: ['body'], desc: 'You need it to drive.' },
    seat_FR: { label: 'Passenger seat', mass: 17, requires: ['body'] },
    seat_R: { label: 'Rear bench', mass: 20, requires: ['body'] },
    steeringWheel: { label: 'Steering wheel', mass: 2.5, requires: ['body'], desc: 'Needed to steer.' },
    wheel_FL: { label: 'Wheel (front left)', mass: o.wheelMass, requires: ['chassis'] },
    wheel_FR: { label: 'Wheel (front right)', mass: o.wheelMass, requires: ['chassis'] },
    wheel_RL: { label: 'Wheel (rear left)', mass: o.wheelMass, requires: ['chassis'] },
    wheel_RR: { label: 'Wheel (rear right)', mass: o.wheelMass, requires: ['chassis'] },
  };
  const PART_FAMILY = { wheel_FL: 'wheel', wheel_FR: 'wheel', wheel_RL: 'wheel', wheel_RR: 'wheel', spare: 'wheel' };
  const ASSEMBLY_ORDER = ['chassis', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR', 'fueltank', 'engine', 'starter', 'oilfilter', 'sparkplugs', 'waterpump', 'alternator', 'exhaust', 'fanbelt', 'airfilter', 'body', 'radiator', 'battery', 'spare', 'bumper_F', 'bumper_R', 'headlight_L', 'headlight_R', 'taillight_L', 'taillight_R', 'door_FL', 'door_FR', 'door_RL', 'door_RR', 'hood', 'trunk', 'seat_FL', 'seat_FR', 'seat_R', 'steeringWheel'];
  return { PARTS, PART_FAMILY, ASSEMBLY_ORDER };
}
