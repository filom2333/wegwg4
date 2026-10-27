// What later-built materials need to know about the renderer: whether the frame is
// multisampled (foliage then uses alpha to coverage for soft cut-out edges), the best
// anisotropic filtering the GPU offers, and whether depth runs reversed (far = 0).
export const RENDER_CAPS = { msaa: 0, aniso: 8, revZ: true };

// A material laid a hair over another surface (a label round a bottle, a print on a box): drawn a
// few depth steps toward the eye, so the two never fight for the same pixels far off. (three
// turns the factor round for reversed depth; the units are ours to turn.)
export function decal(mat, steps = 4) {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = RENDER_CAPS.revZ ? steps : -steps;
  return mat;
}
