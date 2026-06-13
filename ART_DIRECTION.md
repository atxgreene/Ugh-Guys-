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

## 2. Color palettes — canonical (locked to the faction art-bible)
Primaries match the reference sheet exactly; each faction now also carries a **secondary
accent** + **secondary glow** that the models apply to cloth, banners, armor, and arcana.
- **Covenant Cities** — Covenant Gold `#e8b33a`, Sacred Glow `#ffd56e`, **Temple Blue `#2f6f9f`**
  (banners, shield rondels, pteruges, shawls), Sunbaked Stone `#c9ad7a`, Linen `#f1e5c8`, Cedar `#7a5631`.
- **Watcher Remnant** — Watcher Violet `#9a5cff`, Forbidden Glow `#c08bff`, **Star-Metal Silver
  `#b8b4c9`** (warrior plate), **Sigil Magenta `#d14cff`** (adept & skyfire arcana), Obsidian `#15111f`, Void Blue `#1b2a4a`.
- **Nephilim Clans** — Nephilim Red `#e05533`, Ember Glow `#ff7a4d`, **Dried Blood `#7f241d`**
  (war-kilts, harness straps, drapes), Bone White `#9c8d72`, Charcoal `#211715`, Ash `#6d625c`.
- **World** — basalt → ash → moss → sand ramps per biome (see §6); black flood-water.

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

## 6. Terrain & biomes  **[done]**
Seeded heightmap with mountain borders + two ridge passes, PBR basalt/ash ground
(albedo+normal+roughness), flood-water basins with sky-tinted sheen, fog of war,
buildable-slope test. **Six biome presets** (`BIOMES` in `terrain.js`) — Fertile River
Valley, Ancient Cedar Stands, Basalt Highlands, Nephilim Wasteland, The Watcher Ruins,
Sacred Mountain Foothills — each recolors the ground ramp, weights its own clutter table,
and pairs with a fitting sky mood. Environmental-storytelling props scattered as the
world's history: fallen obelisks, altars, half-buried Nephilim ribcages, colossal broken
blades, boundary stones, dead sacred trees, shattered tablets.
**[planned]** carved rivers with fords + ancient roads (held back to protect base access/balance); cliff faces.

## 7. Buildings  **[done]**
Faction-specific silhouettes (Covenant ziggurat/temple, Watcher spire/gate/pit, Nephilim
hearth/lodge/den), masonry PBR, claim-glow discs, living smoke/sparks, collapse FX,
team-color glow accents. **Construction:** structures now rise within a timber **scaffold**
(corner poles + lashing beams + planks) that drops in a puff of dust on completion.
**Damage stages:** at <66% HP a building gains charred scorch chunks and a slight lean;
at <34% it catches **fire** (flickering flame cluster) and smokes heavily — all per-instance
so shared materials are never mutated. **[planned]** prop dressing (grain sacks, ox carts,
waving banners); per-building night braziers as real point-lights.

## 8. Units  **[done]**
Fully redesigned, anatomically detailed per-class meshes with distinct silhouettes and
materials — each built once and clone()'d per spawn so the detail is nearly free:
- **Covenant** — Laborer (hunched, mattock + back-basket), Bronze Spearman (crested helm,
  round shield, spear, pteruges kilt), Sling-Archer (light tunic, whirling sling, quiver),
  War Chariot (two maned horses, spoked wheels, driver + reins), Temple Guard (tower shield,
  glaive, winged halo helm), Prophet (layered robe, halo ring, flame staff + summoned fire).
- **Watchers** — Star-Metal Warrior (faceted plate, shoulder spikes, greatsword, glowing
  seams), Adept (hooded, crossed sigil rings, sigil orb), Skyfire Caster (orbiting glyph
  rings + captive star on a raised staff), Nephilim Hybrid (winged, horned beast-skull,
  clawed, glowing chest).
- **Nephilim** — Raider (lean, topknot, war-axe), Bone-Club Champion (bone pauldrons +
  horns, fur kilt, huge club), War Beast (spined tusked quadruped), Mountain Giant (towering,
  craggy, boulder pauldron, ripped-tree club, rune-slab, glowing eyes), Clan Shaman (antlered
  skull headdress, hide cloak, ember skull-staff). Neutral Devourer (hexapod, gaping toothed maw, many eyes).
Plus smooth turning, run-lean/bob, idle breathing, attack wind-up, harvest swing, selection
rings, death topple + debris; giants get larger dust + screen shake.
**[planned]** hero/commander units with unique silhouettes; per-limb attack animation.

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
5. ✅ Biome presets (6 lands, each with palette + clutter + paired mood)
6. ✅ Cinematic intro flyover, faction cards & end-game camera
7. ✅ Resource-gather particles + worker harvest animation
8. ✅ Building construction scaffolds + damage/fire stages
9. ⏳ Prop dressing (grain sacks, carts, waving banners)
10. ⏳ Carved rivers/roads/cliffs (balance-careful)
11. ⏳ Instancing/LOD pass for scale

## 15. Code map
`game.js` engine + atmosphere/lighting/sky/FX • `fx.js` particle pools • `models.js`
meshes & doodads • `textures.js` procedural PBR • `terrain.js` map/biome/fog •
`pathfinding.js` clearance A* • `controls.js` camera/shake/input • `ui.js` HUD • `data.js` lore/stats.
