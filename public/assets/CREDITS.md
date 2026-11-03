# E1 – Equation 1: asset credits

All textures and sky images in this folder come from **Poly Haven** (https://polyhaven.com)
and are released under the **CC0 license** (public domain: free to use for anything,
no attribution required). Thank you, Poly Haven!

| File | Poly Haven asset | Used for |
|---|---|---|
| textures/asphalt_track_* | asphalt_track | Race track road surface |
| textures/sparse_grass_* | sparse_grass | Grass |
| textures/gravel_* | gravel | Gravel traps outside corners |
| textures/concrete_floor_* | concrete_floor | Concrete walls, pit lane, paths |
| textures/aerial_sand_* | aerial_sand | Desert Loop ground |
| textures/aerial_rocks_02_* | aerial_rocks_02 | Mountain Pass hills and rocks |
| sky/kloofendal_48d_partly_cloudy_puresky.hdr | kloofendal_48d_partly_cloudy_puresky | Day sky and lighting |
| sky/qwantani_sunset_puresky.hdr | qwantani_sunset_puresky | Sunset sky and lighting |
| sky/qwantani_night_puresky.hdr | qwantani_night_puresky | Night sky |

`_diff` = color picture, `_nor` = "normal map" (fakes small bumps so the surface catches light).
The textures were downloaded at 1K size and saved smaller so the game loads faster.

### How to add more Poly Haven textures yourself
1. Go to https://polyhaven.com/textures and click a texture you like.
2. Choose **1K** and **JPG**, then download the **Diffuse** and **Normal (GL)** files.
3. Put them in `public/assets/textures/` named like `mytexture_diff.jpg` and `mytexture_nor.jpg`.

Everything else in the game (cars, stickers, sponsor names, buildings, crowds, sounds)
is made by the game's own code. All sponsor names are invented for E1.
