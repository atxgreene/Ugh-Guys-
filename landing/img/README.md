# Landing-page art — drop-in slots

The landing page (`landing/index.html`) automatically uses these images **if they
exist**, and degrades gracefully (gradient backgrounds + inline SVG sigils) if any
are missing. Save the key-art files here with these exact names:

| Filename | Used as | Recommended source image | Notes |
| --- | --- | --- | --- |
| `hero-bg.jpg` | Full-screen hero background | The wide **three-realm panorama** (gold city → violet Watcher city → red wasteland), *no title baked in* | ~2400×1000+, landscape. Text sits on top, so a darker / less busy center reads best. |
| `emblem.png` | Small logo mark above the hero title | The **square game crest** (gold sunburst + violet eye + horned skull), transparent background | PNG with transparency, square. |
| `keyart.jpg` | Showcase band below the lore section | The **"Choose Your Fate Before the Flood"** character key art, or the **"Build. Reveal. Conquer."** banner | Wide. Title baked in is fine here. |
| `logo-banner.jpg` | Social/link preview (Open Graph) + final-CTA backdrop | The **"Build. Reveal. Conquer."** wide banner | ~1200×630 works well for social previews. |
| `sigil-covenant.png` | Covenant faction-card emblem | The **gold Covenant crest** (sun + ziggurat shield + laurels) | Square, transparent background preferred. |
| `sigil-watcher.png` | Watcher faction-card emblem | The **violet Watcher eye sigil** | Square, transparent background preferred. |
| `sigil-nephilim.png` | Nephilim faction-card emblem | The **red Nephilim horned skull** | Square, transparent background preferred. |

## How to add them
- **GitHub web (easiest):** open this repo on github.com → `landing/img/` → *Add file → Upload files* → drag the images in (named as above) → commit to `main`. The Pages deploy runs automatically and the landing page updates.
- **Locally:** copy the files into `landing/img/`, commit, and push.

Tip: keep files reasonably sized (hero/showcase ≤ ~600 KB each) so the page loads fast.
Optimize with [squoosh.app](https://squoosh.app) if needed.
