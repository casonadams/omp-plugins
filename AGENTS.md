# Repository Instructions

## Overview & Architecture

`omp-plugins` is the official marketplace repository (`casonadams-plugins`) for `oh-my-pi` (`omp`) plugins and extensions.

- **Marketplace Manifests**:
  - `marketplace.json` (repository root) and `.omp-plugin/marketplace.json` define catalog metadata and published plugins. Both must remain in sync.
- **Plugins Directory**:
  - Each plugin lives in `plugins/<plugin-name>/` (e.g. `plugins/guard/`) as an independent workspace package.
  - Plugins declare extension entrypoints in their `package.json` under the `"omp"` key.
- **Public Showcase & Documentation**:
  - The static GitHub Pages website lives in `www/` (`index.html`, `css/style.css`, `js/app.js`, `favicon.svg`) and is deployed via `.github/workflows/pages.yml`.

---

## Documentation, Marketplace & Website Synchronization

When adding, modifying, or removing a plugin, its configuration options, commands, or metadata, update all corresponding assets together in lockstep:

1. **Marketplace Manifests**:
   - Update `marketplace.json` and `.omp-plugin/marketplace.json` with the plugin name, description, category, source path, and homepage.
2. **Repository README (`README.md`)**:
   - Add or update the plugin entry in the "Available Plugins" table with its category, description, and link.
   - Maintain accurate installation examples using the marketplace scope:
     `omp plugin install <plugin-name>@casonadams-plugins`
3. **Showcase Website (`www/index.html`)**:
   - Add or update the plugin card in the catalog grid (`#catalog`).
   - Include the category tag (`data-category`), description, install snippet with copy button, key features list, and links to source/docs.
   - Update the category filter count badges (`All (N)`, `<category> (N)`) if new categories or plugins are added.
   - Keep `www/` completely static (vanilla HTML/CSS/JS, zero build dependencies).
4. **Plugin Documentation (`plugins/<plugin-name>/README.md`)**:
   - Document prerequisites, configuration environment variables (e.g., model roles), runtime behavior, and manual testing instructions.

---

## Quality Gates & Verification

Always run all repository quality checks before completing a task or submitting changes:

```sh
# 1. Run typecheck, lint, formatting, test, and CRAP checks across all plugins
bun run check

# 2. Check repository-wide Prettier formatting (including www/, specs, configs)
bun run format:check
```

- When modifying web assets in `www/`, verify that formatting passes via `bun run format:check` and visual rendering works in both dark and light themes without console errors.
