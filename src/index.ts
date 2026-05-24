// src/index.ts

// Load environment variables FIRST
import "dotenv/config";

// Initialize Sentry SECOND
import * as Sentry from "@sentry/bun";

const SENTRY_DSN = process.env.SENTRY_DSN?.trim();
const SENTRY_TRACES_SAMPLE_RATE = process.env.SENTRY_TRACES_SAMPLE_RATE?.trim();
const SENTRY_SEND_DEFAULT_PII = process.env.SENTRY_SEND_DEFAULT_PII?.trim();

if (SENTRY_DSN) {
	Sentry.init({
		dsn: SENTRY_DSN,
		...(SENTRY_TRACES_SAMPLE_RATE
			? { tracesSampleRate: parseFloat(SENTRY_TRACES_SAMPLE_RATE) }
			: {}),
		sendDefaultPii: SENTRY_SEND_DEFAULT_PII === "true",
	});
	console.log("Sentry initialized with DSN:", `${SENTRY_DSN.substring(0, 20)}...`);
} else {
	console.log("No Sentry DSN found");
}

// Now import everything else
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { getAllowedOrigins, getAppHost, getAppPort } from "./config/app.config";
import { checkEnv } from "./lib/env";
import { isBasicAuthEnabled } from "./middleware/api-key.middleware";
import usersRoute from "./routes/users.route";

// Validate all required environment variables before starting the server
checkEnv();

const allowedOrigins = getAllowedOrigins();

console.log("Allowed Origins:", allowedOrigins);
console.log("App Port:", getAppPort());
console.log("App Host:", getAppHost() || "default");

// Log Basic Auth status
if (isBasicAuthEnabled) {
	console.log("✅ Basic Authentication: ENABLED");
	console.log("   Protected routes: /api/users/* are accessible with credentials");
} else {
	console.log("⚠️  Basic Authentication: DISABLED");
	console.log("   API_AUTH_USER or API_AUTH_PASSWORD not configured");
	console.log("   Protected routes: /api/users/* are NOT mounted");
}

const app = new Hono();

// --- CORS Middleware ---
app.use(
	"/*",
	cors({
		origin: (origin) => {
			// Allow requests with no origin (like mobile apps or curl)
			if (!origin) return origin;
			// Check if origin is in allowed list
			if (allowedOrigins.includes(origin)) {
				return origin;
			}
			return null;
		},
		allowHeaders: ["Content-Type", "Authorization"],
		allowMethods: ["POST", "GET", "OPTIONS"],
		exposeHeaders: ["Content-Length"],
		maxAge: 600,
		credentials: true,
	}),
);

// --- Mount Better Auth ---
app.on(["POST", "GET"], "/api/auth/*", (c) => {
	return auth.handler(c.req.raw);
});

// --- User routes (conditionally mounted) ---
if (isBasicAuthEnabled) {
	app.route("/api/users", usersRoute);
} else {
	// Return 503 Service Unavailable for user routes when Basic Auth is not configured
	app.all("/api/users/*", (c) => {
		return c.json(
			{
				success: false,
				error: "Service Unavailable",
				message: "User API endpoints are disabled. Basic authentication is not configured.",
			},
			503,
		);
	});
}

// --- Health Check Endpoint ---
app.get("/api/health", (c) => {
	return c.json({
		status: "ok",
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
	});
});

// --- Root Endpoint ---
app.get("/", (c) => {
	const baseUrl = c.req.url;

	const links = [
		{
			text: "Go to the Authentication API Documentation",
			href: new URL("/api/auth/reference", baseUrl).href,
		},
	];

	// Only show user API links if Basic Auth is enabled
	if (isBasicAuthEnabled) {
		links.push(
			{
				text: "User API - Get by ID (Requires Basic Auth)",
				href: new URL("/api/users/id/:id", baseUrl).href,
			},
			{
				text: "User API - Get by Email (POST, Requires Basic Auth)",
				href: new URL("/api/users/email", baseUrl).href,
			},
		);
	}

	return c.json({
		message: "Hello Hono x Better Auth!",
		description: "This is a simple example of a Hono x Better Auth application.",
		basicAuth: isBasicAuthEnabled ? "enabled" : "disabled",
		links,
	});
});

// Export for Bun
export default {
	port: getAppPort(),
	host: getAppHost(),
	fetch: app.fetch,
};
