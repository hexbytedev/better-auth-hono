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
import usersRoute from "./routes/users.route";

const allowedOrigins = getAllowedOrigins();

console.log("Allowed Origins:", allowedOrigins);
console.log("App Port:", getAppPort());
console.log("App Host:", getAppHost() || "default");

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

// --- User routes ---
app.route("/api/users", usersRoute);

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

	return c.json({
		message: "Hello Hono x Better Auth!",
		description: "This is a simple example of a Hono x Better Auth application.",
		links: [
			{
				text: "Go to the Authentication API Documentation",
				href: new URL("/api/auth/reference", baseUrl).href,
			},
			{
				text: "User API - Get by ID (Requires Basic Auth)",
				href: new URL("/api/users/id/:id", baseUrl).href,
			},
			{
				text: "User API - Get by Email (Requires Basic Auth)",
				href: new URL("/api/users/email/:email", baseUrl).href,
			},
		],
	});
});

// --- Debug endpoint ---
app.get("/debug-origins", (c) => {
	return c.json({
		allowedOrigins: getAllowedOrigins(),
		appPort: getAppPort(),
		appHost: getAppHost(),
		clientUrl: process.env.CLIENT_URL?.trim(),
		rawAllowedOrigins: process.env.ALLOWED_ORIGINS?.trim(),
	});
});

// Export for Bun
export default {
	port: getAppPort(),
	host: getAppHost(),
	fetch: app.fetch,
};
