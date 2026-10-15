import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
	worker: {
		name: "hackerthon-tycoon",
		compatibilityDate: "2025-10-01",
		entrypoint: "backend/worker.ts",
		assets: {
			runWorkerFirst: [
				"/api",
				"/api/*",
			],
		},
		env: {
			PLAYERS: bindings.durableObject({
				worker: "hackerthon-tycoon",
				exportName: "PlayerSave",
			}),
			LEADERBOARD: bindings.durableObject({
				worker: "hackerthon-tycoon",
				exportName: "Leaderboard",
			}),
			ASSETS: bindings.assets(),
		},
		exports: {
			PlayerSave: exports.durableObject({ storage: "sqlite" }),
			Leaderboard: exports.durableObject({ storage: "sqlite" }),
		},
	},
});
