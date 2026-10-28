# Scatter models

Made by `tools/blender/scans.py` from Poly Haven scans (CC0, https://polyhaven.com): each scan cut
down to a game mesh (about 2600 triangles, and 380 for further off) with its colour, relief,
roughness and occlusion baked onto its own UV layout. The sources are fetched with
`tools/blender/fetch_polyhaven.py` (2k glTF).

| Species | Variants (Poly Haven asset / object) |
| --- | --- |
| boulder | namaqualand_boulder_03, namaqualand_boulder_04, namaqualand_boulder_05, boulder_01 |
| slab | namaqualand_rocks_01 (rock b), stone_01, rock_09 — laid flat |
| mossrock | rock_moss_set_01 (rock03), rock_moss_set_02 (rock12, rock11) |
| snowrock | namaqualand_boulder_06, rock_moss_set_01 (rock05, rock04) |
| pebble | namaqualand_rocks_01 (rocks a, c), namaqualand_stones_01 (stone e) |
| stump | tree_stump_01, tree_stump_02 |
| log | dead_tree_trunk_02, dead_tree_trunk |
| fern | fern_02 (ferns b, c, a), the scan's own mesh and textures |

## Grown plants

Grass, meadow and snow grass, reeds, flowers, sagebrush and dwarf birch shrubs, yuccas, barrel
cacti, saguaros, ocotillos, Joshua trees, dead trees, pines, spruces and birches are grown by
`tools/blender/plants.py` (seeded, every variant different), with leaves and needles on twig cards
modelled and rendered by `tools/blender/twigs.py`. Bark: Poly Haven `pine_bark` (pines, greyed for
spruces) and `bark_willow_02` (shrubs, Joshua trees, ocotillos, dead trees), CC0, in
`assets/textures/plants/` (fetched with `tools/blender/fetch_textures.py`); birch bark and cactus
skins are painted by `plants.py`.
