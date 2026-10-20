// What later-built materials need to know about the renderer: whether the frame is
// multisampled (foliage then uses alpha to coverage for soft cut-out edges) and the best
// anisotropic filtering the GPU offers.
export const RENDER_CAPS = { msaa: 0, aniso: 8 };
