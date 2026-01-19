import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

// Get credentials from env and trim whitespace safely
const AUTH_USER = process.env.API_AUTH_USER?.trim();
if (!AUTH_USER) throw new Error("API_AUTH_USER is missing");

const AUTH_PASS = process.env.API_AUTH_PASSWORD?.trim();
if (!AUTH_PASS) throw new Error("API_AUTH_PASSWORD is missing");

/**
 * Validates HTTP Basic Auth (Username & Password)
 */
export const validateBasicAuth = async (c: Context, next: Next) => {
	// 1. Configuration Check
	if (!AUTH_USER || !AUTH_PASS) {
		console.error("[Security] API_AUTH_USER or API_AUTH_PASSWORD is not set in .env");
		return c.json(
			{
				success: false,
				error: "Server Configuration Error",
				message: "Authentication is not configured correctly on the server.",
			},
			500,
		);
	}

	// 2. Extract Authorization Header
	const authHeader = c.req.header("Authorization");

	if (!authHeader) {
		// Return 401 with WWW-Authenticate header (Standard Basic Auth behavior)
		c.header("WWW-Authenticate", 'Basic realm="API Access"');
		return c.json(
			{
				success: false,
				error: "Unauthorized",
				message: "Authorization header is missing.",
			},
			401,
		);
	}

	// 3. Decode Header (Format: "Basic <base64>")
	const [scheme, token] = authHeader.split(" ");

	if (!scheme || !token || scheme.toLowerCase() !== "basic") {
		return c.json(
			{
				success: false,
				error: "Unauthorized",
				message: "Invalid authentication scheme. Use 'Basic <token>'.",
			},
			401,
		);
	}

	// 4. Decode Base64 and Validate credentials
	try {
		// Decode Base64 string "username:password"
		const credentials = Buffer.from(token, "base64").toString("utf-8");
		const [username, password] = credentials.split(":");

		// Compare with Environment Variables safely
		const safeCompare = (a: string, b: string) => {
			const bufA = Buffer.from(a ?? "");
			const bufB = Buffer.from(b ?? "");

			if (bufA.length !== bufB.length) {
				return false;
			}
			return timingSafeEqual(bufA, bufB);
		};

		if (!safeCompare(username, AUTH_USER) || !safeCompare(password, AUTH_PASS)) {
			console.warn(
				`[Security] Failed login attempt from IP: ${c.req.header("x-forwarded-for") || "unknown"}`,
			);

			return c.json(
				{
					success: false,
					error: "Unauthorized",
					message: "Invalid username or password.",
				},
				401,
			);
		}

		// 5. Success
		// console.log(`[API Access] Authorized access by: ${username}`);
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
