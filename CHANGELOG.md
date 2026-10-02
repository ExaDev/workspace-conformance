# [1.3.0](https://github.com/ExaDev/workspace-conformance/compare/v1.2.2...v1.3.0) (2026-10-02)


### Features

* add eslint check proving the repository's own ESLint is applied ([71d4a0c](https://github.com/ExaDev/workspace-conformance/commit/71d4a0cc9f917d1783aba76e6a78985f9b9e02ac))

## [1.2.2](https://github.com/ExaDev/workspace-conformance/compare/v1.2.1...v1.2.2) (2026-10-02)

## [1.2.1](https://github.com/ExaDev/workspace-conformance/compare/v1.2.0...v1.2.1) (2026-10-02)

# [1.2.0](https://github.com/ExaDev/workspace-conformance/compare/v1.1.0...v1.2.0) (2026-10-02)


### Bug Fixes

* **cli:** fall back to GH_TOKEN when GITHUB_TOKEN is empty and fail with a ConformanceError ([dc4aba5](https://github.com/ExaDev/workspace-conformance/commit/dc4aba5cb3407892345abeab82f2ad23d29c67ef))
* **github:** reject with a ConformanceError when the token cannot see the merge-method settings ([856d427](https://github.com/ExaDev/workspace-conformance/commit/856d427b1ecdd07c0a79e60db684152bbd069889))
* read git push destinations through HEAD, forcing plus and valued options ([9bf8c11](https://github.com/ExaDev/workspace-conformance/commit/9bf8c1111c321eb786f4be24afe271d76a821ab1))
* recognise a publish with package manager options before the subcommand ([f6a5b8c](https://github.com/ExaDev/workspace-conformance/commit/f6a5b8cd238efeab789d514bae4a45acc4645a01))
* recognise junction jobs that loop over joined results and exempt jobs that skip pull requests ([a5d5362](https://github.com/ExaDev/workspace-conformance/commit/a5d53627317660099c3d8c9d40ef96b68a3c53d9))
* require a resolver's literal fallback to name only hosted runner labels ([40aaf2c](https://github.com/ExaDev/workspace-conformance/commit/40aaf2c295946dae7451c2dcc761ee2218a71ae4))
* **workflow-credentials:** recognise changeset and semantic-release run through a package manager ([3cbff68](https://github.com/ExaDev/workspace-conformance/commit/3cbff68b395c2533df4789a4d2cb6debb869f84c))
* **workflow-credentials:** state that provenance makes a fallback publish traceable only ([0b95fec](https://github.com/ExaDev/workspace-conformance/commit/0b95fec3c62bacaf557bdb199efc89b8cb218fc5))
* **workflow-job-ordering:** judge an if by its && and || structure ([8eef3d1](https://github.com/ExaDev/workspace-conformance/commit/8eef3d1eea3ceee6d9410245c8a6fcdc584c5938))
* **workflow-job-ordering:** report a skipped-result test on a single job's needs result ([0d54eb8](https://github.com/ExaDev/workspace-conformance/commit/0d54eb8f0eab9bd2483f286618d1dedf368a3f68))
* **workflow-job-ordering:** require the junction job to wait for merge-queue and disjunctive jobs ([3cfa322](https://github.com/ExaDev/workspace-conformance/commit/3cfa3223998e5f720036569a7b643af75962ad1b))
* **workflow-repository-dispatch:** read a default-branch push through quotes and git global options ([f68d02a](https://github.com/ExaDev/workspace-conformance/commit/f68d02a4251e77c578f8f85a6af952159b1cf863))
* **workflow-update-bot-cooldown:** require Renovate's minimumReleaseAge to wait for a positive time ([be7e33c](https://github.com/ExaDev/workspace-conformance/commit/be7e33c4a7a8ce98e727e71ba9c60d65815a7ed6))
* **workflows:** split commands outside expressions and redirections ([e70be7a](https://github.com/ExaDev/workspace-conformance/commit/e70be7a3b4a40f9478a24c3057acfc5bae9892b2))


### Features

* add workflow checks and settings checks behind an injectable GitHub client ([7d5de53](https://github.com/ExaDev/workspace-conformance/commit/7d5de53d7ce2e386164a8a07f5db1782d2e7ed56))
* parse workflow files into a model of jobs, needs, permissions and environment ([f56a11c](https://github.com/ExaDev/workspace-conformance/commit/f56a11c5f2f834dd2f4b96eb6b35abc29d672e08))

# [1.1.0](https://github.com/ExaDev/workspace-conformance/compare/v1.0.0...v1.1.0) (2026-10-01)


### Bug Fixes

* allow one import check to repeat a rule name ([44e0a93](https://github.com/ExaDev/workspace-conformance/commit/44e0a93cb3b05023e3751abb062a07917532dd6c))
* reject an empty drizzle out as a configuration error ([552381d](https://github.com/ExaDev/workspace-conformance/commit/552381dbdceb67bc718dfe609486478a19ce4b7e))


### Features

* cross-check the migrations directory of a generator and a deploy tool ([6f8f978](https://github.com/ExaDev/workspace-conformance/commit/6f8f978988a8fffa4f1e1e97ccb29dcc57928fa7))


### Performance Improvements

* cruise once for the import checks that share graph options ([5f2aa57](https://github.com/ExaDev/workspace-conformance/commit/5f2aa574d15e5998ec0a03166c3bccd614ab6e28))

# 1.0.0 (2026-09-30)


### Bug Fixes

* accept instruction links that resolve to the README through another form or link ([91394ad](https://github.com/ExaDev/workspace-conformance/commit/91394ad5896f52e3eaf0042687749c2a3d352cef))
* account for commit types by whether a preset knows them ([1cdb90a](https://github.com/ExaDev/workspace-conformance/commit/1cdb90a3f398dbc47dacc3ba631a883e4594b0f7))
* apply the configFiles alias to the config files commit-types evaluates ([28eecdb](https://github.com/ExaDev/workspace-conformance/commit/28eecdbd75e9127fd95cfe7a8dd1af66c850b81e))
* attribute imports of a workspace package by name and keep build output as an import target ([751e4ab](https://github.com/ExaDev/workspace-conformance/commit/751e4ab127518b803193fe44bf9ef163773b69a1))
* blame an import on the package whose directory holds the file, not on one named like its path ([714f8c3](https://github.com/ExaDev/workspace-conformance/commit/714f8c3b85dbb68294871530c93e9e2763702c63))
* compare a Dockerfile pin's variables with their values and stop reading longer names as pins ([ef81854](https://github.com/ExaDev/workspace-conformance/commit/ef81854df8625899dd861d99deb4cfd175ffd02b))
* declare the Node range the dependency tree supports and check it with engine-strict ([e47756f](https://github.com/ExaDev/workspace-conformance/commit/e47756fe45e5affeb2571110a3686c6e6eba3702))
* exit with the failed status, not a crash, when the reader of the output has gone ([337a6c0](https://github.com/ExaDev/workspace-conformance/commit/337a6c0a832e57e0a4e9eb85c5ddd1242f565f5b))
* fail the import checks when dependency-cruiser cannot load TypeScript ([1d8167f](https://github.com/ExaDev/workspace-conformance/commit/1d8167fed44e404fccd1e1a07303b29d84b3e4fc))
* find import cycles between packages that import each other by a name resolving to no file ([fc2c0ca](https://github.com/ExaDev/workspace-conformance/commit/fc2c0caebe231c5bb1eade57d446b4f2ecceeae5))
* import dependency-cruiser dynamically so the CommonJS build loads ([fe8ce98](https://github.com/ExaDev/workspace-conformance/commit/fe8ce9879cfa18ce2d20d53dbd1084e0c79bdd04))
* judge a command type through local aliases and renamed inference imports ([b72dd67](https://github.com/ExaDev/workspace-conformance/commit/b72dd673611b489cecc49fc0229fd55197c24555))
* judge interfaces and aliases inside exported namespaces and namespace re-exports ([53e9f32](https://github.com/ExaDev/workspace-conformance/commit/53e9f321f7f31324b518aa98c61ef5f832dbd90f))
* leave git data and nested checkouts out of every search by glob ([355fc9e](https://github.com/ExaDev/workspace-conformance/commit/355fc9e35e02f0362e9cf09c8adc57f2e8090706))
* leave no transpile cache in the workspace when evaluating a config ([da2169f](https://github.com/ExaDev/workspace-conformance/commit/da2169f5d93ade5e0ced5bba3c2e098f5c8caa9e))
* name the manifest that cannot be read when discovering packages ([341ca53](https://github.com/ExaDev/workspace-conformance/commit/341ca53146bfd05e83ee8e8d567f85b6913e6290))
* name the option, not its value, when a tsconfig or file glob cannot be used ([eeac9e2](https://github.com/ExaDev/workspace-conformance/commit/eeac9e224e84e552f78b811f3d5f6c2995ae5ca0))
* read a never or disabled type-enum rule as what it is, not as the accepted types ([56db190](https://github.com/ExaDev/workspace-conformance/commit/56db19010189179719c010a168d3de72e2e4c069))
* reject an exclude or doNotFollow pattern that does not compile when the section loads ([e2d3138](https://github.com/ExaDev/workspace-conformance/commit/e2d313820225e4207d543ed4c47c76790986b9c9))
* require a changelog section for a custom commit type only when sections are listed ([288fbdb](https://github.com/ExaDev/workspace-conformance/commit/288fbdb4d86dad84fcd34f1dd85d128f14c0940c))
* resolve tsconfig paths without baseUrl relative to the tsconfig, not the working directory ([064645b](https://github.com/ExaDev/workspace-conformance/commit/064645b284cdee36c6acce7370e070180b6166bb))
* say what is wrong with the options of a check instead of reporting invalid input ([9a1ba17](https://github.com/ExaDev/workspace-conformance/commit/9a1ba17545d96e27f00d7b53172175fa24dea037))
* validate --check with --list and accept help and -h ([7ae6474](https://github.com/ExaDev/workspace-conformance/commit/7ae6474f5319bc9f1d34c43fafe79e0456753477))
* validate a config or layout passed to runChecks with the section schemas ([1ba57cb](https://github.com/ExaDev/workspace-conformance/commit/1ba57cbc9fb3447c5846ad22220a8e7bd5ee9c92))


### Features

* add file tree and cross-config checks ([dd60f64](https://github.com/ExaDev/workspace-conformance/commit/dd60f64a8ab4c2cd19737397ac01ffe72b3ac7c2))
* add import graph checks on dependency-cruiser ([e6f305c](https://github.com/ExaDev/workspace-conformance/commit/e6f305cb260e2eff7fa42c8e5c8a67d3c8c57f15))
* add the check contract and the conformance config section ([89795ac](https://github.com/ExaDev/workspace-conformance/commit/89795ac0d77fe132dd2840fc16d6d42294bf702c))
* add the check registry, the runner and the command line ([1599d86](https://github.com/ExaDev/workspace-conformance/commit/1599d86466bea76b1243b01371308fc1a130a3c9))
* add type graph checks on ts-morph and a type-level exhaustiveness helper ([f821b83](https://github.com/ExaDev/workspace-conformance/commit/f821b8314e176f1007dce64170de69f13b1bc0ec))
* classify workspace packages and generate import rules from the layout ([b553a75](https://github.com/ExaDev/workspace-conformance/commit/b553a7539da77a5c45f21ed2df2d8d72e066a994))
* export the commit types the conventional presets know ([abeb206](https://github.com/ExaDev/workspace-conformance/commit/abeb206cf04a455bb66b371fdd01acd9fbe78be9))
* let single-storybook and dockerfile-package-manager leave paths out of their search ([3aaf4c9](https://github.com/ExaDev/workspace-conformance/commit/3aaf4c94bbc1210a033a729e4d819e76246435b7))
