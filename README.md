# casonadams-plugins

Official marketplace catalog for [oh-my-pi](https://github.com/can1357/oh-my-pi)
(`omp`) plugins and extensions.

## Adding the Marketplace

In your terminal:

```sh
omp plugin marketplace add casonadams/omp-plugins
```

Or inside an interactive `omp` session:

```text
/marketplace add casonadams/omp-plugins
```

Verify configured marketplaces:

```sh
omp plugin marketplace list
```

## Available Plugins

| Plugin                     | Category | Description                                                                                   |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| [`guard`](./plugins/guard) | Security | Security gatekeeper extension for shell execution using the configured guard/judge model role |

## Installing Plugins

Browse available plugins across configured marketplaces:

```sh
omp plugin discover
```

_(Or inside an interactive session: `/marketplace discover`)_

Install a plugin from this catalog:

```sh
omp plugin install guard@casonadams-plugins
```

> **Note:** The `@casonadams-plugins` suffix is required. Running `omp plugin install guard` without it resolves to an unrelated package from the npm registry.

_Note: If you previously installed directly via GitHub or an older package name,
use `--force` to switch tracking to the marketplace catalog:_

```sh
omp plugin install guard@casonadams-plugins --force
```

## Updating & Upgrading

Upgrading plugins is a **two-step process**. `omp` caches marketplace git repositories locally and only refreshes them every 24 hours unless told to update.

### Step 1: Update the marketplace catalog

Fetch the latest releases and tags from GitHub into your local marketplace cache:

```sh
omp plugin marketplace update casonadams-plugins
```

_(Or inside an interactive `omp` session: `/marketplace update casonadams-plugins`)_

### Step 2: Upgrade the plugin

Upgrade the plugin to the newly fetched version:

```sh
omp plugin upgrade guard@casonadams-plugins
```

_(Or inside an interactive `omp` session: `/marketplace upgrade guard@casonadams-plugins`)_

> **Why did `omp plugin upgrade` say "All marketplace plugins are up to date"?**
>
> 1. **Cache staleness**: `omp plugin upgrade` does not pull from GitHub on every execution. You **must** run `omp plugin marketplace update casonadams-plugins` (Step 1) before upgrading, otherwise `omp` only sees the locally cached git commit.
> 2. **Target requirement**: Running bare `omp plugin upgrade` (without arguments) checks the top-level catalog manifest and will report up to date if package-level versions are not defined at the catalog root. Always specify `guard@casonadams-plugins` to upgrade directly from the plugin package.
> 3. **Force reinstall**: If you ever need to force a clean upgrade or switch tracking:
>    ```sh
>    omp plugin install guard@casonadams-plugins --force
>    ```

## Health & Verification

Verify installed plugins and diagnose configuration issues:

```sh
omp plugin list
omp plugin doctor
```

## Uninstalling

Remove a plugin:

```sh
omp plugin uninstall guard@casonadams-plugins
```
