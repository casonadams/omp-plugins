# casonadams-plugins

Official marketplace catalog for [oh-my-pi](https://github.com/can1357/oh-my-pi)
(`omp`) plugins and extensions.

## Adding the Marketplace

In your terminal:

```bash
omp plugin marketplace add casonadams/omp-plugins
```

Or inside an interactive `omp` session:

```text
/marketplace add casonadams/omp-plugins
```

Verify configured marketplaces:

```bash
omp plugin marketplace list
```

## Available Plugins

| Plugin                                                           | Category | Description                                                                                   |
| ---------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| [`omp-bash-guard`](https://github.com/casonadams/omp-bash-guard) | Security | Security gatekeeper extension for shell execution using the configured guard/judge model role |

## Installing Plugins

Browse available plugins across configured marketplaces:

```bash
omp plugin discover
```

_(Or inside an interactive session: `/marketplace discover`)_

Install a plugin from this catalog:

```bash
omp plugin install omp-bash-guard@casonadams-plugins
```

_Note: If you previously installed directly via GitHub, use `--force` to switch
tracking to the marketplace catalog:_

```bash
omp plugin install omp-bash-guard@casonadams-plugins --force
```

## Updating & Upgrading

Fetch latest catalog metadata from GitHub:

```bash
omp plugin marketplace update casonadams-plugins
```

_(Or inside an interactive session: `/marketplace update casonadams-plugins`)_

Upgrade installed plugins to their latest versions:

```bash
omp plugin upgrade omp-bash-guard
```

_(Or inside an interactive session: `/marketplace upgrade omp-bash-guard`)_

## Health & Verification

Verify installed plugins and diagnose configuration issues:

```bash
omp plugin list
omp plugin doctor
```

## Uninstalling

Remove a plugin:

```bash
omp plugin uninstall omp-bash-guard
```
