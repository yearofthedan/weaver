# Changelog

## [0.1.11](https://github.com/yearofthedan/weaver/compare/weaver-v0.1.10...weaver-v0.1.11) (2026-09-03)


### Features

* **daemon:** add a RecordingFileSystem decorator over FileSystem ([5971751](https://github.com/yearofthedan/weaver/commit/597175168e76e28f24f0d45f2b072ddea4ee20d4))
* **daemon:** add a self-write ledger to distinguish daemon writes from external edits ([ae5eec6](https://github.com/yearofthedan/weaver/commit/ae5eec632ef7a73d8f3b359f5e3ad91a18acba6c))
* **daemon:** stop invalidating compilers on the daemon's own writes ([37120ce](https://github.com/yearofthedan/weaver/commit/37120cedff27e13cbe6383889586ff5c433a7d11))
* **ports:** expose mtimeMs from FileSystem.stat ([f1683ee](https://github.com/yearofthedan/weaver/commit/f1683eec971cf0a0c10a987fe63f7792ff814936))
* **ts-engine:** add refreshFile to the Engine interface ([efef711](https://github.com/yearofthedan/weaver/commit/efef711bfd0f02264f4f2ca365cea60dcf90fef9))
* **ts-engine:** add set-export for declaration visibility ([aa93372](https://github.com/yearofthedan/weaver/commit/aa93372c50d0b7bb8a2b632b9f475d7533f6f73c))


### Bug Fixes

* **daemon:** route post-write diagnostics through the project engine ([32692a8](https://github.com/yearofthedan/weaver/commit/32692a877a9948e2e7008e353146191e56097119))
* **deps:** update dependency @vue/language-core to v3.3.11 ([867c692](https://github.com/yearofthedan/weaver/commit/867c6927af695fd9409b524002dda17ae5c6599e))
* **deps:** update dependency zod to v4.5.2 ([8ef6119](https://github.com/yearofthedan/weaver/commit/8ef6119b4ae56c40d3b5c5dbc8a0acb097f7846b))
* **deps:** update dependency zod to v4.5.4 ([0e221c2](https://github.com/yearofthedan/weaver/commit/0e221c2d4aee41649817da8984ff4e030ddc5669))
* **ports:** move a directory's whole subtree on rename ([ab8dcaa](https://github.com/yearofthedan/weaver/commit/ab8dcaa8fb5e170fb18386331ba3d2c61151586b))
* **scenarios:** give a move target one shape so the harness typechecks ([7f83306](https://github.com/yearofthedan/weaver/commit/7f833062f78c7ab3f1b6d55b0de0da34c20ce18e))
* **test:** let Stryker reach tests that live beside test helpers ([a199a5e](https://github.com/yearofthedan/weaver/commit/a199a5e01054add1c5094a6ef101b0d179f22ee5))
* **test:** reach the tests the Stryker lane's exclude was hiding ([6bef13c](https://github.com/yearofthedan/weaver/commit/6bef13c6422557e8128789e05141dbc7e2753f91))
* **test:** run the mutation lane with the same per-test cleanup ([d21011d](https://github.com/yearofthedan/weaver/commit/d21011d4932a7c6e3a217363bde0f5b35eb07230))
* **ts-engine:** keep a byte-order mark at byte 0 when move-symbol adds an import ([aa6cda5](https://github.com/yearofthedan/weaver/commit/aa6cda53e4f7bc20b40f2d93b679a8afad34f193))
* **ts-engine:** route move-symbol and remove-importers writes through the FileSystem port ([6cafcb9](https://github.com/yearofthedan/weaver/commit/6cafcb9612e8943ef295ea202f7eb9e324da88b4))
* **ts-engine:** skip program-excluded files in project-wide type check ([e59e37f](https://github.com/yearofthedan/weaver/commit/e59e37f9807bebac697bcc3dcdb54cc3685c2f5f))
* **vue-engine:** follow aliased SFC imports through a moved file ([324e033](https://github.com/yearofthedan/weaver/commit/324e033a32ebf2fea8b1df7cf1063fd97b50c9ff))
* **vue:** apply the TypeScript path's specifier rule instead of a copy ([ad16042](https://github.com/yearofthedan/weaver/commit/ad160427b772cb0cee2674a79bd89096083d3a29))
* **vue:** report the same project-wide file set whichever engine answers ([f9a5cd8](https://github.com/yearofthedan/weaver/commit/f9a5cd8b034d739b32ff6062d0681197fa835e02))
* **vue:** route project-wide getTypeErrors through Volar for .ts too ([574ec65](https://github.com/yearofthedan/weaver/commit/574ec65f62938216ffaf68538925c39a5d1c2d0a))
* **vue:** route single-file .ts/.tsx getTypeErrors through Volar ([2c992cb](https://github.com/yearofthedan/weaver/commit/2c992cb1377a66ef30966735e8bb46d749c17ff4))
* **vue:** stop the SFC scan repointing imports it should leave alone ([7eb660f](https://github.com/yearofthedan/weaver/commit/7eb660faf26c228a7c2b6138429488d9cc748d76))


### Performance Improvements

* **daemon:** refresh every modified file before querying any of them ([f292219](https://github.com/yearofthedan/weaver/commit/f292219a331716b594b74259e5345f3308f2d1fe))

## [0.1.10](https://github.com/yearofthedan/weaver/compare/weaver-v0.1.9...weaver-v0.1.10) (2026-08-27)


### Features

* **eval:** add a real-host tool-use policy arm behind a flag ([8778d66](https://github.com/yearofthedan/weaver/commit/8778d669415484e33a739a15753333f9ab87dd3c))


### Bug Fixes

* **daemon:** guard the socket write against unserialisable responses ([d16dd2f](https://github.com/yearofthedan/weaver/commit/d16dd2f5d27c06bf3544102cfd7007c45dcb5d81))
* **daemon:** make dispatchRequest total so failures return, not throw ([2e63350](https://github.com/yearofthedan/weaver/commit/2e633503829527a76ab5c8bcbaf54f790b4b0bfa))
* **daemon:** route getTypeErrors to the correct engine in Vue projects ([dc3342f](https://github.com/yearofthedan/weaver/commit/dc3342f1f1b18b98a42d67af153dc4076b560b0b))
* **eval:** surface provider errors returned with a 200 status ([fc08004](https://github.com/yearofthedan/weaver/commit/fc08004851dd1e5948633e20329c6c2e6db54b9d))
* **replaceText:** remove dead empty-match branch, cover pattern-mode validation gaps ([613be9e](https://github.com/yearofthedan/weaver/commit/613be9e3a5ce2e2ec701f7426b82f5b98965d3ad))
* **schema:** reject glob/excludeGlob combined with edits in replace-text ([b971821](https://github.com/yearofthedan/weaver/commit/b9718218ecb1134c032859e0e45a4c802f003e98))

## [0.1.9](https://github.com/yearofthedan/weaver/compare/weaver-v0.1.8...weaver-v0.1.9) (2026-08-09)


### Features

* **eval:** add classifySkillReach to distinguish load from tool-style skill reach ([9b5acda](https://github.com/yearofthedan/weaver/commit/9b5acda6c39156ccbefd33b8cfa35d3ed9f1d309))
* **eval:** add pnpm eval:gate to run the gate across every roster model ([5b63f1d](https://github.com/yearofthedan/weaver/commit/5b63f1d3c90f7d53aba1433f6fa5664695f018c8))
* **eval:** add rate-gate escalation and verdict arithmetic ([9450c8a](https://github.com/yearofthedan/weaver/commit/9450c8a905b94a73be1f7a83d4dcbad58ad96b4e))
* **eval:** add the gating model roster ([90959e4](https://github.com/yearofthedan/weaver/commit/90959e40a187487a39ba303f9acdfbd281f0942f))
* **eval:** add TrialOutcome classification and OutcomeTally aggregation ([6ebe3b8](https://github.com/yearofthedan/weaver/commit/6ebe3b86bb2863b167382610bfd5d61c9ce2e1a9))
* **eval:** add WEAVER_EVAL_CLEAN to drop momentum turns ([6900633](https://github.com/yearofthedan/weaver/commit/69006339e1cb272bc35498d77679b9a9b28ad85b))
* **eval:** cap demotions per model and record today's accepted reds ([2cfd175](https://github.com/yearofthedan/weaver/commit/2cfd175d128d188e7db9ed084e0b53aa62bb4561))
* **eval:** extract the boundary gating decision into verdict.ts ([322f21a](https://github.com/yearofthedan/weaver/commit/322f21a6a2b2bdff52bf955b8aa0c7d685d0e647))
* **eval:** fold case table into a discriminated exposure union ([8d53992](https://github.com/yearofthedan/weaver/commit/8d539927328f394521c63772405ac2ed6a31df34))
* **eval:** omit temperature from the request body by default ([abf75fb](https://github.com/yearofthedan/weaver/commit/abf75fb80c831ff12f98f3825bb0058896bfece6))
* **eval:** print a run header naming model, trials, temperature, clean-mode ([3a3fcaf](https://github.com/yearofthedan/weaver/commit/3a3fcaf23c295438d0fbb3ec9c505f80b7ce9b29))
* **eval:** recognize tool-style skill reaches in the trigger lane ([0ae6746](https://github.com/yearofthedan/weaver/commit/0ae6746ae8b69bb3d8804975c424baee3dfd0cfc))
* **eval:** record a tool-style skill reach as a loaded, navigation-only call ([b24ace1](https://github.com/yearofthedan/weaver/commit/b24ace11f7b95f991d8457b461f28fdd7ffb55b9))
* **eval:** report the outcome composition in the trigger lane ([2e5ac66](https://github.com/yearofthedan/weaver/commit/2e5ac66c7aa4e06ea4952cf15507efdf65a504ab))
* **eval:** restore 3-turn pressure to the folded front-loaded cases ([da79762](https://github.com/yearofthedan/weaver/commit/da797620a2b62256e6c262d114e509abd5a350cf))
* **eval:** scope observational markers to the models they name ([b9c07c6](https://github.com/yearofthedan/weaver/commit/b9c07c60625ac947fca0ca044e8527fbed9087a2))
* **eval:** track and print OpenRouter cost per run ([449d61a](https://github.com/yearofthedan/weaver/commit/449d61ac9a47084e1cc93ce661233ba43710334e))
* **eval:** unify trial assembly and tighten the args gate across exposures ([ef7c816](https://github.com/yearofthedan/weaver/commit/ef7c81661a6d26a75027c2c0af65a61d8170b753))
* **eval:** wire the sampled rate gate into one lane and retire the split name ([3063feb](https://github.com/yearofthedan/weaver/commit/3063feb593972ee03ee130edd7dc546625f6e4c0))
* **file-walk:** support excludeGlob in walkWorkspaceFiles ([8d60016](https://github.com/yearofthedan/weaver/commit/8d6001633cb40a3a1a9c711a8dade7ae1fea476f))
* **protocol:** wire excludeGlob through schema and dispatcher ([d99ae2a](https://github.com/yearofthedan/weaver/commit/d99ae2ae117f00a89d9fe5473e6941cf8b3ef8be))
* **skills:** state that weaver is an installed package run from the shell ([28edd3e](https://github.com/yearofthedan/weaver/commit/28edd3ebb32675d8eea678b6f2eab2fbe155fb51))
* **utils:** add resetDiscoveryCaches for per-dispatch cache reset ([4d68a84](https://github.com/yearofthedan/weaver/commit/4d68a8438cf4ce04b0d2f7e2789709ad5b9b5821))


### Bug Fixes

* **build:** link the weaver self-dependency instead of copying it ([2eea3bb](https://github.com/yearofthedan/weaver/commit/2eea3bb7bc11999c9b89cb749126963e4bcac89e))
* **cli:** read --version from package.json instead of a hardcoded literal ([392a81e](https://github.com/yearofthedan/weaver/commit/392a81e2d90d26fea5e5ebe6660c8866b91a8ba0))
* **daemon:** reset discovery caches at the start of each dispatch ([2e65916](https://github.com/yearofthedan/weaver/commit/2e6591680c6dd432166c42c1a3c1a9a8a4d19533))
* **daemon:** reuse a daemon only when it runs the build on disk ([bb1647c](https://github.com/yearofthedan/weaver/commit/bb1647c4dc610e02fc152b093b678e6749e7c115))
* **daemon:** watch .vue files unconditionally so late-adopted Vue projects stay fresh ([a245423](https://github.com/yearofthedan/weaver/commit/a24542358ff183b7edc8cbae7e34e329dafc04e6))
* **deps:** update dependency @vue/language-core to v3.3.9 ([4dc21ce](https://github.com/yearofthedan/weaver/commit/4dc21ce7c76f831a751e58d4ff5fb34ba722347e))
* **eval:** alarm when a case ran no trials at all ([e677d35](https://github.com/yearofthedan/weaver/commit/e677d352ff1762ac1884caf589701df8e75186e2))
* **eval:** drop own-file inspect step from pressured-buried-rename ([1ff4073](https://github.com/yearofthedan/weaver/commit/1ff40733f4e830634bef8ae990a6376413e09c5a))
* **eval:** escalate a case that clears the floor but isn't a clean sweep ([03928f2](https://github.com/yearofthedan/weaver/commit/03928f265f600a7c45cb529c0e21ab0d0af1d57c))
* **eval:** reject a non-numeric trial-count override before it reaches the child ([590345a](https://github.com/yearofthedan/weaver/commit/590345a7cec9a775e96faf6f4161727a0587e71f))
* **eval:** stop sourcing WEAVER_EVAL_MODEL from .env ([19665cf](https://github.com/yearofthedan/weaver/commit/19665cf45903e8bde4b72a1d03e9d9e7c203ce86))
* **investigate:** require reproducing the exact bug mechanism, not just red ([b79e80b](https://github.com/yearofthedan/weaver/commit/b79e80bdfc73e4c77f27889140ee53d6f24f7d2e))

## [0.1.8](https://github.com/yearofthedan/weaver/compare/weaver-v0.1.7...weaver-v0.1.8) (2026-07-23)


### Features

* **eval:** accept npx weaver prefix in matchWeaverCommand ([a5b9e59](https://github.com/yearofthedan/weaver/commit/a5b9e59a15a33efb4501a2030597844cb996a20d))
* **eval:** add a mutation-testing lane scoped to the eval harness ([6c52de0](https://github.com/yearofthedan/weaver/commit/6c52de0755d9f1c21a8377206dc5b5ca736a3149))
* **eval:** add agentic loop for eventual-operation trigger metric ([6d68af8](https://github.com/yearofthedan/weaver/commit/6d68af8d9275d019bc620a9bd9f6c7de5ea389d9))
* **eval:** add agentic trigger lane ([4649ef5](https://github.com/yearofthedan/weaver/commit/4649ef5da626aca5bd8c11e556df66fd7ba41b1a))
* **eval:** add available_skills framing and rate-lane tool set ([a2ea8f7](https://github.com/yearofthedan/weaver/commit/a2ea8f7e6d5bb6ce8983fcb0bea2dae68931e6bd))
* **eval:** add boundary over-trigger guard and matchedAtStep reporting to agentic lane ([fe649db](https://github.com/yearofthedan/weaver/commit/fe649db2a605ce7aa98f3e86f0682ed29f9029a7))
* **eval:** add canned tool-result source for the agentic loop ([3f47ec2](https://github.com/yearofthedan/weaver/commit/3f47ec2e62b4ac8e899fc339eefd7ed5d36f3a21))
* **eval:** add expected weaver subcommand to skill-trigger cases ([5b1a430](https://github.com/yearofthedan/weaver/commit/5b1a4303f282b3caf295ab0369a18364875f14cc))
* **eval:** add isWeaverInvocation, computeRate, and export readSkillFile ([e9df4db](https://github.com/yearofthedan/weaver/commit/e9df4db8c9228c13b6c615570d8309ced4487391))
* **eval:** add optional hard-fail veto to runAgenticLoop ([84d892d](https://github.com/yearofthedan/weaver/commit/84d892df16d74633f2a220492013539bd4f888ee))
* **eval:** add per-case seed depth and observational gating to the agentic trigger lane ([cbe9ed1](https://github.com/yearofthedan/weaver/commit/cbe9ed162c82c389f078555fe548609024e0acf1))
* **eval:** add per-lane temperature config and hosted-endpoint fail-fast ([9d3b94e](https://github.com/yearofthedan/weaver/commit/9d3b94eeb0a1c90fd97c6da26ebe0914f1816713))
* **eval:** add WEAVER_EVAL_PROVIDER to pin the OpenRouter backend ([5e69744](https://github.com/yearofthedan/weaver/commit/5e697449403de44c475d8f818df50acaac2ebeb9))
* **eval:** add weaverSubcommand to parse the CLI subcommand token ([f0e8cc8](https://github.com/yearofthedan/weaver/commit/f0e8cc8ddbda2b7647537a2e472714a28c77c1dc))
* **eval:** capture the model's text when an agentic trial abandons ([d9dfb9b](https://github.com/yearofthedan/weaver/commit/d9dfb9b0b32dea12d841086e36bf7e81633ab790))
* **eval:** classify command matches into correct/wrong-tool/wrong-args ([c83c1d0](https://github.com/yearofthedan/weaver/commit/c83c1d0fbf6c14462c91e8232f2d6f4b6f706afc))
* **eval:** classify weaver subcommands as mutating or read-only ([66b33fb](https://github.com/yearofthedan/weaver/commit/66b33fb482baa6f91cdcac74b9ca088f848d5155))
* **eval:** credit right-skill tool call as a stopgap trigger proxy ([1283cc5](https://github.com/yearofthedan/weaver/commit/1283cc5fafede7e356802b53e462aa6468f9c121))
* **eval:** generalize agentic loop to predicate-based matching with SKILL.md tracking ([5a58952](https://github.com/yearofthedan/weaver/commit/5a58952683717f72bb9f31440907019d7c1d4270))
* **eval:** hard-fail the skill-trigger lane on a mutating competitor ([8125ea2](https://github.com/yearofthedan/weaver/commit/8125ea26df858d89c90c4624157d7b0797604ff8))
* **eval:** let a case override the canned result per weaver subcommand ([eb9415a](https://github.com/yearofthedan/weaver/commit/eb9415a85dfe235ed72eec0ff7c7b99668919aab))
* **eval:** let a case own its canned tool results ([ce1a1de](https://github.com/yearofthedan/weaver/commit/ce1a1dec3accccefe20ac6171039e18210accc4d))
* **eval:** log raw tool arguments and SKILL.md reads in rate-lane trails ([a3d223b](https://github.com/yearofthedan/weaver/commit/a3d223b90c82893d2ab62619d36cdf5a20e74157))
* **eval:** retire the single-shot trigger lanes and skillTools() ([c85e6e5](https://github.com/yearofthedan/weaver/commit/c85e6e5ec353516a46c63c86d2f057ce9a23274f))
* **eval:** rewire agentic trigger lane to two-hop rate design ([49bc204](https://github.com/yearofthedan/weaver/commit/49bc204c8f9aa0012bd61604a35e23298b588db1))
* **eval:** simulate the host skill mechanism in the rate lane ([d0d8c11](https://github.com/yearofthedan/weaver/commit/d0d8c11a1b3d9c4940c755ab6ed613b1b04a905e))
* **ports:** add readdir to the FileSystem port ([63087a7](https://github.com/yearofthedan/weaver/commit/63087a75c150d794a30bc55ee338730d623770ff))
* **skills:** add /investigate skill and [needs investigation] tag ([de744df](https://github.com/yearofthedan/weaver/commit/de744dfb21f53c83ba47dea228897e1d112ef2bc))
* **skills:** lead trigger descriptions with task phrasings, add tsc contrast ([8455693](https://github.com/yearofthedan/weaver/commit/845569363fdb0e5510ac1f80ebee52858c99475e))


### Bug Fixes

* **daemon:** register signal handlers before the daemon becomes discoverable ([eb44349](https://github.com/yearofthedan/weaver/commit/eb44349be5f0d7c468b5f4ca8932895a4fc21d52))
* **deps:** update dependency @vue/language-core to v3.3.6 ([4945d20](https://github.com/yearofthedan/weaver/commit/4945d20f6ad5a8138fff57baae086b6a95ded241))
* **deps:** update dependency @vue/language-core to v3.3.7 ([a9d6342](https://github.com/yearofthedan/weaver/commit/a9d63427ce28c28a5dc6693a84b5488f626088e1))
* **deps:** update vue-language-tools monorepo to v3.3.5 ([e4fda04](https://github.com/yearofthedan/weaver/commit/e4fda046a6a9202f50f5d6024f6329fd4c85402e))
* **eval:** detect a skill-load bundled as a non-first call ([8e02e00](https://github.com/yearofthedan/weaver/commit/8e02e00f0035ffce861527ac12f40672291be973))
* **eval:** drop unsatisfiable changelog pre-step from pressured replace-text rung ([ffd0745](https://github.com/yearofthedan/weaver/commit/ffd0745dbd80c61965cc0f92386db6b7ef7da567))
* **eval:** grade a hallucinated tool as a miss, not a harness crash ([50d6285](https://github.com/yearofthedan/weaver/commit/50d62857231397acdc2749e6b7a64b792ea0f00b))
* **eval:** guard WEAVER_EVAL_TEMPERATURE against blank and non-numeric values ([3bb8550](https://github.com/yearofthedan/weaver/commit/3bb8550da60a8feeed469266added406eeec2f86))
* **eval:** match path key args by trailing segment, not exact string ([deeda72](https://github.com/yearofthedan/weaver/commit/deeda723edaaa1a419fd93608b42f42be4cbb78a))
* **eval:** match skill SKILL.md reads by path suffix, not exact equality ([d51608c](https://github.com/yearofthedan/weaver/commit/d51608caafc8ba0ea2bc2fce3879c50f6a403191))
* **eval:** name the file in the pressured rename task ([9730c60](https://github.com/yearofthedan/weaver/commit/9730c60bf7b5679831c45901a621400712123a89))
* **eval:** replay agentic turns as a standard tool exchange ([d43ca3b](https://github.com/yearofthedan/weaver/commit/d43ca3b71c4f52b2a6e88f630a9af7bbccc0d592))
* **eval:** reshape pressured search-text rung so weaver's edge is real ([23f8eb0](https://github.com/yearofthedan/weaver/commit/23f8eb0d508b9f439a720482f0098a5fe5882e70))
* **eval:** split &&-chained bash commands in trigger matching ([533d09a](https://github.com/yearofthedan/weaver/commit/533d09a43bbf4d8a237585c3f8a85792c0a86d09))
* **eval:** split &&-chains when detecting a mutating competitor ([8e09165](https://github.com/yearofthedan/weaver/commit/8e091657c986a3d83acc8edc5061733edda664a0))
* **eval:** split pressured replace-text rung into active/passive ([2b7c808](https://github.com/yearofthedan/weaver/commit/2b7c808e7bcb1216f759183d63486aa4c71e9e74))
* **eval:** stop feeding unrelated scenario fixtures on unanticipated hops ([a2d1faf](https://github.com/yearofthedan/weaver/commit/a2d1faf5aaf4cba0d499bd9c4d9e3629232b905e))
* **eval:** surface empty-completion providers instead of scoring them 0 ([57d5510](https://github.com/yearofthedan/weaver/commit/57d5510e837808c3e0e84092b405c8875dbcf108))
* **eval:** tolerate malformed tool-call JSON from hosted models ([e8fd623](https://github.com/yearofthedan/weaver/commit/e8fd623b4bb372a2195a663aaba976a973f8de2b))
* **skills:** restore move-file/delete-file command-stage emission ([df6f951](https://github.com/yearofthedan/weaver/commit/df6f95126ac86a6bc77089360ef5de379fa32a97))
* **skills:** weaver-refactor owns the locate→rename flow ([3422c66](https://github.com/yearofthedan/weaver/commit/3422c667f0c0a2ec6e3edfb498f0c57bd7e967e8))


### Reverts

* command-lane free-hand runAgenticLoop rewrite ([28d3f0e](https://github.com/yearofthedan/weaver/commit/28d3f0e6da04bb3cbcf451da79f7a265d0f933f1))

## [0.1.7](https://github.com/yearofthedan/weaver/compare/weaver-v0.1.6...weaver-v0.1.7) (2026-06-16)


### Features

* **eval:** add adversarial trigger lane ([24e2bb3](https://github.com/yearofthedan/weaver/commit/24e2bb3a0adfbaed96f1e439a9a36b83a768ef85))
* **eval:** add cluttered system prompt builder for the adversarial lane ([21adb51](https://github.com/yearofthedan/weaver/commit/21adb51440ec6fd652675cda41d31e923c2dd93a))
* **eval:** add grep-primed habit-momentum seed for the adversarial lane ([8b1e8b4](https://github.com/yearofthedan/weaver/commit/8b1e8b45bb2537314f5388fd3cb431118e1bca8e))
* **eval:** export COMPETING_TOOLS for the adversarial trigger lane ([5e877d5](https://github.com/yearofthedan/weaver/commit/5e877d56a89ac6107050990401f47656dea803fc))
* **eval:** forward WEAVER_EVAL_API_KEY as bearer auth to model server ([5d8e144](https://github.com/yearofthedan/weaver/commit/5d8e144e97ce1271a5ff4d06880d92edfa642607))
* **file-walk:** wire compileGlob into walkWorkspaceFiles; smoke-test both operations ([d75d167](https://github.com/yearofthedan/weaver/commit/d75d167cde5e0faffbfe0099af8a3f460c406862))
* **globs:** add compileGlob with single brace group expansion ([862b53d](https://github.com/yearofthedan/weaver/commit/862b53d28c94ced342c6486acff7b10be57ed2bb))


### Bug Fixes

* ignore reports/ contents so stryker cache stays addable ([73f08b6](https://github.com/yearofthedan/weaver/commit/73f08b6ff57d179164dc897ce9e07d258a6cc335))
* **test:** scrub leaked git env so the suite is hermetic ([0baea08](https://github.com/yearofthedan/weaver/commit/0baea085534b6927ec622715c6a1cc74167335cd))

## [0.1.6](https://github.com/yearofthedan/weaver/compare/weaver-v0.1.5...weaver-v0.1.6) (2026-06-12)


### Features

* **cli:** add `weaver skills install` command ([2d5be91](https://github.com/yearofthedan/weaver/commit/2d5be91401ac5e81b769c63af9a5523b4ef37577))
* **cli:** remove serve command and MCP transport ([500f95a](https://github.com/yearofthedan/weaver/commit/500f95abd7e6ab2eaa84e00f5e53cf88fd32b4cc))
* **cli:** render JSON parameter breakdown in subcommand --help output ([b652295](https://github.com/yearofthedan/weaver/commit/b6522959dd0f2c38074ddaa09f8362f377419d0a))
* **eval:** adapt harness to local-model realities — per-skill tools, text emission, qwen2.5 ([32ae35a](https://github.com/yearofthedan/weaver/commit/32ae35a64e76c604af95f54dc83d022dbbfe42f5))
* **eval:** add case table, harness helpers, and coverage invariant ([b2f3455](https://github.com/yearofthedan/weaver/commit/b2f34559487c5bda81e818e38d3ceb7db8667144))
* **eval:** replace promptfoo harness with vitest + local model calls ([e189712](https://github.com/yearofthedan/weaver/commit/e18971202024be9d3a18fff2020b0df25c996da7))
* **schema:** co-locate parameter descriptions on Zod schema fields ([b5e4e7e](https://github.com/yearofthedan/weaver/commit/b5e4e7efe9991ffb864957f5f770b53887ae2f52))


### Bug Fixes

* **deps:** regenerate pnpm-lock.yaml in 9.0 format with pnpm 10 ([d8b101e](https://github.com/yearofthedan/weaver/commit/d8b101ebd6b95442ae06858b78812a6382f9cc31))
* **deps:** update vue-language-tools monorepo to v3.3.4 ([e80afda](https://github.com/yearofthedan/weaver/commit/e80afda9548548ea2c9c3a1f01107aa2448fd7a3))
* **skills:** correct stale cross-reference and over-replaced case id ([63fe9d0](https://github.com/yearofthedan/weaver/commit/63fe9d0207f9cd9170ab4773f7c505861e3a2daf))

## [0.1.5](https://github.com/yearofthedan/weaver/compare/weaver-v0.1.4...weaver-v0.1.5) (2026-06-05)


### Bug Fixes

* **deps:** update vue-language-tools monorepo to v3.3.3 ([ee006c0](https://github.com/yearofthedan/weaver/commit/ee006c0a2d5d85e5cb83f864b7615b1342c1e96d))

## [0.1.4](https://github.com/yearofthedan/weaver/compare/weaver-v0.1.3...weaver-v0.1.4) (2026-06-01)


### Bug Fixes

* **cli:** exit cleanly after spawning daemon ([72d5daa](https://github.com/yearofthedan/weaver/commit/72d5daa36573ef4bce506af47b4da0e3a284c8e9))
* **deps:** update dependency @vue/language-core to v3.3.2 ([baad07b](https://github.com/yearofthedan/weaver/commit/baad07b45bb611110e291c6b5ded06727dfc1efa))
* **deps:** update dependency commander to v15 ([b6afc74](https://github.com/yearofthedan/weaver/commit/b6afc74a97c216115eb0a2936fcab49f33042556))

## [0.1.3](https://github.com/yearofthedan/weaver/compare/weaver-v0.1.2...weaver-v0.1.3) (2026-05-13)


### Features

* **fixtures:** add seedNamedFixture and seedInlineFixture body helpers ([856c9eb](https://github.com/yearofthedan/weaver/commit/856c9eb962d70e6a6feee4420d55e895ae0e3ffe))
* **vue:** add self-import when symbol still used in script after move ([912dcc3](https://github.com/yearofthedan/weaver/commit/912dcc329d6857338948cbe23fb0d0f725031d28))
* **vue:** rewrite .ts and .vue importers after vue moveSymbol ([481aeb1](https://github.com/yearofthedan/weaver/commit/481aeb1c84c49ba77e04c323d9a08aadbac38f72))
* **vue:** support .vue destination in moveSymbol from .vue source ([fdb2107](https://github.com/yearofthedan/weaver/commit/fdb210794bb9efdf24315b038556f2128991e423))
* **vue:** support moveSymbol from .vue script setup to .ts dest ([df4d7c1](https://github.com/yearofthedan/weaver/commit/df4d7c178694bf0b65e9c6ec75f23452d07172a7))


### Bug Fixes

* make filesModified exhaustive and promote response-trust to invariant ([cf4dcca](https://github.com/yearofthedan/weaver/commit/cf4dcca01a95ec29eceab13d4f6474bfb05c2ea9))
* **package:** unblock consumer install and drop alpha dist-tag ([1ce0328](https://github.com/yearofthedan/weaver/commit/1ce0328270af643ed2ae3a9ba4cd49910632932e))

## [0.1.2](https://github.com/yearofthedan/weaver/compare/weaver-v0.1.1...weaver-v0.1.2) (2026-05-11)


### Features

* **check:** run coverage as part of pnpm check ([0254f1a](https://github.com/yearofthedan/weaver/commit/0254f1a15dd4d8cf0b9036e2388548c7ea00b9eb))
* **cli:** prioritise CLI as primary interface, fix --help exit code ([6d23e27](https://github.com/yearofthedan/weaver/commit/6d23e27054a119f41b408543f1245c225a58eec6))
* **scripts:** add devcontainer up and connect scripts ([493b550](https://github.com/yearofthedan/weaver/commit/493b5508bdbcef5c25d456a865c2ed8de04586b5))
* **ts-engine:** add import integrity to moveSymbol ([5c6ab54](https://github.com/yearofthedan/weaver/commit/5c6ab54050347a391190245d2d1b041577191b40))
* **ts-engine:** add nameMatches to rename — scan modified files for derived identifier names ([74ee159](https://github.com/yearofthedan/weaver/commit/74ee15956d0a452c9c2e058c2068cbdca18df573))
* **vue-engine:** add .vue SFC support to getTypeErrors ([cf629bd](https://github.com/yearofthedan/weaver/commit/cf629bd35821eafd10257bf80123957b643f24af))
* **vue-engine:** add nameMatches to VolarEngine.rename ([8d9620e](https://github.com/yearofthedan/weaver/commit/8d9620e0678b81ca3ff904c6b905b54b61cb50c1))
* **vue-engine:** extract function from &lt;script setup&gt; blocks ([73beb96](https://github.com/yearofthedan/weaver/commit/73beb96f44179829d2f87d39d002c6fd4cef1f68))
* **vue-engine:** rewrite Vue import specifiers after directory move ([53d8c61](https://github.com/yearofthedan/weaver/commit/53d8c6145ef6ae324400c3a560694de81c1a704e))


### Bug Fixes

* **ci:** add id-token: write permission to quality-feedback job ([7ebd38f](https://github.com/yearofthedan/weaver/commit/7ebd38f0509024fcb73fb7430b73aa61d18103cf))
* **ci:** scope mutation testing to fast-test tier and cache results ([e363dd2](https://github.com/yearofthedan/weaver/commit/e363dd24351804be1bb7b19896a5195fae025e9b))
* **deps:** override fast-uri to 3.1.2 to patch path traversal and host confusion vulns ([3c827b5](https://github.com/yearofthedan/weaver/commit/3c827b597c7ff7359b6383299d4e961d381ec0af))
* **deps:** regenerate pnpm-lock.yaml with overrides metadata ([4d679d6](https://github.com/yearofthedan/weaver/commit/4d679d6c63f41ccec04500c3e491acb9373b7b65))
* **deps:** regenerate pnpm-lock.yaml with overrides metadata for promptfoo 0.121.11 ([cfd11fc](https://github.com/yearofthedan/weaver/commit/cfd11fca1c1809ac75f3233df27be8556a5b9665))
* **deps:** update dependency @vue/language-core to v3.2.7 ([bd6eb9a](https://github.com/yearofthedan/weaver/commit/bd6eb9a0c6f08bf2614dfe8cc58e938fad0219af))
* **deps:** update dependency @vue/language-core to v3.2.8 ([a770dd0](https://github.com/yearofthedan/weaver/commit/a770dd0fdf6c9f440210239fd2c164c10d371fc2))
* **deps:** update dependency safe-regex2 to v5.1.1 ([be98d9e](https://github.com/yearofthedan/weaver/commit/be98d9ee857a64b3eaa7dd210ea7eee91169acac))
* **deps:** update dependency zod to v4.4.1 ([a1771f9](https://github.com/yearofthedan/weaver/commit/a1771f992c3e9be001e8202c8c51b15e6675919e))
* **deps:** update dependency zod to v4.4.3 ([82b80e4](https://github.com/yearofthedan/weaver/commit/82b80e40bb155952c4745a744840cf7d32e7db73))
* **lint:** sort imports in vue engine after applyRenameEdits addition ([5c2c14c](https://github.com/yearofthedan/weaver/commit/5c2c14c89bf096e86e9956e6beb4479420ad66df))
* **renovate:** correct devcontainer manager name ([99ffbe9](https://github.com/yearofthedan/weaver/commit/99ffbe9e6ee9f4c8c8281a11d5c7a1526fcb6229))
* **security,daemon:** canonicalise restricted paths and workspace keys via realpathSync ([88be01a](https://github.com/yearofthedan/weaver/commit/88be01a69b1b272fae4d23ffc962a812b33aeeda))
* **test:** remove non-null assertions in extract-symbol.test.ts ([f71a8d2](https://github.com/yearofthedan/weaver/commit/f71a8d2393dc558d9e2d3464447ee711a3bc978e))
* **ts-engine:** remove incorrect realpathSync from getEditsForFileRename ([9d7d43e](https://github.com/yearofthedan/weaver/commit/9d7d43e90b9c1d882d49e12521816969920a822d))
* **vue-engine:** use virtual .vue.ts paths for moveDirectory import rewriting ([78f0d9f](https://github.com/yearofthedan/weaver/commit/78f0d9f0a80d8078d11c1f051f39cdb23f2de6fe))
* **vue:** convert dynamic import to static; add applyExtractSymbol unit tests ([5eadd5f](https://github.com/yearofthedan/weaver/commit/5eadd5f916424cb92a82d6bc029088bde872c4fc))
* **vue:** throw INTERNAL_ERROR when extracted function not found ([7eafb18](https://github.com/yearofthedan/weaver/commit/7eafb18f28f75d0322e12e0f7ce6dcf086ab53e5))


### Reverts

* remove noise handoff entry for env-only test failures ([d9dc19a](https://github.com/yearofthedan/weaver/commit/d9dc19ad7a8f03aa20daacf70ff06d4408559800))

## [0.1.1](https://github.com/yearofthedan/weaver/compare/weaver-v0.1.0...weaver-v0.1.1) (2026-04-04)


### Features

* **agents:** add agent notes scratchpad for execution agent ([8c3fef1](https://github.com/yearofthedan/weaver/commit/8c3fef150e444cb9e22a6e548ae87fe7df9bebab))
* **agents:** add implementation-context skill and rework execution agent ([553f15e](https://github.com/yearofthedan/weaver/commit/553f15e2cdf989978edc045f6b5ee68b33cf781e))
* **agents:** add spec-agent and execution-agent subagent definitions ([4c016b4](https://github.com/yearofthedan/weaver/commit/4c016b4e0da089b2646b3e9f474c7e0a75434377))
* **ci:** add mutation triage skill and CI gate ([d10999b](https://github.com/yearofthedan/weaver/commit/d10999b37d4f716a0bb0ac22df2f2fbf62e8f47a))
* **cli:** add operation subcommands with JSON params ([f59e96e](https://github.com/yearofthedan/weaver/commit/f59e96ed37346fa510687404166decfdff52e8d5))
* **cli:** make --workspace optional, default to process.cwd() ([5daa2bc](https://github.com/yearofthedan/weaver/commit/5daa2bc4551894ce589166d436f4bc04592fc5bd))
* **compilers:** add moveDirectory to Compiler interface with ts-morph batch implementation ([ac04f03](https://github.com/yearofthedan/weaver/commit/ac04f034f2f878dca0b6f462211c38bf12bb1969))
* **daemon:** add opt-in verbose logging and surface skipped files ([c84d8bb](https://github.com/yearofthedan/weaver/commit/c84d8bb4946bab30c59d64a8d0f0dc479a959456))
* **daemon:** introduce LanguagePlugin contract and registry ([476fdda](https://github.com/yearofthedan/weaver/commit/476fddab623d31f3211aa37d4b846e60be251f63))
* **daemon:** protocol version check in ensureDaemon ([987b16b](https://github.com/yearofthedan/weaver/commit/987b16b5dea351dba8a1b570ebe074922bdb75db))
* **daemon:** replace ok field with three-value status in wire protocol ([a04cd08](https://github.com/yearofthedan/weaver/commit/a04cd08bcd6dc1d7fd8c145c86c76e253ea71bf0))
* **daemon:** return status warn when write operations leave type errors ([13dc34d](https://github.com/yearofthedan/weaver/commit/13dc34d41170a332e5794df23a635db2e441461d))
* **dispatcher:** make checkTypeErrors default-on for AI agent users ([f88c428](https://github.com/yearofthedan/weaver/commit/f88c428cc4e90ff453b8aede0c7fc043a3832c7e))
* **domain:** add ImportRewriter service with unit tests ([dbadc7e](https://github.com/yearofthedan/weaver/commit/dbadc7e6d69167d8061f289cfe44d231857b9c27))
* **domain:** add rewriteMovedFileOwnImports utility for moveFile ([55031ce](https://github.com/yearofthedan/weaver/commit/55031cecd55b647b04273d85066cad92448c0ab5))
* **domain:** add SymbolRef.fromExport with exported-symbol resolution ([9696aba](https://github.com/yearofthedan/weaver/commit/9696abaa7111764313f4a678b688671c8cef9ded))
* **domain:** add WorkspaceScope for boundary tracking and modification recording ([2327dd9](https://github.com/yearofthedan/weaver/commit/2327dd9ac6743d8f8a4b77b0c717282341490321))
* **domain:** extract fallback walk as shared rewriteImportersOfMovedFile function ([0ae3f29](https://github.com/yearofthedan/weaver/commit/0ae3f290798deb411627fb9ac2cd9462b72675d9))
* **domain:** isDirectExport distinguishes direct exports from re-exports ([30637c3](https://github.com/yearofthedan/weaver/commit/30637c348331c20f7c977fac1dc022f8ad1a2b2a))
* **domain:** make SymbolRef.remove() idempotent ([0aa34ce](https://github.com/yearofthedan/weaver/commit/0aa34ceac2405db24aecf68bfa67427c976a487e))
* **domain:** unwrap VariableDeclaration to VariableStatement in SymbolRef ([df863f4](https://github.com/yearofthedan/weaver/commit/df863f44d1d315416cec93ace939148136fd88fc))
* **eval:** add PromptFoo-based tool-description smoke test ([28cd5ea](https://github.com/yearofthedan/weaver/commit/28cd5eafea77d36602cb9e532ebc564662354cbe))
* **eval:** realistic prompts, two-step flows, and competing-tool tests ([14bbf17](https://github.com/yearofthedan/weaver/commit/14bbf170f351db4c389d4eaa3de8375d1af59be2))
* **mcp:** expose force parameter on moveSymbol tool ([c232094](https://github.com/yearofthedan/weaver/commit/c23209404f2b55ad2e0e058be8b922f4dfcf2ea3))
* **mcp:** standardise tool descriptions and move DAEMON_STARTING to server instructions ([33bc10f](https://github.com/yearofthedan/weaver/commit/33bc10ff77ad612bbb3ca2e5b727b47459b43e55))
* **mutation:** enable perTest coverage and fix test exclusions ([dbc4b38](https://github.com/yearofthedan/weaver/commit/dbc4b38a332285fd99d9f0022c9850e84611f979))
* **operations:** add checkTypeErrors param to write operations ([9e0117f](https://github.com/yearofthedan/weaver/commit/9e0117f527f3c165b1f45a8718a62dd3d81d8a88))
* **operations:** add deleteFile operation ([33c517c](https://github.com/yearofthedan/weaver/commit/33c517c870637d6727f65d5f602371d99feec262))
* **operations:** add findImporters — who imports this file? ([a6821bd](https://github.com/yearofthedan/weaver/commit/a6821bd48e35ca01d04abb1c98acff81c85de9f3))
* **operations:** add getTypeErrors MCP tool ([bc4cfc8](https://github.com/yearofthedan/weaver/commit/bc4cfc804190f86665436756069e0a38ce6033e3))
* **operations:** add moveDirectory operation (AC1) ([0acb303](https://github.com/yearofthedan/weaver/commit/0acb303e8a0f98fc9aef3615b1f8d0a4a2452772))
* **operations:** force flag replaces dest declaration with source version ([504a1d1](https://github.com/yearofthedan/weaver/commit/504a1d140c6a4be0d5319dc834294ab10fba6d67))
* **operations:** return SYMBOL_EXISTS when dest already exports the symbol ([b63248a](https://github.com/yearofthedan/weaver/commit/b63248ac9e883a2d8feaae592b2f3ad9e9c11070))
* **operations:** update deleteFile to use Engine.deleteFile() ([df9ec3b](https://github.com/yearofthedan/weaver/commit/df9ec3b2cfff827d84f01a366b47f804e2e1758e))
* **pkg:** add exports map and engines field for public release ([f6986dc](https://github.com/yearofthedan/weaver/commit/f6986dc82a36f72a3042a924a6f2d3dfbc67e81d))
* **ports:** add FileSystem port with NodeFileSystem and InMemoryFileSystem ([a10b5cb](https://github.com/yearofthedan/weaver/commit/a10b5cb93453357308025cfe68f32e03244b845e))
* prepare npm distribution as @yearofthedan/light-bridge ([def6d7d](https://github.com/yearofthedan/weaver/commit/def6d7dfcf1ec8c847090de89c28a24b07ed2d10))
* rename project from light-bridge to weaver ([8860831](https://github.com/yearofthedan/weaver/commit/8860831ff062fa2a612b4d60166989518abb4e45))
* **searchText:** replace context array with surroundingText string ([5b22e85](https://github.com/yearofthedan/weaver/commit/5b22e85a74aa93daac849ec7b5567ee52eddc21b))
* **security:** reject control characters in file paths ([585ae5a](https://github.com/yearofthedan/weaver/commit/585ae5a680cde59c0d23fc4e24bf3db0dd7e8419))
* ship refactoring skill file with npm package ([c8306da](https://github.com/yearofthedan/weaver/commit/c8306da13823cc97b2ce23f3170f3a4aa1c87b54))
* **skills:** add CLI refactoring skill for agents without MCP ([2c79cd2](https://github.com/yearofthedan/weaver/commit/2c79cd2d94a1c3af00889a2b733c40025bd7866b))
* **stryker:** enable incremental mode with committed cache ([44e1324](https://github.com/yearofthedan/weaver/commit/44e1324ca7f22610485a3a0eb1ba01934a98733f))
* **test:** add Stryker mutation testing for security and utils ([3444c98](https://github.com/yearofthedan/weaver/commit/3444c98dfdc465961ef94478906641e07e1266a2))
* **ts-engine:** add extractFunction MCP tool ([d8112f1](https://github.com/yearofthedan/weaver/commit/d8112f1fc6cc96720e162937d084dfff832cb332))
* **ts-engine:** create tsMoveFile standalone action function ([3d0d6d5](https://github.com/yearofthedan/weaver/commit/3d0d6d51be7af9b2eebfcb8b02fb807ab29aa050))
* **ts-engine:** expand project graph to include all workspace files ([a12edd5](https://github.com/yearofthedan/weaver/commit/a12edd5b7b341fa15587f8be3797657ce5885827))
* **ts-engine:** extract tsDeleteFile standalone action function ([0e554f8](https://github.com/yearofthedan/weaver/commit/0e554f8f65c02b88fdaac5f3bae6740feefa4168))
* **vue-engine:** expand Volar project graph to include all workspace files ([d925161](https://github.com/yearofthedan/weaver/commit/d925161b9cb2174837e2c97a80158e63411b14ed))
* **vue-engine:** implement getFileReferences for Vue projects ([3e10774](https://github.com/yearofthedan/weaver/commit/3e1077445c9b9ce9a5f7e96e8146b1e878207957))


### Bug Fixes

* **agents:** prevent execution agent from completing orchestrator tasks ([e267bec](https://github.com/yearofthedan/weaver/commit/e267bec5f45e5d417f4da0fe526b22d95041f6c7))
* **agents:** remove dead Agent(Explore) config, add tee rule to system prompt ([34daf19](https://github.com/yearofthedan/weaver/commit/34daf1922eb98449596863482fcc63d0b98998b5))
* **agents:** remove spec-agent subagent ([89511b6](https://github.com/yearofthedan/weaver/commit/89511b6d77a50f1b1217bf4621e0ff3ddaac7886))
* apply biome formatting to package.json ([22179bd](https://github.com/yearofthedan/weaver/commit/22179bd1b86db9251d5d58e3d171f86e12803de5))
* **biome:** update schema version to match CLI 2.4.6 ([45ebfa5](https://github.com/yearofthedan/weaver/commit/45ebfa55a7e003bbd4b5c2df7bdf69da49a52fda))
* **ci:** add contents: read permission to CodeQL workflow ([b310063](https://github.com/yearofthedan/weaver/commit/b3100633c958decc4b5ef49f5dabb4a866d7cc7a))
* **cli:** set execute permission on dist/cli.js after build ([#45](https://github.com/yearofthedan/weaver/issues/45)) ([f2268bc](https://github.com/yearofthedan/weaver/commit/f2268bc94caa5cf7e437248f837e826ae5e71f0f))
* **compilers:** rewrite imports inside moved out-of-project files ([730b7c6](https://github.com/yearofthedan/weaver/commit/730b7c6badd88c0ca0b3bd132695b5b1b9685441))
* **compilers:** use sourceFile.getFilePath() for TS language service calls ([d90bd39](https://github.com/yearofthedan/weaver/commit/d90bd39a105e5ced0f309823e095352c4d72e0c9))
* **daemon:** preserve PARSE_ERROR for JSON syntax errors in catch-all ([08ca1a4](https://github.com/yearofthedan/weaver/commit/08ca1a4262612748882a1a896a777509159fbadb))
* **daemon:** use INTERNAL_ERROR for unexpected errors in catch-all ([2d98ed8](https://github.com/yearofthedan/weaver/commit/2d98ed8bc46f049621d6272167fbb83e4a62ad47))
* **daemon:** use JSON lockfile and socket check to detect recycled PIDs ([0293a6e](https://github.com/yearofthedan/weaver/commit/0293a6e9feb35f5562b81c18a97fef42643fa212))
* **deps:** downgrade typescript to 5.9.3 for ts-morph compatibility ([cdc27f8](https://github.com/yearofthedan/weaver/commit/cdc27f80c22b96415f7364c4759604e52c316282))
* **deps:** pin vulnerable transitive deps via pnpm overrides ([d43e4a9](https://github.com/yearofthedan/weaver/commit/d43e4a958f36edb6544ac0b79a6ecdbadf7afedb))
* **deps:** update dependency @modelcontextprotocol/sdk to v1.27.1 ([dc85f84](https://github.com/yearofthedan/weaver/commit/dc85f847be649217e924c85c6499b5cd280240f5))
* **deps:** update dependency @modelcontextprotocol/sdk to v1.28.0 ([8029853](https://github.com/yearofthedan/weaver/commit/8029853ab27e3a4e50a2be5906302d419e946095))
* **deps:** update dependency @modelcontextprotocol/sdk to v1.29.0 ([8061c2e](https://github.com/yearofthedan/weaver/commit/8061c2e0a00493890d0e56547a1ff21ef3e980b2))
* **deps:** update dependency @vue/language-core to v3.2.5 ([b3a10bf](https://github.com/yearofthedan/weaver/commit/b3a10bf3fe671d51efac83befd23b09a9fc83ebf))
* **deps:** update dependency @vue/language-core to v3.2.6 ([a782513](https://github.com/yearofthedan/weaver/commit/a78251395819be57be514dfcd68ad868dbb73bbe))
* **deps:** update dependency commander to v14 ([ce879e6](https://github.com/yearofthedan/weaver/commit/ce879e6c0d7d8b1f473480fe398997899ee1eaf4))
* **deps:** update dependency safe-regex2 to v5.1.0 ([c17647c](https://github.com/yearofthedan/weaver/commit/c17647cd6dcb45945a986763f4d05f468de4eb1d))
* **deps:** update dependency ts-morph to v27 ([e478af1](https://github.com/yearofthedan/weaver/commit/e478af157b36b968fa85307e036fb6a48d743371))
* **deps:** update dependency typescript to v6 ([3dda7c9](https://github.com/yearofthedan/weaver/commit/3dda7c9a6472fbb4c54875407c03edd4c90e00d5))
* **docs:** remove success message from response examples ([5f42e7a](https://github.com/yearofthedan/weaver/commit/5f42e7aecc7869039df149f9d15c7c8a487191f6))
* **eval:** resolve 3 failures from first live run ([ea679e7](https://github.com/yearofthedan/weaver/commit/ea679e7dcf27ce67fb257ea73bcfc637d8a7031f))
* **file-walk:** filter git-tracked files deleted from disk ([b96ff76](https://github.com/yearofthedan/weaver/commit/b96ff76af845b02578bad6320e83bb318f3b7330))
* **lint:** resolve noNonNullAssertion warnings and bump biome schema ([f63c205](https://github.com/yearofthedan/weaver/commit/f63c20577c41c9275dfa5d6b10e3f3309e963ba6))
* **mcp:** add 30s timeout to callDaemon socket ([9ddeafa](https://github.com/yearofthedan/weaver/commit/9ddeafa87aa8859f10ece63bd120505b3c6ae971))
* **mcp:** distinguish connection failures from other errors in catch block ([61fd335](https://github.com/yearofthedan/weaver/commit/61fd335803bdfa7998084dfbf45c6fc9f71b3798))
* **mcp:** fix stderr buffer re-parsing and derive input schemas from schema.ts ([058c2d0](https://github.com/yearofthedan/weaver/commit/058c2d04063127b165b0ed591806f7d592ac87d6))
* **operations:** make moveDirectory atomic with compute-before-mutate ([a6b4698](https://github.com/yearofthedan/weaver/commit/a6b46981005ad361d4ad6aaddf0b27790df64a62))
* **operations:** reliably rewrite imports after moveFile ([4cb655a](https://github.com/yearofthedan/weaver/commit/4cb655a12e58a2ced469d14a3490cbdc3ae75657))
* **operations:** rewrite moveDirectory as thin orchestrator over compiler.moveDirectory() ([581b8b9](https://github.com/yearofthedan/weaver/commit/581b8b9bb75f62ddbb13a9d2e348c9dc843c8178))
* **operations:** strip DiagnosticMessageChain; use real chain fixture ([3b51b4f](https://github.com/yearofthedan/weaver/commit/3b51b4f88abd2bef5e1f46ca7b6de37330056e38))
* **renaming:** only rewrite import specifiers when renaming an import ([6e7f51b](https://github.com/yearofthedan/weaver/commit/6e7f51b8fd6d53259e971c7a0e6f692a9f587f92))
* restore section banners, only remove AC-referencing comments ([511952c](https://github.com/yearofthedan/weaver/commit/511952cd9c2b7ea6487439d855340a24dd821d46))
* **scripts:** split test script so file args work correctly ([31d074c](https://github.com/yearofthedan/weaver/commit/31d074c6613cb9ba525b4823302b76b107aaf2ff))
* **security:** delete dead protocol.ts (zero imports) ([49744f2](https://github.com/yearofthedan/weaver/commit/49744f283043b978d4d8c922f5ef883025804fbb))
* **security:** expand sensitive file blocklist ([580e2d2](https://github.com/yearofthedan/weaver/commit/580e2d25545b00ef4a9ae4a53f23d2f6caeff72f))
* **security:** guard deleteFile against sensitive files, add .envrc ([73da2ca](https://github.com/yearofthedan/weaver/commit/73da2caeb5484e03daa9249e2078c39b71af651b))
* **security:** resolve CodeQL code-scanning alerts ([6d64ecc](https://github.com/yearofthedan/weaver/commit/6d64ecc57ed77e874234e8ebd313832b29e54d00))
* **skills:** enforce checkpoint stops in spec workflow ([7b47671](https://github.com/yearofthedan/weaver/commit/7b47671c16a0d7b2118b539bb49bd3f66656a6f1))
* **skills:** steer spec red-flags toward quality model, not just size thresholds ([643b37b](https://github.com/yearofthedan/weaver/commit/643b37b8ae8e692de658491b57bfb6bb40e22a55))
* **stryker:** exclude __testHelpers__ from mutate glob ([3bcdcfe](https://github.com/yearofthedan/weaver/commit/3bcdcfe47422af6962d29e8e1a5c991cc0bb88a7))
* **stryker:** ignore .pnpm-store in sandbox copy ([13941c1](https://github.com/yearofthedan/weaver/commit/13941c1c344dcbae796bb563dbbcb8633655acf8))
* **test:** increase stop integration test timeout to 20s ([54ca5df](https://github.com/yearofthedan/weaver/commit/54ca5df2521d050845a502c409709548c1e6d119))
* **test:** pass workspace arg in moveFile Vue test; mark Issue [#3](https://github.com/yearofthedan/weaver/issues/3) done ([943f0ee](https://github.com/yearofthedan/weaver/commit/943f0ee9e35d9bb338a935d5c1d73526cfd4114c))
* **tests:** add global engine cleanup to prevent memory leaks ([517c2ba](https://github.com/yearofthedan/weaver/commit/517c2ba637a4b8f67bf07263dbcb7f82f27a9798))
* **tests:** parse JSON lockfile in killDaemon to stop daemon leaks ([1b8a59a](https://github.com/yearofthedan/weaver/commit/1b8a59a7de33fa507e21d75ac702a5a98445b1e7))
* **test:** use sandbox mode for Stryker, expand to full operations scope ([b1d4c4d](https://github.com/yearofthedan/weaver/commit/b1d4c4d2732629f149e5a44f744128ae7aa7c405))
* **ts-compiler:** preserve project graph across sequential moveFile calls ([5ecb3eb](https://github.com/yearofthedan/weaver/commit/5ecb3ebba89f14816bb15b12d817b13aa5bde3df))
* **ts-engine:** rewrite out-of-project imports after moveSymbol ([694c068](https://github.com/yearofthedan/weaver/commit/694c0689b2f4e81fbf217c47e672005fe53034be))
* update SECURITY.md advisory URL to renamed repo ([9f1da49](https://github.com/yearofthedan/weaver/commit/9f1da491ff863d2bb7f56576debee4647605cc14))
* **utils:** emit runtime .js extensions in computeRelativeImportPath ([04cb3aa](https://github.com/yearofthedan/weaver/commit/04cb3aa670608eee9ad8e04c369b9779f58ecd72))
* **utils:** make globToRegex match root-level files and directory direct children ([13899b4](https://github.com/yearofthedan/weaver/commit/13899b49932d3a07a9d6e665a8e9f5585028b3c2))
* **utils:** scope isVueProject to tsconfig include/exclude patterns ([095a694](https://github.com/yearofthedan/weaver/commit/095a694df4b9f1a922933247bc90d3d3de9254ff))
* **vue-provider:** call toVirtualLocation before findRenameLocations and getReferencesAtPosition ([7aca2a8](https://github.com/yearofthedan/weaver/commit/7aca2a81bea43c1cbabb76ab40a935dbad31cd9a))


### Performance Improvements

* **stryker:** exclude dispatcher tests from mutation runs ([2b369a0](https://github.com/yearofthedan/weaver/commit/2b369a0b3d78d1fbbc6905d82383534bef96dcd1))
