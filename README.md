# casonadams-plugins

Official marketplace catalog for [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`) plugins and extensions.

## Adding the Marketplace

In your terminal:

```bash
omp plugin marketplace add casonadams/omp-plugins
```

Or inside an interactive `omp` session:

```text
/marketplace add casonadams/omp-plugins
```

## Available Plugins

| Plugin | Category | Description |
|---|---|---|
| [`omp-bash-guard`](https://github.com/casonadams/omp-bash-guard) | Security | Security gatekeeper extension for shell execution using the configured guard/judge model role |

## Installing Plugins

Browse available plugins from configured marketplaces:

```bash
omp plugin marketplace discover
```

Install a plugin from this catalog:

```bash
omp plugin install omp-bash-guard@casonadams-plugins
```
