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

const app = new Hono().basePath("/api");

// --- CORS Middleware (simplified) ---
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
		allowHeaders: ["Content-Type", "Authorization", "Cookie", "X-API-Key"],
		allowMethods: ["POST", "GET", "OPTIONS", "PUT", "DELETE", "PATCH"],
		exposeHeaders: ["Content-Length", "Set-Cookie"],
		maxAge: 600,
		credentials: true,
	}),
);

// --- Mount Better Auth ---
app.on(["POST", "GET"], "/auth/*", (c) => {
	return auth.handler(c.req.raw);
});

// --- User routes ---
app.route("/users", usersRoute);

// --- Health Check Endpoint ---
app.get("/health", (c) => {
	return c.json({
		status: "ok",
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
	});
});

// --- Root Endpoint ---
const rootApp = new Hono();
rootApp.get("/", (c) => {
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
				text: "User API - Get by ID (Requires X-API-Key)",
				href: new URL("/api/users/id/:id", baseUrl).href,
			},
			{
				text: "User API - Get by Email (Requires X-API-Key)",
				href: new URL("/api/users/email/:email", baseUrl).href,
			},
		],
	});
});

// These configs are coming from src/app.config.ts
rootApp.get("/debug-origins", (c) => {
	return c.json({
		allowedOrigins: getAllowedOrigins(),
		appPort: getAppPort(),
		appHost: getAppHost(),
		clientUrl: process.env.CLIENT_URL?.trim(),
		rawAllowedOrigins: process.env.ALLOWED_ORIGINS?.trim(),
	});
});

// Combined fetch handler for routing
const handleRequest = (req: Request): Response | Promise<Response> => {
	const url = new URL(req.url);
	if (url.pathname.startsWith("/api")) {
		return app.fetch(req);
	}
	return rootApp.fetch(req);
};

// These configs are coming from src/app.config.ts
export default {
	port: getAppPort(),
	host: getAppHost(),
	fetch: handleRequest,
};
