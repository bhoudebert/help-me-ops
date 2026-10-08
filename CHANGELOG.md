# Changelog

## 1.0.0 (2026-10-08)


### Features

* a read-only investigation toolbox over connectors and playbooks, for the CLI and MCP ([606b2be](https://github.com/bhoudebert/help-me-ops/commit/606b2be0d4e3c0331361c30b3e0daea17e762608))
* **addons:** load addons dropped in a folder, with tools, settings and connector types ([#9](https://github.com/bhoudebert/help-me-ops/issues/9)) ([3fd3624](https://github.com/bhoudebert/help-me-ops/commit/3fd3624320a29dcf1a615183d8a982c1373b2731))
* **addons:** scaffold an addon with ops init addon ([#16](https://github.com/bhoudebert/help-me-ops/issues/16)) ([de1d08f](https://github.com/bhoudebert/help-me-ops/commit/de1d08fafb3044a0b6ec636ec5306601f9791a94))
* **addons:** ship a read-only datadog addon, with a fake Datadog in the demo ([#22](https://github.com/bhoudebert/help-me-ops/issues/22)) ([53a04aa](https://github.com/bhoudebert/help-me-ops/commit/53a04aafb17d45e52e562d91e605263a49b4d046))
* **addons:** ship a read-only git addon, with a demo repository ([#23](https://github.com/bhoudebert/help-me-ops/issues/23)) ([08fb5ad](https://github.com/bhoudebert/help-me-ops/commit/08fb5ade208e5840ff8b399e064dcbc42349346f))
* **addons:** ship a read-only rest addon, idle until an environment sets it up ([#19](https://github.com/bhoudebert/help-me-ops/issues/19)) ([72e07cc](https://github.com/bhoudebert/help-me-ops/commit/72e07ccb6e4644d8a2c23ea51b5f595538f355e9))
* **addons:** ship an experimental read-only github addon, with a mock in the demo ([#24](https://github.com/bhoudebert/help-me-ops/issues/24)) ([ac92a83](https://github.com/bhoudebert/help-me-ops/commit/ac92a83675e89a2b4c9f655820006ca6604cc666))
* **addons:** write an addon as a manifest and plain functions ([#13](https://github.com/bhoudebert/help-me-ops/issues/13)) ([5649068](https://github.com/bhoudebert/help-me-ops/commit/56490683cb14a10bb35f36f2a6915a64e6f8f8be))
* **config:** a workspace folder with apps and environments, and a scope tool ([#8](https://github.com/bhoudebert/help-me-ops/issues/8)) ([439e162](https://github.com/bhoudebert/help-me-ops/commit/439e1627c6aa4a8c71e0d90dcd3576180de57ff5))
* **demo:** a live backend for the rest addon, and addons that stay idle while credentials are absent ([#20](https://github.com/bhoudebert/help-me-ops/issues/20)) ([3d74c16](https://github.com/bhoudebert/help-me-ops/commit/3d74c162c50fff8b67c63fd657bd1686a36decf8))
* **demo:** a shop to investigate, in prod and staging, with a fault in prod only ([#10](https://github.com/bhoudebert/help-me-ops/issues/10)) ([b48752e](https://github.com/bhoudebert/help-me-ops/commit/b48752ea275ce332442152f810df1bb847cfee44))
* **demo:** the shop on a real PostgreSQL, with a read-only user and an addon shipped off ([#18](https://github.com/bhoudebert/help-me-ops/issues/18)) ([22d3112](https://github.com/bhoudebert/help-me-ops/commit/22d3112f7c2e6207f3c547c68bb1e982b6760d5f))
* **workspace:** name the workspace folder my-workspace and say which workspace is loaded ([#14](https://github.com/bhoudebert/help-me-ops/issues/14)) ([abeee1f](https://github.com/bhoudebert/help-me-ops/commit/abeee1f23f4c566fd71ccf9fee849eb1937aa7cb))


### Bug Fixes

* **config:** say where sources go when the old flat config is found ([#11](https://github.com/bhoudebert/help-me-ops/issues/11)) ([ca5e184](https://github.com/bhoudebert/help-me-ops/commit/ca5e184429e243066f7f5d4e501f78938eff6531))
