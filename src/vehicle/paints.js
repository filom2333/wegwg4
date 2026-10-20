// Spray-can colours (one can per colour; cars are painted part by part).

export const PAINTS = [
  { name: 'Signal red', hex: 0xa3201c },
  { name: 'Burnt orange', hex: 0xb4542a },
  { name: 'Mustard', hex: 0xc6972d },
  { name: 'Cream', hex: 0xd6c8a2 },
  { name: 'Chalk white', hex: 0xe6e3dc },
  { name: 'Silver', hex: 0xa2a6a9 },
  { name: 'Gunmetal', hex: 0x4a4f55 },
  { name: 'Gloss black', hex: 0x121315 },
  { name: 'Navy', hex: 0x1d2d4c },
  { name: 'Sky blue', hex: 0x5b86b4 },
  { name: 'Racing green', hex: 0x1f4a33 },
  { name: 'Olive drab', hex: 0x5a5d33 },
  { name: 'Chocolate', hex: 0x55361f },
  { name: 'Rose', hex: 0xc26b88 },
  { name: 'Primer grey', hex: 0x7b7e7b },
];

export function paintOf(variant) {
  return PAINTS[((variant || 0) % PAINTS.length + PAINTS.length) % PAINTS.length];
}
