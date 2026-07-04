// src/config/app.config.ts

// Default application settings
const DEFAULT_APP_PORT = 8558;

import { requireEnv } from "../lib/env";

const CLIENT_URL = requireEnv("CLIENT_URL");

/**
 * Safely trim a string value, handling undefined/null
 */
function safeTrim(value: string | undefined | null): string {
	if (value === undefined || value === null) return "";
	return value.trim();
}

/**
 * Parse comma-separated string to array, trimming all whitespace
 */
function parseCommaSeparated(value: string | undefined): string[] {
	const trimmed = safeTrim(value);
	if (!trimmed) return [];

	return trimmed
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

/**
 * Parse and validate a number from environment variable
 * Returns default if not provided, invalid, or out of range
 */
export function parseNumber(
	value: string | undefined,
	defaultValue: number,
	options?: { min?: number; max?: number; name?: string },
): number {
	const trimmed = safeTrim(value);
	if (!trimmed) return defaultValue;

	const parsed = Number.parseInt(trimmed, 10);

	if (Number.isNaN(parsed)) {
		console.warn(`Invalid ${options?.name || "value"}: "${value}". Using default: ${defaultValue}`);
		return defaultValue;
	}

	const min = options?.min ?? Number.MIN_SAFE_INTEGER;
	const max = options?.max ?? Number.MAX_SAFE_INTEGER;

	// Out-of-range: fall back to the default rather than clamp, so a misconfigured
	// value never silently becomes a surprising boundary (e.g. APP_PORT=0 -> 1).
	if (parsed < min || parsed > max) {
		console.warn(
			`${options?.name || "Value"} ${parsed} is outside [${min}, ${max}]. Using default: ${defaultValue}`,
		);
		return defaultValue;
	}

	return parsed;
}

/**
 * Get application port from environment variable
 * Default: 8558, Valid range: 1-65535
 */
export function getAppPort(): number {
	return parseNumber(process.env.APP_PORT, DEFAULT_APP_PORT, {
		min: 1,
		max: 65535,
		name: "APP_PORT",
	});
}

/**
 * Get application host from environment variable
 * Returns undefined if not provided (lets the server bind to default)
 */
export function getAppHost(): string | undefined {
	const trimmed = safeTrim(process.env.APP_HOST);
	return trimmed || undefined;
}

/**
 * Normalize a configured origin to the exact form a browser sends in the Origin
 * header (scheme://host[:port], lowercased, no path or trailing slash), so the
 * CORS / trustedOrigins exact-match comparison works. Returns null for anything
 * that is not a usable absolute web origin.
 */
function normalizeOrigin(value: string): string | null {
	try {
		const origin = new URL(value).origin;
		// `new URL(...).origin` is the string "null" for opaque origins (non-web
		// schemes); never allow that, or a request with `Origin: null` would match.
		if (origin === "null") {
			console.warn(`[CORS] Ignoring origin with no usable value: "${value}"`);
			return null;
		}
		return origin;
	} catch {
		console.warn(`[CORS] Ignoring invalid origin entry: "${value}"`);
		return null;
	}
}

/**
 * Get allowed origins from environment variables, normalized to the exact form
 * browsers send (scheme://host[:port]) so the CORS / trustedOrigins comparison
 * works even if CLIENT_URL/ALLOWED_ORIGINS have a trailing slash, path, or
 * mixed case.
 */
export function getAllowedOrigins(): string[] {
	const raw = [CLIENT_URL, ...parseCommaSeparated(process.env.ALLOWED_ORIGINS)].filter(
		(value) => value.length > 0,
	);

	const normalized = raw.map(normalizeOrigin).filter((origin): origin is string => origin !== null);

	// Remove duplicates
	return [...new Set(normalized)];
}
