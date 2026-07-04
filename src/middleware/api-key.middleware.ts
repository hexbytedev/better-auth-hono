import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { getConnInfo } from "hono/bun";
import * as ipaddr from "ipaddr.js";

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

type IPAddress = ipaddr.IPv4 | ipaddr.IPv6;

/**
 * Parse an IP string into an ipaddr.js address, normalizing IPv4-mapped IPv6
 * (e.g. ::ffff:127.0.0.1) down to its IPv4 form so it compares equal to a bare
 * IPv4 entry. Returns null on any invalid input.
 */
function parseIP(value: string): IPAddress | null {
	const trimmed = value.trim();
	if (!ipaddr.isValid(trimmed)) return null;

	const addr = ipaddr.parse(trimmed);
	if (addr instanceof ipaddr.IPv6 && addr.isIPv4MappedAddress()) {
		return addr.toIPv4Address();
	}
	return addr;
}

/**
 * Normalize a client IP so the same host is represented identically no matter
 * which resolution path produced it. Strip the IPv4-mapped IPv6 prefix
 * (::ffff:1.2.3.4 -> 1.2.3.4), matching how the raw socket address is handled.
 */
function normalizeIP(value: string): string {
	return value.trim().replace(/^::ffff:/i, "");
}

/**
 * True if `clientIP` matches a whitelist/proxy `entry`, which may be a bare IP
 * (exact match) or a CIDR range. IPv4 and IPv6 never cross-match, and any
 * malformed input returns false.
 */
function ipMatchesEntry(clientIP: string, entry: string): boolean {
	const addr = parseIP(clientIP);
	if (!addr) return false;

	try {
		if (entry.includes("/")) {
			const [rangeAddr, bits] = ipaddr.parseCIDR(entry.trim());
			if (addr.kind() !== rangeAddr.kind()) return false;
			return addr.match(rangeAddr, bits);
		}

		const entryAddr = parseIP(entry);
		if (!entryAddr) return false;
		if (addr.kind() !== entryAddr.kind()) return false;
		return addr.toNormalizedString() === entryAddr.toNormalizedString();
	} catch {
		// Malformed CIDR / kind mismatch inside ipaddr.js, fail closed.
		return false;
	}
}

/**
 * Check if an IP is in the trusted proxy list (exact IP or CIDR range).
 */
function isTrustedProxy(ip: string): boolean {
	if (TRUSTED_PROXIES.length === 0) return false;
	return TRUSTED_PROXIES.some((entry) => ipMatchesEntry(ip, entry));
}

/**
 * Check whether a client IP satisfies the configured whitelist
 * (exact IP or CIDR range).
 */
function isIPAllowed(clientIP: string): boolean {
	return ALLOWED_IPS.some((entry) => ipMatchesEntry(clientIP, entry));
}

/**
 * A configured allowlist/proxy entry must be a valid IP or CIDR range.
 */
function isValidEntry(entry: string): boolean {
	return entry.includes("/") ? ipaddr.isValidCIDR(entry) : ipaddr.isValid(entry);
}

/**
 * Fail fast at startup on malformed config so a typo can never silently widen
 * access. Without this, an invalid entry (e.g. "10.0.0.0/" or an IPv6 range
 * where IPv4 was assumed) would be carried into the matcher and fail closed on
 * every request.
 */
function assertValidEntries(entries: string[], source: string): void {
	const invalid = entries.filter((entry) => !isValidEntry(entry));
	if (invalid.length > 0) {
		throw new Error(
			`[Security] ${source} contains invalid IP/CIDR entries: ${invalid.join(", ")}. ` +
				"Each entry must be a valid IPv4/IPv6 address or CIDR range (e.g. 203.0.113.5 or 10.0.0.0/24).",
		);
	}
}

assertValidEntries(ALLOWED_IPS, "API_ALLOWED_IPS");
assertValidEntries(TRUSTED_PROXIES, "TRUSTED_PROXIES");

/**
 * Get the real client IP address.
 *
 * SECURITY MODEL:
 * 1. Use getConnInfo() to get the TCP-level remote address. This
 *    CANNOT be spoofed via HTTP headers.
 * 2. If the TCP connection comes from a trusted proxy (a TRUSTED_PROXIES
 *    entry, e.g. nginx), read X-Real-IP, the authoritative single-IP
 *    header the proxy sets from its own $remote_addr.
 * 3. If the TCP connection is NOT from a trusted proxy (direct access,
 *    bypassing the proxy), use the raw TCP remote address instead and
 *    ignore all forwarded headers.
 *
 * The proxy is the trust boundary: forwarded headers are trusted only when
 * they arrive from a TRUSTED_PROXIES peer. When deploying behind Cloudflare,
 * terminate that trust at nginx: have nginx restore the real visitor IP for
 * Cloudflare's edge ranges and pass it on as X-Real-IP, then set
 * TRUSTED_PROXIES to nginx. See "Running behind nginx / Cloudflare" in the
 * README for a ready-to-use config.
 *
 * Every return path runs through normalizeIP() so the same host is
 * represented identically regardless of which branch produced it.
 */
export function getClientIP(c: Context): string {
	// 1. Get the actual TCP-level connection source (unspoofable)
	let socketIP: string;
	try {
		const connInfo = getConnInfo(c);
		socketIP = connInfo.remote.address || "unknown";
	} catch {
		// getConnInfo may fail in some edge cases (e.g., unix sockets)
		socketIP = "unknown";
	}

	// 2. If the direct TCP connection is from a trusted proxy,
	//    trust the X-Real-IP header the proxy set from its $remote_addr.
	if (socketIP !== "unknown" && isTrustedProxy(socketIP)) {
		const realIP = c.req.header("x-real-ip");
		if (realIP) {
			return normalizeIP(realIP);
		}

		// Fallback: X-Forwarded-For; only safe here because the proxy
		// overwrites it with $remote_addr (not $proxy_add_x_forwarded_for).
		const forwardedFor = c.req.header("x-forwarded-for");
		if (forwardedFor) {
			return normalizeIP(forwardedFor.split(",")[0]);
		}
	}

	// 3. Not a trusted proxy (direct connection bypassing the proxy).
	//    Use the raw TCP address; this is the best we can do.
	//    Do NOT read any forwarded headers in this path.
	if (socketIP !== "unknown") {
		return normalizeIP(socketIP);
	}

	// 4. Last resort: X-Real-IP only if we couldn't get socket info.
	//    This is a degraded state; log a warning.
	const realIP = c.req.header("x-real-ip");
	if (realIP) {
		console.warn(
			"[Security] Could not determine TCP source; falling back to X-Real-IP without proxy validation.",
		);
		return normalizeIP(realIP);
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

	// 1. Enforce the IP whitelist BEFORE touching credentials
	if (isIPWhitelistEnabled) {
		const clientIP = getClientIP(c);
		if (!isIPAllowed(clientIP)) {
			console.warn(`[Security] IP not in whitelist: ${clientIP} not in ${ALLOWED_IPS.join(", ")}`);
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

	// 2. Extract Authorization Header
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

	// 3. Decode Header (Format: "Basic <base64>")
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

	// 4. Decode Base64 and Validate credentials
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
