import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

// Get credentials from env and trim whitespace safely
const AUTH_USER = process.env.API_AUTH_USER?.trim();
const AUTH_PASS = process.env.API_AUTH_PASSWORD?.trim();

// Check if Basic Auth is enabled
export const isBasicAuthEnabled = !!(AUTH_USER && AUTH_PASS);

function safeCompare(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);

	if (bufA.length !== bufB.length) {
		return false;
	}

	return timingSafeEqual(bufA, bufB);
}

/**
 * Validates HTTP Basic Auth (Username & Password)
 * If credentials are not configured, this middleware will be skipped
 */
export const validateBasicAuth = async (c: Context, next: Next) => {
	// If Basic Auth is not configured, skip validation
	if (!isBasicAuthEnabled) {
		await next();
		return;
	}

	// 1. Extract Authorization Header
	const authHeader = c.req.header("Authorization");

	if (!authHeader) {
		// Return 401 with WWW-Authenticate header (Standard Basic Auth behavior)
		c.header("WWW-Authenticate", 'Basic realm="API Access"');
		return c.json(
			{
				success: false,
				error: "Unauthorized",
				message: "Authentication required.",
			},
			401,
		);
	}

	// 2. Decode Header (Format: "Basic <base64>")
	const [scheme, token] = authHeader.split(" ");

	if (!scheme || !token || scheme.toLowerCase() !== "basic") {
		c.header("WWW-Authenticate", 'Basic realm="API Access"');
		return c.json(
			{
				success: false,
				error: "Unauthorized",
				message: "Authentication required.",
			},
			401,
		);
	}

	// 3. Decode Base64 and Validate credentials
	try {
		// Decode Base64 string "username:password"
		const credentials = Buffer.from(token, "base64").toString("utf-8");
		const separatorIndex = credentials.indexOf(":");

		if (separatorIndex === -1) {
			return c.json(
				{
					success: false,
					error: "Bad Request",
					message: "Invalid authentication token format.",
				},
				400,
			);
		}

		const username = credentials.slice(0, separatorIndex);
		const password = credentials.slice(separatorIndex + 1);

		if (!safeCompare(username, AUTH_USER!) || !safeCompare(password, AUTH_PASS!)) {
			console.warn(
				`[Security] Failed login attempt from IP: ${c.req.header("x-forwarded-for") || "unknown"}`,
			);

			c.header("WWW-Authenticate", 'Basic realm="API Access"');
			return c.json(
				{
					success: false,
					error: "Unauthorized",
					message: "Invalid authentication credentials.",
				},
				401,
			);
		}

		// 4. Success
		await next();
	} catch (error) {
		console.error("[Security] Error processing Basic Auth:", error);
		return c.json(
			{
				success: false,
				error: "Bad Request",
				message: "Invalid authentication token format.",
			},
			400,
		);
	}
};
