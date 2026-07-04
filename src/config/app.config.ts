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

	if (parsed < min) {
		console.warn(`${options?.name || "Value"} ${parsed} is below minimum ${min}. Using minimum.`);
		return min;
	}

	if (parsed > max) {
		console.warn(`${options?.name || "Value"} ${parsed} exceeds maximum ${max}. Using maximum.`);
		return max;
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
 * Get allowed origins from environment variables
 * Trims all values to prevent whitespace issues
 */
export function getAllowedOrigins(): string[] {
	const additionalOrigins = parseCommaSeparated(process.env.ALLOWED_ORIGINS);

	const origins: string[] = [];

	if (CLIENT_URL) {
		origins.push(CLIENT_URL);
	}

	origins.push(...additionalOrigins);

	// Remove duplicates
	return origins.filter((origin, index, self) => self.indexOf(origin) === index);
}
