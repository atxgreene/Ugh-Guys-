# Shadow of the Watchers

> An ancient-apocalyptic, browser-based real-time strategy game. Command one of three asymmetric factions across a mythic, pre-flood wasteland — build an economy, raise an army, and shatter your enemy before they shatter you.

[![Deploy](https://github.com/atxgreene/Ugh-Guys-/actions/workflows/deploy.yml/badge.svg)](https://github.com/atxgreene/Ugh-Guys-/actions/workflows/deploy.yml)
![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=three.js&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![License: CC0-1.0](https://img.shields.io/badge/License-CC0%201.0-lightgrey.svg)
![Assets](https://img.shields.io/badge/assets-100%25%20procedural-orange)

**[▶ Play it in your browser](https://atxgreene.github.io/Ugh-Guys-/)**

---

## Overview

Shadow of the Watchers is a complete, StarCraft-style RTS built from scratch with **Three.js** and **Vite** — set in a mythic, pre-flood world of fallen Watchers, giant clans, and bronze-age city-states. There is no game engine, no external art, no audio files, and no copyrighted IP — only the genre's bones: a worker economy, fog of war, tech trees, asymmetric factions, and an AI that comes for your base. Every model, every sound, and the entire map are generated procedurally in code.

## The Three Factions

Each faction is genuinely asymmetric — different units, buildings, upgrade trees, costs, and a distinct path to victory.

| Faction | Identity | Plays toward |
| --- | --- | --- |
| **The Covenant Cities** | Priest-king city-states | Balanced economy, defense, and counters |
| **The Watcher Remnant** | Disciples of the fallen Watchers | Elite units and forbidden tech |
| **The Nephilim Clans** | Giant-blooded raiders | Brutal melee and base-breaking |

## Features

- **Asymmetric 3-faction design** — unique rosters, buildings, and balance per faction
- **Full economy & production** — resource gathering, build queues, tech upgrades, supply
- **A* pathfinding** with line-of-sight smoothing and soft, physics-based unit separation
- **Fog of war** — persistent discovery with real-time visibility and minimap integration
- **Procedural terrain** — deterministic noise, flattened base sites, a central ridge with passes, and mountainous borders
- **Reactive AI opponent** — manages workers, follows build orders, scouts, defends, and escalates attacks
- **Procedural low-poly models** with emissive accents for faction identity
- **Synth audio** — UI and combat sounds generated live via the WebAudio API (zero audio files)
- **Neutral guard posts** — leashed units that defend resource nodes, then return home

## Controls

| Input | Action |
| --- | --- |
| **Left-click** | Select a unit or building |
| **Left-click + drag** | Box-select your units |
| **Right-click** | Move / attack / issue order |
| **Arrow keys** or **screen edge** | Pan the camera |
| **Mouse wheel** | Zoom |
| **Ctrl + number** | Assign a control group |
| **Number** | Recall a control group |
| **Command hotkeys** | Build, train, and attack-move (shown on the HUD) |

## Run locally

```bash
git clone https://github.com/atxgreene/Ugh-Guys-.git
cd Ugh-Guys-
npm install
npm run dev      # Vite prints a local URL to open
```

Build a production bundle:

```bash
npm run build    # outputs static files to dist/
npm run preview  # serve the built bundle locally
```

The build output in `dist/` is plain static files, so it also deploys to Vercel, Netlify, or any static host.

## Project structure

| Path | Responsibility |
| --- | --- |
| `src/main.js` | Main menu, faction selection, game lifecycle |
| `src/game.js` | Core engine — entities, combat, economy, production, win/loss |
| `src/data.js` | Faction definitions: units, buildings, upgrade trees |
| `src/models.js` | Procedural low-poly meshes |
| `src/terrain.js` | Procedural map generation |
| `src/pathfinding.js` | A* pathfinding + line-of-sight smoothing |
| `src/controls.js` | Camera rig, selection, orders, placement |
| `src/ai.js` | Enemy AI — economy, army, scouting, attack waves |
| `src/ui.js` | HUD, minimap, selection panels, command buttons |
| `src/audio.js` | WebAudio synth |

## Deployment

Every push to `main` triggers the [GitHub Actions workflow](.github/workflows/deploy.yml), which builds the Vite bundle and publishes it to GitHub Pages at **https://atxgreene.github.io/Ugh-Guys-/**.

## License

Released under the [CC0-1.0](LICENSE) license — public domain. Do anything you like with it.
