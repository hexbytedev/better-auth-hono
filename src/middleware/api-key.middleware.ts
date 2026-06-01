import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

// Get credentials from env and trim whitespace safely
const AUTH_USER = process.env.API_AUTH_USER?.trim();
const AUTH_PASS = process.env.API_AUTH_PASSWORD?.trim();

// Get allowed IPs from env (comma-separated, trim each)
const ALLOWED_IPS_RAW = process.env.API_ALLOWED_IPS?.trim();
const ALLOWED_IPS = ALLOWED_IPS_RAW
	? ALLOWED_IPS_RAW.split(",")
			.map((ip) => ip.trim())
			.filter((ip) => ip.length > 0)
	: [];

// Check if Basic Auth is enabled
export const isBasicAuthEnabled = !!(AUTH_USER && AUTH_PASS);

// Check if IP whitelist is enabled (requires Basic Auth to be enabled)
export const isIPWhitelistEnabled = isBasicAuthEnabled && ALLOWED_IPS.length > 0;

/**
 * Get client IP address from request
 * Checks X-Forwarded-For header first (for proxied requests), then falls back to direct connection
 */
function getClientIP(c: Context): string {
	// Check X-Forwarded-For header (common for load balancers/proxies)
	const forwardedFor = c.req.header("x-forwarded-for");
	if (forwardedFor) {
		// Take the first IP (original client)
		return forwardedFor.split(",")[0].trim();
	}

	// Fall back to CF-Connecting-IP (Cloudflare)
	const cfIP = c.req.header("cf-connecting-ip");
	if (cfIP) {
		return cfIP.trim();
	}

	// Fall back to direct connection
	return c.req.header("x-real-ip") || "unknown";
}

/**
 * Check if an IP address is within a CIDR range
 * Supports IPv4 only (e.g., 192.168.1.0/24)
 */
function isIPInCIDR(ip: string, cidr: string): boolean {
	const [range, bits] = cidr.split("/");
	const mask = ~(2 ** (32 - Number(bits)) - 1);

	const ipNum = ipToNumber(ip);
	const rangeNum = ipToNumber(range);

	return (ipNum & mask) === (rangeNum & mask);
}

/**
 * Convert IPv4 address to number
 */
function ipToNumber(ip: string): number {
	return ip.split(".").reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0) >>> 0;
}

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
			console.warn(`[Security] Failed login attempt from IP: ${getClientIP(c)}`);

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

		// 4. If IP whitelist is enabled, check client IP
		if (isIPWhitelistEnabled) {
			const clientIP = getClientIP(c);
			const isAllowed = ALLOWED_IPS.some((allowedIP) => {
				// Exact match
				if (allowedIP === clientIP) return true;
				// CIDR notation support (e.g., 192.168.1.0/24)
				if (allowedIP.includes("/")) {
					return isIPInCIDR(clientIP, allowedIP);
				}
				return false;
			});

			if (!isAllowed) {
				console.warn(
					`[Security] IP not in whitelist: ${clientIP} not in ${ALLOWED_IPS.join(", ")}`,
				);
				return c.json(
					{
						success: false,
						error: "Forbidden",
						message: "Your IP address is not allowed to access this resource.",
					},
					403,
				);
			}
		}

		// 5. Success
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
