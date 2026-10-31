# Building textures

CC0 scans from [Poly Haven](https://polyhaven.com), fetched with `tools/blender/fetch_textures.py`
at 1k and re-encoded by `tools/build/pack_building.py` (colour and normal 1024, AO/roughness/metal
512). Each scan: `<id>_diff.jpg` (colour), `<id>_nor.jpg` (OpenGL normal), `<id>_arm.jpg`
(AO, roughness, metalness). Used by `scripts/world/places/BuildingMaterials.cs`.

| Scan | Authors | Size of one repeat | Used as |
| --- | --- | --- | --- |
| weathered_plank_siding | Dimitrios Savva | 1.57 m | painted siding |
| white_stucco_02 | Dimitrios Savva | 1.8 m | stucco |
| plastered_wall_04 | Rob Tuytel | 3.2 m | inside walls |
| white_plaster_02 | Rob Tuytel | 1 m | ceilings |
| decrepit_wallpaper | Rob Tuytel | 2.5 m | wallpaper |
| old_linoleum_flooring_01 | Charlotte Baglioni | 1.99 m | kitchen floors |
| wood_floor_worn | Dimitrios Savva | 2 m | floorboards |
| interior_tiles | Charlotte Baglioni | 1.9 m | bathroom tiles |
| large_red_bricks | Rob Tuytel | 2 m | brick |
| clay_plaster | Amal Kumar | 2 m | adobe |
| corrugated_iron | Jenelle van Heerden, Dimitrios Savva | 1.12 m | corrugated iron |
| rusty_corrugated_iron | Charlotte Baglioni | 2 m | rusted iron roofs |
| grey_roof_01 | Rob Tuytel | 8 m | shingles |
| clay_roof_tiles_02 | Amal Kumar | 2.5 m | roof tiles |
| weathered_planks | Dario Barresi, Dimitrios Savva | 2 m | planks, wood |
| garage_floor | Jenelle van Heerden | 1.89 m | garage floors |
| dirty_carpet | Rohit Seervi | 0.6 m | rugs |
| wood_cabinet_worn_long | Dimitrios Savva, Rico Cilliers | 1 x 0.5 m | veneer |
| white_planks_clean | Rob Tuytel | 1.8 m | painted trim |
