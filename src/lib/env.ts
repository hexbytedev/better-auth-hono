// lib/env.ts

const missing = new Set<string>();

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
