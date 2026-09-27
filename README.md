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

Fetch latest catalog metadata from GitHub:

```sh
omp plugin marketplace update casonadams-plugins
```

_(Or inside an interactive session: `/marketplace update casonadams-plugins`)_

Upgrade installed plugins to their latest versions:

```sh
# Upgrade all marketplace plugins
omp plugin upgrade

# Or upgrade specifically
omp plugin upgrade guard@casonadams-plugins
```

_(Or inside an interactive session:
`/marketplace upgrade guard@casonadams-plugins`)_

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
