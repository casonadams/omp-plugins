# GitHub Pages Showcase & Marketplace Catalog Spec

## Status

Approved

## Problem

`omp-plugins` (`casonadams-plugins`) provides extensions for `oh-my-pi` (`omp`), currently featuring the `guard` security gatekeeper plugin. However, there is no public web-accessible catalog or landing page. Users must browse the GitHub repository markdown to discover available plugins, find installation commands, and understand configuration prerequisites.

## Users and stakeholders

- **omp users**: Developers seeking to extend `oh-my-pi` with security, utility, and workflow plugins.
- **Maintainer**: Needs an automated, zero-overhead deployment that stays updated when plugins or marketplace metadata change.

## Goals

- Provide a fast, zero-build static landing page hosted on GitHub Pages (`https://casonadams.github.io/omp-plugins/`).
- Showcase the marketplace setup command and available plugins (starting with `guard`).
- Provide one-click copyable installation commands and interactive documentation.
- Maintain visual harmony with sibling tools (`rho`, `zload`) with dark/light theme support.
- Fully automate GitHub Pages deployment via GitHub Actions on updates to `main`.

## Non-goals

- Dynamic backend, search engine API, or server-side rendering.
- Heavy frontend frameworks (React, Vue, Vite); the site must be vanilla HTML/CSS/JS with zero build steps.
- Direct package registry hosting (distribution continues via git/marketplace repo).

## Current behavior

No `www/` directory exists. No GitHub Pages workflow exists. Users only have `README.md` and `marketplace.json` in the git repository.

## Desired behavior

1. Visiting the GitHub Pages URL loads a responsive web page showcasing `casonadams-plugins`.
2. A hero section displays the quick-start command to add the marketplace:
   `omp plugin marketplace add casonadams/omp-plugins`
3. A catalog grid displays available plugins:
   - Plugin name and category badge (`security`).
   - Short description of what it does.
   - Quick install snippet (`omp plugin install guard@casonadams-plugins`) with a copy button.
   - Expandable details or modal showing configuration options (e.g. `GUARD_MODEL_ROLE`), requirements, and link to plugin README.
4. Dark and light themes supported with toggle button and auto-detection matching system preference.
5. GitHub Actions workflow `.github/workflows/pages.yml` automatically builds and publishes the `www/` artifact to GitHub Pages.

## Requirements

- REQ-001: The site must be completely static and loadable without a build or compile step.
- REQ-002: Hero section must prominently display the command to register the marketplace catalog in `omp`.
- REQ-003: Catalog must display all plugins defined in `marketplace.json` with categories, descriptions, and verified install commands.
- REQ-004: All shell command blocks must include single-click copy-to-clipboard functionality with visual feedback.
- REQ-005: Theme toggle must support dark mode (default) and light mode, persisting preference in `localStorage` and respecting `prefers-color-scheme`.
- REQ-006: Layout must be fully responsive across mobile, tablet, and desktop viewports.
- REQ-007: `.github/workflows/pages.yml` must deploy the site using GitHub Actions official Pages actions (`configure-pages`, `upload-pages-artifact`, `deploy-pages`).
- REQ-008: Site must include favicon, meta tags (OpenGraph, description), and semantic accessible HTML.

## Invariants and security boundaries

- No external third-party CDN scripts or untrusted tracking scripts loaded.
- All code and command snippets must be sanitized and safe against XSS.
- GitHub Pages permissions must be scoped strictly to `pages: write`, `id-token: write`, and `contents: read`.

## Definition of done

- `www/` directory contains `index.html`, `css/style.css`, `js/app.js`, `favicon.svg`.
- Prettier checks pass on all web assets (`bun run format:check`).
- Visual smoke test passes (verified via browser or server).
- `.github/workflows/pages.yml` configured and validated.

## Acceptance criteria

- AC-001: Given a desktop or mobile browser, when the user visits `index.html`, the hero section displays the marketplace command with a working copy button.
- AC-002: Given the plugin catalog, when browsing plugins, the `guard` plugin card is visible showing category `Security`, description, and `omp plugin install guard@casonadams-plugins`.
- AC-003: Given a user clicking a command copy button, the command is copied to clipboard and button displays transient "Copied!" feedback.
- AC-004: Given the theme toggle button, when clicked, the page switches between dark and light themes, updating `localStorage`.
- AC-005: Given a push to `main` with changes in `www/**` or `marketplace.json`, the Pages workflow triggers.

## Edge cases

- Browser clipboard API unavailable (fallback copy handling).
- Offline / local file opening (`file://` or local dev server) functions without path errors.
- High-contrast and small-screen viewport rendering.

## Constraints

- Pure ASCII / UTF-8.
- No node/bun runtime dependencies required for serving.
- Match existing repository code quality and prettier formatting.

## Risks and mitigations

- Risk: Marketplace plugins list gets out of sync with `marketplace.json`.
  Mitigation: Catalog data structured to mirror `marketplace.json` schema; optional build or test check can verify consistency.

## References

- Sibling implementation: `../rho/www/packages.html` & `../rho/.github/workflows/pages.yml`
- Sibling implementation: `../zload/www/index.html` & `../zload/.github/workflows/pages.yml`
- Repository manifests: `marketplace.json`, `plugins/guard/package.json`
