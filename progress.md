# Flow — fluid animation static site

## Goal
A static website built around fluid animation. No frameworks, no build step, served on localhost.

## Status: done (first version)

## Files
- `index.html`: markup, SVG filters (`#liquid` turbulence warp, `#goo` surface-tension metaballs)
- `styles.css`: editorial layout, word reveals, range/button styling, grain, cursor, responsive and reduced-motion rules
- `fluid.js`: WebGL2 stable-fluids solver (half-float). Passes: splat → curl → vorticity confinement → divergence → pressure decay → 20 Jacobi iterations → gradient subtract → advect velocity → advect dye. The display shader adds relief shading and a specular highlight from dye gradients, plus dithering and a `dim` uniform for reading sections.
- `app.js`: interactions and the main loop
- `screenshots/`: Playwright captures (desktop 1440×900 and mobile 390×844)

## Features
- The cursor stirs the fluid; a click or tap drops a 3-way ink burst
- Scrolling pushes velocity into the fluid along the side margins. Scroll speed also skews the headings and drives the marquee speed and the `v` readout in the header
- An ambient Lissajous emitter keeps the fluid moving when the page is idle
- §01 viscosity slider sets velocity/dye dissipation and gloss, with a live Reynolds number and regime (laminar/transitional/turbulent)
- §02 curl slider sets vorticity confinement; "Fire a vortex ring" sends counter-rotating jets up from the bottom
- Fig. 04: the word "viscous" warped by animated feTurbulence/feDisplacementMap; it reacts to hover and scroll speed
- §03 gooey droplets (blur + alpha-threshold filter); they orbit and coalesce around the cursor
- §04 four pigment palettes (Sumi, Kiln, Tidepool, Bone) and "Still the water" (temporarily high dissipation)
- Word-by-word heading reveals, blur-in paragraphs, film grain, a difference-blend cursor ring and hero title
- Fallback: without WebGL2 float targets, the `no-gl` class shows a static gradient instead

## How to run
    cd flow && python3 -m http.server 4173
    open http://localhost:4173

## Log
- Wrote solver, page, styles, interactions
- Bug fixed: SVG filter `id="goo"` collided with the droplet container id, so the droplets were never visible. Container renamed to `#drops`
- Tuning: pigment cycling now runs on time (it had been stuck on cobalt). The fluid dims to 58% once past the hero so body text stays readable. Hero line padding fixed (the "g" descender was clipped). Liquid word made smoother (1 octave, lower scale, no blend)
- The sim is re-seeded when the aspect ratio changes (rotate/resize), so it never goes blank
- Verified in headless Chromium (SwiftShader software GL, ~5 fps there; a real GPU runs 60 fps). No console errors, 0px horizontal overflow on mobile
- Port changed to 4173: the user's machine already has an LLM router (nvidia-nim + groq) on 8080
- Prepared git repo (main, .nojekyll) for GitHub Pages; repo creation blocked by permission check, awaiting user
