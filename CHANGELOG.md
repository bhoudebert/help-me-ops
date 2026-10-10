# Changelog

## [1.2.0](https://github.com/bhoudebert/help-me-ops/compare/v1.1.0...v1.2.0) (2026-10-10)


### Features

* **addons:** ship experimental prometheus, loki and elasticsearch addons, with mocks ([#39](https://github.com/bhoudebert/help-me-ops/issues/39)) ([442e5c5](https://github.com/bhoudebert/help-me-ops/commit/442e5c5a586f5ba7d741a8a6dc1825678d2f27c7))
* **agent:** chat and ask drive the toolbox with a model you configure, any OpenAI-compatible URL ([#44](https://github.com/bhoudebert/help-me-ops/issues/44)) ([116f296](https://github.com/bhoudebert/help-me-ops/commit/116f29693934c466a9f803b16f54c32f8ee3977a))
* **agent:** ops eval counts how often a model reaches an accepted, expected conclusion ([#45](https://github.com/bhoudebert/help-me-ops/issues/45)) ([88e8183](https://github.com/bhoudebert/help-me-ops/commit/88e818385804f8a5cd5f45be81cabd1ce4e29abc))
* **agent:** retries for busy servers, and the headers, keys and addresses other providers need ([#46](https://github.com/bhoudebert/help-me-ops/issues/46)) ([4f28f22](https://github.com/bhoudebert/help-me-ops/commit/4f28f224c767446b65eda9d446a6292726accf8b))
* **agent:** send provider headers, read keys from the environment, keep a query string ([#47](https://github.com/bhoudebert/help-me-ops/issues/47)) ([ab82a62](https://github.com/bhoudebert/help-me-ops/commit/ab82a62728bd9c327bb0381e087adb2092cad8be))
* **bench:** keep each eval run as a record and make the guide's table from the records ([#51](https://github.com/bhoudebert/help-me-ops/issues/51)) ([458185c](https://github.com/bhoudebert/help-me-ops/commit/458185c59893540406bf76d721da8618ea5ca71b))
* **demo:** add two more incidents to the demo world, and eval over all scenarios ([#50](https://github.com/bhoudebert/help-me-ops/issues/50)) ([efb6431](https://github.com/bhoudebert/help-me-ops/commit/efb6431065f3037b2819131a29e300fb0cadd347))
* **demo:** replay an investigation in the terminal with ops demo ([#36](https://github.com/bhoudebert/help-me-ops/issues/36)) ([ecdcfb6](https://github.com/bhoudebert/help-me-ops/commit/ecdcfb688d478930ff653118b1beeae4f99cd786))
* **docker:** an image and a compose file for the team server, and a guide on local or remote ([#54](https://github.com/bhoudebert/help-me-ops/issues/54)) ([3482171](https://github.com/bhoudebert/help-me-ops/commit/3482171c038e659e3d95e730adb6148bf78ea760))
* **logs:** partial matches, and a re-measure at temperature 0.7 with what was tried ([#52](https://github.com/bhoudebert/help-me-ops/issues/52)) ([e61a3e2](https://github.com/bhoudebert/help-me-ops/commit/e61a3e293d974353cc7aaa514cb833f7443323ac))
* **mcp:** accept access tokens from a company identity provider (OAuth 2) ([#56](https://github.com/bhoudebert/help-me-ops/issues/56)) ([82d9c28](https://github.com/bhoudebert/help-me-ops/commit/82d9c28cca50fb807eea8063d32fe358fd7bd10c))
* **mcp:** keep only the hash of a token on the server ([#55](https://github.com/bhoudebert/help-me-ops/issues/55)) ([45fd7f1](https://github.com/bhoudebert/help-me-ops/commit/45fd7f15098e50238e7a98e35ffab6206d88ef72))
* **mcp:** serve the MCP server over HTTP for a team, with tokens ([#53](https://github.com/bhoudebert/help-me-ops/issues/53)) ([bbb9843](https://github.com/bhoudebert/help-me-ops/commit/bbb9843e913ffb7529b928c0fcddc082d87b8a45))
* **privacy:** declare which sources hold personal data, with an optional strict mode ([#41](https://github.com/bhoudebert/help-me-ops/issues/41)) ([d211095](https://github.com/bhoudebert/help-me-ops/commit/d2110951a9de0f9f084d2cdedb27505ff93e3515))
* **privacy:** hide values behind stable placeholders so one customer can be followed across sources ([#42](https://github.com/bhoudebert/help-me-ops/issues/42)) ([6b94595](https://github.com/bhoudebert/help-me-ops/commit/6b945953250b155d44b50d34e2e80ddf0dede6a5))
* **setup:** print the configuration of each AI client with your paths, after checking it ([#37](https://github.com/bhoudebert/help-me-ops/issues/37)) ([abca095](https://github.com/bhoudebert/help-me-ops/commit/abca095f53ae284be727c9419ad10514a5d845a4))

## [1.1.0](https://github.com/bhoudebert/help-me-ops/compare/v1.0.0...v1.1.0) (2026-10-08)


### Features

* **addons:** check an addon with ops addon check ([#29](https://github.com/bhoudebert/help-me-ops/issues/29)) ([703de05](https://github.com/bhoudebert/help-me-ops/commit/703de050fc0d648da204d7c088dc5e7c834a6602))
* **conclusion:** refuse a conclusion that quotes what no tool returned ([#31](https://github.com/bhoudebert/help-me-ops/issues/31)) ([ac64b0c](https://github.com/bhoudebert/help-me-ops/commit/ac64b0c1ed46ce155582822b22528a9e33d0c3e7))
* **knowledge:** search the team's runbooks and notes with searchKnowledge ([#30](https://github.com/bhoudebert/help-me-ops/issues/30)) ([b2edd9e](https://github.com/bhoudebert/help-me-ops/commit/b2edd9edd673aa110ed3588a5f4b4360a0ea731b))
* **privacy:** hide the fields and patterns the workspace lists in what the tools return ([#34](https://github.com/bhoudebert/help-me-ops/issues/34)) ([93ba441](https://github.com/bhoudebert/help-me-ops/commit/93ba4419c771f11039722edf28e597e07f3326ac))
* **privacy:** let an addon declare its personal fields and detectors ([#35](https://github.com/bhoudebert/help-me-ops/issues/35)) ([5bb5ec3](https://github.com/bhoudebert/help-me-ops/commit/5bb5ec38e742937e97c91f2dbb7d494821db88df))
* **workspace:** create a workspace with ops init workspace ([#27](https://github.com/bhoudebert/help-me-ops/issues/27)) ([8b5bbbf](https://github.com/bhoudebert/help-me-ops/commit/8b5bbbf1a338d951b9141695f862a541d1b2b3fc))

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
