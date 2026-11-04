// @ts-expect-error Electrobun does not supply data types.
import type { ElectrobunConfig } from "electrobun";

// Set to true to disable minification, so code is more readable in the DevTools console
// DEVELOPER NOTE: Please disable this option before compiling production installers.
const devMode = true;

// Set to "cottontail" for a much smaller app binary
// WARNING: Cottontail is early in developement and is NOT stable
// DEVELOPER NOTE: If you are a developer for Playpen Software, you have to compile
// versions for both Bun and Cottontail, labeling the Cottontail installer as experimental
const mainProcess = "bun";

// When set to true, the app will use CEF instead of the user's system WebView.
// DEVELOPER NOTE: If you are a developer for Playpen Software, you have to compile
// versions that both bundle CEF and don't bundle DEF.
// YOU ONLY HAVE TO COMPILE CEF VERSIONS FOR THE STABLE BRANCH FOR LINUX/WINDOWS
// Do not compile CEF versions for versions using the "cottontail" mainProcess unless
// you are just messing around with it on your own :)

const useChromeEmbededFramework = false;

export default {
	app: {
		name: "Playpen Store",
		identifier: "store.playpensoftware.com",
		version: "1.0.0",
	},
	build: {
		mainProcess: mainProcess,
		cottontail: {
			entrypoint: "src/bun/index.ts",
			minify: !devMode
		},
		bun: {
			entrypoint: "src/bun/index.ts",
			minify: !devMode
		},
		views: {
			store: {
				entrypoint: "src/store/modules/index.ts",
				allowed_protocols: ["appdata"],
				minify: !devMode
			},
			updater: {
				entrypoint: "src/updater/modules/index.ts",
				minify: !devMode
			}
		},
		copy: {
			"src/store/assets/svg": "views/store/assets/svg",
			"src/store/assets/img": "views/store/assets/img",
			"src/store/store.html": "views/store/store.html",
			"src/updater/updater.html": "views/updater/updater.html"
		},
		linux: {
			bundleCEF: useChromeEmbededFramework,
		},
		win: {
			bundleCEF: useChromeEmbededFramework,
			icon: "src/build/favicon.ico"
		},
	},
} satisfies ElectrobunConfig;