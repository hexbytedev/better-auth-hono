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
	if (missing.size > 0) {
		const vars = Array.from(missing).sort();
		console.error(
			`[ENV] Missing ${vars.length} required environment variable${vars.length > 1 ? "s" : ""}:\n${vars.map((v) => `  - ${v}`).join("\n")}`,
		);
		throw new Error(`Missing required environment variables: ${vars.join(", ")}`);
	}
}
