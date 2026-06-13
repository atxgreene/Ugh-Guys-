# Art Direction — Shadow of the Watchers

A premium ancient-apocalyptic RTS set in the last age before the Flood: bronze-age
civilization pushed to mythic scale, corrupted by the forbidden knowledge of the
Watchers. StarCraft readability, Total War battlefield atmosphere, Hades-grade
lighting drama. No medieval fantasy, no cartoon.

This document is both the realized spec and the forward roadmap. **[done]** marks
what is implemented in code today; **[planned]** marks the next passes.

---

## 1. Art direction summary
Sacred ancient realism on readable low-poly forms. Dark obsidian-and-dust world
where light is the storyteller: warm sacred fire, cool Watcher sigils, ember-red
omen-light. Every faction reads by silhouette and a single signature glow color.
Atmosphere over detail — the world should feel doomed and beautiful, never noisy.

## 2. Color palettes
- **Covenant Cities** — sand, clay-red, ochre, reed-tan, bronze, gold sacred fire (`#e8b33a`).
- **Watcher Remnant** — black basalt, burnished gold, deep blue, copper-green, violet sigil-fire (`#9a5cff`).
- **Nephilim Clans** — ash gray, dried-blood red, bone, tarnished bronze, ember red (`#e05533`).
- **World** — basalt `#2a2a33`→ash `#595449`, moss `#44524a`, sand `#6b5e4c`, black flood-water.

## 3. Lighting system  **[done]**
- Per-match **time-of-day mood preset** — `dawn / noon / dusk / night / storm` (weighted to dusk & storm). Each drives sun color+intensity, hemisphere fill, cool rim light, fog color+density, sky gradient, env-map tint, and tone-map exposure together. (`TIME_PRESETS` in `game.js`.)
- Warm key sun + **cool rim/back light** tracking the view for hero-pop; soft 3072² shadows.
- **Image-based lighting** from a procedural sky env-map (bronze & star-metal reflect).
- Cinematic grade pass: vignette, contrast, saturation. Bloom on all sacred fire/sigils.
- **[planned]** god-rays at sacred sites; localized red storm-glow over corrupted zones; per-foundry point-light pools (currently emissive+bloom stand-ins).

## 4. Sky & Flood foreshadowing  **[done]**
Gradient sky dome, drifting **storm cloud wall**, **distant lightning** flashes (storm
preset), far **rain curtain**, **lunar halo** (night/dawn), starfield, doomed red horizon
star. **[planned]** moving cloud shadows, aurora for Watcher-dominant maps.

## 5. VFX system  **[done]**
Pooled GPU particles (`fx.js`, one draw call each): **marching/footstep dust**,
**giant footfall dust + screen shake**, **chimney/forge smoke**, **forge sparks**,
**damage smoke + embers** when a building drops below 50% HP, **construction dust**,
**collapse dust/smoke burst + camera shake**. Projectile trails, AoE rings, death
debris already present. **[planned]** bronze weapon glints, ritual light pulses on
ability use, river shimmer, arrow fletching trails.

## 6. Terrain & biomes
**[done]** seeded heightmap with mountain borders + two ridge passes, PBR basalt/ash
ground (albedo+normal+roughness), flood-water basins, fog of war, buildable-slope test.
Environmental-storytelling props scattered with the world's history: **fallen obelisks,
abandoned altars, half-buried Nephilim ribcages, colossal broken blades, inscribed
boundary stones, dead sacred trees, shattered tablets** (`buildDoodad`).
**[planned]** distinct biome presets (cedar forest, basalt highland, Nephilim wasteland,
sacred foothills) each pairing a mood preset with clutter + resource-placement rules;
rivers with fords; ancient roads between sites.

## 7. Buildings
**[done]** faction-specific silhouettes (Covenant ziggurat/temple, Watcher spire/gate/pit,
Nephilim hearth/lodge/den), masonry PBR, eased grow-in construction, claim-glow discs,
living smoke/sparks, damage-state smoke, collapse FX, team-color glow accents.
**[planned]** explicit 2–3 stage construction scaffolds; cracked damage meshes; per-building
night braziers; small prop dressing (grain sacks, ox carts, banners that wave).

## 8. Units
**[done]** distinct per-class procedural meshes, faction body tint + glow accent, smooth
shortest-arc turning, run-lean + bob, attack lunge, selection rings, death topple+debris,
giants scaled with larger dust + shake. **[planned]** draw/release archer poses, brace-before-
swing for heavy melee, waving cloth/banners, hero/commander units with unique silhouettes.

## 9. Movement & barrier interaction  **[done]**
LoL-smooth: collision **wall-sliding**, radius/clearance-aware pathfinding with tight-route
fallback, **stuck-detection by net progress** (re-route → perpendicular slip → graceful
give-up), crowd-aware arrival, size-scaled formation spacing. Verified: 24-unit cross-map
treks incl. giants resolve with zero frozen units.

## 10. Camera  **[done]** eased pan/zoom/rotate, steeper pitch when zoomed, impact shake on
giant footfalls & collapses. **[planned]** opening flyover, victory pan, defeat flood scene, faction intro cards.

## 11. UI / HUD  **[done]** bronze-trim + carved-stone reskin: topbar lintel with bronze
border-image, command panel as a stone slab, **minimap as a bronze-rimmed tablet**, carved
command buttons, bronze toasts. **[planned]** parchment texture fills, carved glyph icons
replacing emoji, tech-tree view, victory/defeat art.

## 12. Asset prompt library (for any future external art)
> "Hyper-realistic ancient antediluvian RTS game asset — Mesopotamian / Levantine /
> megalithic bronze-age material culture, cinematic museum lighting, strong top-down RTS
> silhouette, readable from distance, detailed but not noisy, weathered stone / bronze /
> clay / cedar / dust, sacred geometry, pre-flood apocalyptic atmosphere, no medieval
> fantasy, no cartoon."

## 13. Technical / performance  **[done]** single-draw-call particle pools, shared geometries
& cached materials, procedural textures (no downloads), MSAA bloom target, **automatic
quality fallback** (drops bloom/shadows/pixel-ratio under sustained slow frames).
**[planned]** InstancedMesh for trees/props & repeated units, LODs, building mesh merging.

## 14. Highest-impact upgrades, in order
1. ✅ Movement smoothness (gameplay-breaking → fixed first)
2. ✅ Lighting + mood presets + sky (biggest "not a prototype" lever)
3. ✅ Living VFX (smoke/dust/sparks/shake) + env storytelling props
4. ✅ Bronze/stone HUD reskin
5. ⏳ Biome presets & richer terrain (rivers, roads, cliffs)
6. ⏳ Building construction/damage stages + prop dressing
7. ⏳ Cinematic intro flyover & end-game camera
8. ⏳ Instancing/LOD pass for scale

## 15. Code map
`game.js` engine + atmosphere/lighting/sky/FX • `fx.js` particle pools • `models.js`
meshes & doodads • `textures.js` procedural PBR • `terrain.js` map/biome/fog •
`pathfinding.js` clearance A* • `controls.js` camera/shake/input • `ui.js` HUD • `data.js` lore/stats.
