import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { getConnInfo } from "hono/bun";

// ── Environment Variables ──────────────────────────────────────────

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

// Load trusted proxies (e.g., nginx IPs/CIDRs)
const TRUSTED_PROXIES_RAW = process.env.TRUSTED_PROXIES?.trim() || "";
const TRUSTED_PROXIES = TRUSTED_PROXIES_RAW
	? TRUSTED_PROXIES_RAW.split(",")
			.map((p) => p.trim())
			.filter((p) => p.length > 0)
	: [];

// Check if Basic Auth is enabled
export const isBasicAuthEnabled = !!(AUTH_USER && AUTH_PASS);

// Check if IP whitelist is enabled (requires Basic Auth to be enabled)
export const isIPWhitelistEnabled = isBasicAuthEnabled && ALLOWED_IPS.length > 0;

// ── IP & CIDR Utilities ────────────────────────────────────────────

/**
 * Convert IPv4 address to number
 */
function ipToNumber(ip: string): number {
	return ip.split(".").reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0) >>> 0;
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
 * Check if an IP is in the trusted proxy list.
 * Supports both exact IPs and CIDR ranges (IPv4).
 */
function isTrustedProxy(ip: string): boolean {
	if (TRUSTED_PROXIES.length === 0) return false;

	// Normalize IPv6-mapped IPv4 (e.g., ::ffff:127.0.0.1 -> 127.0.0.1)
	const normalized = ip.replace(/^::ffff:/, "");

	return TRUSTED_PROXIES.some((entry) => {
		if (entry.includes("/")) {
			return isIPInCIDR(normalized, entry);
		}
		return entry === normalized;
	});
}

/**
 * Get the real client IP address.
 *
 * SECURITY MODEL:
 * 1. Use getConnInfo() to get the TCP-level remote address — this
 *    CANNOT be spoofed via HTTP headers.
 * 2. If the TCP connection comes from a trusted proxy (nginx),
 *    read X-Real-IP (set by nginx to $remote_addr) — the authoritative
 *    single-IP header that nginx overwrites.
 * 3. If the TCP connection is NOT from a trusted proxy (direct access,
 *    bypassing nginx), use the raw TCP remote address instead.
 * 4. CF-Connecting-IP is NEVER checked — Cloudflare is not in front,
 *    so any value in that header is attacker-supplied.
 */
export function getClientIP(c: Context): string {
	// 1. Get the actual TCP-level connection source (unspoofable)
	let socketIP = "unknown";
	try {
		const connInfo = getConnInfo(c);
		socketIP = connInfo.remote.address || "unknown";
	} catch {
		// getConnInfo may fail in some edge cases (e.g., unix sockets)
		socketIP = "unknown";
	}

	// 2. If the direct TCP connection is from a trusted proxy,
	//    trust the X-Real-IP header that nginx set from $remote_addr.
	if (socketIP !== "unknown" && isTrustedProxy(socketIP)) {
		const realIP = c.req.header("x-real-ip");
		if (realIP) {
			return realIP.trim();
		}

		// Fallback: X-Forwarded-For — only safe here because nginx
		// overwrites it with $remote_addr (not $proxy_add_x_forwarded_for).
		const forwardedFor = c.req.header("x-forwarded-for");
		if (forwardedFor) {
			return forwardedFor.split(",")[0].trim();
		}
	}

	// 3. Not a trusted proxy (direct connection bypassing nginx).
	//    Use the raw TCP address — this is the best we can do.
	//    Do NOT read any forwarded headers in this path.
	if (socketIP !== "unknown") {
		return socketIP.replace(/^::ffff:/, "");
	}

	// 4. Last resort: X-Real-IP only if we couldn't get socket info.
	//    This is a degraded state — log a warning.
	const realIP = c.req.header("x-real-ip");
	if (realIP) {
		console.warn(
			"[Security] Could not determine TCP source; falling back to X-Real-IP without proxy validation.",
		);
		return realIP.trim();
	}

	return "unknown";
}

// ── Auth Validation ────────────────────────────────────────────────

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
