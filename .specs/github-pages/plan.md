# GitHub Pages Showcase & Marketplace Catalog Implementation Plan

## 1. Research

Examined sibling implementations:

- `../rho/www/packages.html`: CSS variables for themes (`--bg-primary`, `--accent`, `--border`), responsive card grids, quick-copy blocks, search/filter controls, and modal overlays.
- `../zload/www/index.html`: Hero terminal styling, code-dots styling, animated badge, responsive navigation bar, and clean typography.
- Sibling `.github/workflows/pages.yml`: Uses standard GitHub Pages actions:
  - `actions/configure-pages@v5`
  - `actions/upload-pages-artifact@v3` (path: `www`)
  - `actions/deploy-pages@v4` with concurrency group `pages`.

## 2. Reuse

- Design tokens and layout patterns from `rho` and `zload` (`--bg-page`, `--bg-surface`, `--text-primary`, `--border-color`, monospace accents).
- Marketplace catalog data from `marketplace.json`.
- Official GitHub Actions deployment actions (`actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`).

## 3. Invariants and security boundaries

- No external runtime dependencies or CDN scripts; fully self-contained static site.
- No unsafe `eval()` or unescaped HTML injection.
- GitHub Pages permissions restricted to minimum required for Pages deployment (`contents: read`, `pages: write`, `id-token: write`).

## 4. Quality gates

- Prettier check (`bun run format:check`) across all created files (`.html`, `.css`, `.js`, `.svg`, `.yml`).
- Zero console errors or warnings when rendered in browser.
- Valid HTML5 markup and semantic structure.

## 5. Definition of done

- `www/index.html`, `www/css/style.css`, `www/js/app.js`, `www/favicon.svg` created and styled.
- Marketplace addition command and `guard` plugin clearly documented with one-click copy.
- Dark/light mode theme toggle functions and remembers preference.
- `.github/workflows/pages.yml` in place and formatted.
- `bun run format:check` passes without errors.
- Visual smoke test via local HTTP server verifies rendering, responsiveness, and interaction.

## 6. Assumptions

- GitHub Pages will be hosted at repo root URL `https://casonadams.github.io/omp-plugins/`.
- Future plugins added to `marketplace.json` will be added to `www/` catalog (or rendered from shared data).

## 7. Risks

- **Risk**: GitHub Pages root path difference between custom domain vs subpath (`/omp-plugins/`).
  **Mitigation**: Use relative paths (`./css/style.css`, `./favicon.svg`) so the site functions correctly under any subpath or root domain.

## 8. Dependencies

No new runtime or build dependencies. Prettier (already in devDependencies) used for code formatting.

## 9. Decisions

- **Zero-build static site over static-site generator**: Hugo/Astro/Next are unnecessary overhead for a focused plugin showcase and marketplace catalog. Vanilla HTML/CSS/JS offers instant load, zero maintenance, and simple auditing.
- **Single-page landing + catalog over multi-page**: Since the catalog currently has `guard` with more plugins coming, a unified landing page with quick-start hero, plugin grid, and modal/drawer details offers the best UX without navigation fragmentation.

## 10. Out of scope

- Automated markdown-to-HTML parser pipeline for plugin READMEs (can be added later if catalog exceeds dozens of plugins).
- Custom domain configuration (uses default `github.io`).

---

## Slice 1: Site Architecture & Core Assets

### Goal

Deliver the static web showcase in `www/` with hero, marketplace quick-start command, plugin cards, dark/light theme support, and responsive CSS.

### Acceptance criteria

- Satisfies AC-001, AC-002, AC-003, AC-004.

#### Task 1.1: Create SVG favicon and theme assets [1]

**Do:** Create `www/favicon.svg` matching `omp` terminal/plugin branding with scalable vector graphics.
**Covers:** REQ-008.
**Verify:** File exists and is valid SVG.

#### Task 1.2: Build CSS design system and theme tokens [3]

**Do:** Create `www/css/style.css` defining CSS custom properties for dark and light modes, typography, navbar, hero section, command snippet box with copy button, plugin grid, badges, and responsive media queries.
**Covers:** REQ-005, REQ-006.
**Verify:** Inspect CSS rules for dark/light themes and responsive breakpoints (`@media (max-width: 768px)`).

#### Task 1.3: Build JavaScript interactive controller [2]

**Do:** Create `www/js/app.js` implementing theme toggling (saving to `localStorage`), clipboard copy with temporary tooltip/state change, and mobile menu toggling.
**Covers:** REQ-004, REQ-005.
**Verify:** Check event listeners for copy buttons and theme toggle.

#### Task 1.4: Build HTML landing page and catalog [3]

**Do:** Create `www/index.html` with navigation, hero section, marketplace install instructions, plugin cards (showcasing `guard` with category, description, install snippet, config table), and footer.
**Covers:** REQ-001, REQ-002, REQ-003, REQ-008, AC-001, AC-002.
**Verify:** Check HTML markup validity and link resolution.

### Slice verification

Run `bun run format:check` to ensure all assets comply with project formatting.

---

## Slice 2: GitHub Pages Deployment Workflow

### Goal

Configure the GitHub Actions deployment workflow to automate publishing `www/` to GitHub Pages on pushes to `main`.

### Acceptance criteria

- Satisfies REQ-007, AC-005.

#### Task 2.1: Create `.github/workflows/pages.yml` [2]

**Do:** Create `.github/workflows/pages.yml` triggered on push to `main` (paths: `www/**`, `marketplace.json`, `.github/workflows/pages.yml`) and `workflow_dispatch`. Configure `pages: write`, `id-token: write`, `contents: read`, and the deploy-pages job.
**Covers:** REQ-007, AC-005.
**Verify:** Workflow syntax conforms to GitHub Actions schema.

### Slice verification

Validate formatting via `bun run format:check`.

---

## Slice 3: Verification & Smoke Proof

### Goal

Prove end-to-end functionality via local HTTP serving, testing theme toggle, command copy, and mobile responsiveness.

### Acceptance criteria

- Satisfies AC-001, AC-002, AC-003, AC-004.

#### Task 3.1: Serve and verify site locally [2]

**Do:** Spin up a local HTTP server on `www/`, test HTTP status 200, check DOM nodes, verify command copy mechanics, and check dark/light toggle.
**Covers:** AC-001, AC-002, AC-003, AC-004.
**Verify:** Automated curl and DOM assertions confirm 200 OK and expected element content.

---

## Final verification

- `bun run format:check` passes across the repository.
- `bun test` passes across existing plugins (`plugins/guard`).
- All HTML/CSS/JS and workflow files exist and match requirements.
