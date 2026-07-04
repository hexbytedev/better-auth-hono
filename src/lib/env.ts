// lib/env.ts

const missing = new Set<string>();

/**
 * Reads a required environment variable.
 *
 * When the variable is unset, the name is accumulated into `missing` (so
 * `checkEnv()` can report every missing var at once) and an **empty string** is
 * returned instead of throwing. This is deliberate: it lets the whole module
 * graph import successfully so a single aggregated error is printed at startup,
 * rather than the process dying on the first missing var.
 *
 * CONTRACT: because `checkEnv()` runs *after* the modules that call this at
 * module scope have already been imported, the `""` placeholder must be inert.
 * Module-scope consumers of a `requireEnv` value must not trigger side effects
 * on it before `checkEnv()` exits — e.g. no eager network/DB connections, no
 * option validation that throws on `""`, no writing the placeholder anywhere
 * observable. Defer such work behind a lazy getter (see `getResend()` in
 * `lib/email.ts`) so it never executes with placeholder config.
 */
export function requireEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		missing.add(name);
		return "";
	}
	return value;
}

export function envWithDefault(name: string, defaultVal: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		console.log(`[ENV] ${name} not set, using default: "${defaultVal}"`);
		return defaultVal;
	}
	return value;
}

export function optionalEnv(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value || undefined;
}

export function checkEnv(): void {
	if (missing.size === 0) return;

	const vars = Array.from(missing).sort();
	const label = vars.length === 1 ? "variable is" : "variables are";

	console.error(
		`\n  ${vars.length} required environment ${label} missing:\n${vars.map((v) => `    · ${v}`).join("\n")}\n\n  Set them in .env.local or the environment and restart.\n  See .env.sample for the full list of available variables.\n`,
	);
	process.exit(1);
}
