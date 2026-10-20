// Part table helpers shared by every car type.

// The lid a part is reached through, if any.
export function lidOf(parts, id) {
  return (parts[id] && parts[id].needsOpen) || null;
}

export function dependentsOf(parts, id) {
  return Object.entries(parts)
    .filter(([, p]) => p.requires.includes(id))
    .map(([k]) => k);
}
