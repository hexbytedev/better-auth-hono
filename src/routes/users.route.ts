// src/routes/users.route.ts
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/bun";
import { requireEnv } from "../lib/env";
import { maskEmail } from "../lib/redaction";
import { validateBasicAuth } from "../middleware/api-key.middleware";
import { getUserByEmail, getUserById } from "../services/user.service";

// Canonical public base URL; used only inside the request-time doc handler, so
// the requireEnv placeholder is inert at module load (see lib/env.ts contract).
const SERVER_URL = requireEnv("BETTER_AUTH_SERVER_URL");

// ── Request / response schemas (also power the OpenAPI reference) ───────────

const EmailLookupBody = z
	.object({
		email: z.email("Invalid email format").openapi({
			description:
				"Email address to look up. Matched case-insensitively (normalized to lowercase before the query).",
			example: "user@example.com",
		}),
	})
	.openapi("EmailLookupRequest");

const UserIdParam = z.object({
	// `version: "v7"` is intentional: all user IDs are generated as UUIDv7
	// (see db/schema.ts `$defaultFn(() => uuidv7())`). Rejecting other UUID
	// versions is a deliberate contract.
	id: z.uuid({ message: "Invalid user ID format", version: "v7" }).openapi({
		param: { name: "id", in: "path" },
		description: "The user's UUIDv7 identifier. Non-v7 UUIDs are rejected with 400.",
		example: "0192c7b6-9f3a-7c11-8f5e-1a2b3c4d5e6f",
	}),
});

// Safe, non-sensitive fields exposed to callers.
// Keep in sync with UserResponseSchema in ../services/user.service.ts.
const UserData = z
	.object({
		id: z.uuid().openapi({ example: "0192c7b6-9f3a-7c11-8f5e-1a2b3c4d5e6f" }),
		email: z.email().openapi({ example: "user@example.com" }),
		name: z.string().nullable().openapi({ example: "John Doe" }),
		image: z.string().nullable().openapi({ example: "https://example.com/avatar.jpg" }),
		emailVerified: z.boolean().openapi({ example: true }),
		twoFactorEnabled: z.boolean().openapi({ example: false }),
	})
	.openapi("User");

const SuccessResponse = z
	.object({
		success: z.literal(true),
		data: UserData,
	})
	.openapi("UserLookupSuccess");

const ErrorResponse = z
	.object({
		success: z.literal(false),
		error: z.string().openapi({ example: "User not found" }),
		message: z.string().openapi({ example: "No matching user found" }),
	})
	.openapi("ErrorResponse");

const jsonError = (description: string) => ({
	description,
	content: { "application/json": { schema: ErrorResponse } },
});

// Error responses shared by both lookups. 401/403/400-from-auth are produced by
// the validateBasicAuth middleware; 400-from-validation by the defaultHook below.
const sharedErrorResponses = {
	400: jsonError("Bad Request — invalid email/UUID or malformed request body."),
	401: jsonError("Unauthorized — missing or invalid Basic Auth credentials."),
	403: jsonError(
		"Forbidden — client IP is not in API_ALLOWED_IPS (only when the IP whitelist is enabled).",
	),
	404: jsonError("Not Found — no user matched the lookup."),
	500: jsonError("Internal Server Error — database or system failure."),
};

const usersRoute = new OpenAPIHono({
	// Shape zod validation failures into the same { success, error, message }
	// envelope every other response uses (instead of zValidator's raw ZodError).
	defaultHook: (result, c) => {
		if (!result.success) {
			return c.json(
				{
					success: false as const,
					error: "Bad Request",
					message: result.error.issues[0]?.message ?? "Invalid request payload.",
				},
				400,
			);
		}
	},
});

// Document the Basic Auth scheme so the reference shows a working "Authorize" box.
usersRoute.openAPIRegistry.registerComponent("securitySchemes", "basicAuth", {
	type: "http",
	scheme: "basic",
	description:
		"HTTP Basic Auth. Username = API_AUTH_USER, password = API_AUTH_PASSWORD (server env). Credentials are compared in constant time.",
});

// ── POST /api/users/email ──────────────────────────────────────────────────

const lookupByEmailRoute = createRoute({
	method: "post",
	path: "/email",
	tags: ["Users"],
	summary: "Look up a user by email",
	description:
		"Returns the safe, non-sensitive profile fields for the user with the given email. Protected by Basic Auth (plus the optional API_ALLOWED_IPS whitelist).",
	security: [{ basicAuth: [] }],
	middleware: [validateBasicAuth] as const,
	request: {
		body: {
			required: true,
			content: { "application/json": { schema: EmailLookupBody } },
		},
	},
	responses: {
		200: {
			description: "User found.",
			content: { "application/json": { schema: SuccessResponse } },
		},
		...sharedErrorResponses,
	},
});

usersRoute.openapi(lookupByEmailRoute, async (c) => {
	const { email } = c.req.valid("json");

	try {
		const user = await getUserByEmail(email);

		if (!user) {
			return c.json(
				{ success: false as const, error: "User not found", message: "No matching user found" },
				404,
			);
		}

		return c.json({ success: true as const, data: user }, 200);
	} catch (error) {
		console.error("Error in /email route:", error);

		Sentry.captureException(error, {
			tags: { feature: "user-api", route: "get-user-by-email", method: "POST" },
			extra: { email: maskEmail(email), userAgent: c.req.header("user-agent") },
			level: "error",
		});

		return c.json(
			{
				success: false as const,
				error: "Internal server error",
				message: "An error occurred while fetching user data",
			},
			500,
		);
	}
});

// ── GET /api/users/id/:id ──────────────────────────────────────────────────

const lookupByIdRoute = createRoute({
	method: "get",
	path: "/id/{id}",
	tags: ["Users"],
	summary: "Look up a user by ID",
	description:
		"Returns the safe, non-sensitive profile fields for the user with the given UUIDv7 id. Protected by Basic Auth (plus the optional API_ALLOWED_IPS whitelist).",
	security: [{ basicAuth: [] }],
	middleware: [validateBasicAuth] as const,
	request: {
		params: UserIdParam,
	},
	responses: {
		200: {
			description: "User found.",
			content: { "application/json": { schema: SuccessResponse } },
		},
		...sharedErrorResponses,
	},
});

usersRoute.openapi(lookupByIdRoute, async (c) => {
	const { id } = c.req.valid("param");

	try {
		const user = await getUserById(id);

		if (!user) {
			return c.json(
				{
					success: false as const,
					error: "User not found",
					message: `No user found with ID: ${id}`,
				},
				404,
			);
		}

		return c.json({ success: true as const, data: user }, 200);
	} catch (error) {
		console.error("Error in /id route:", error);

		Sentry.captureException(error, {
			tags: { feature: "user-api", route: "get-user-by-id", method: "GET" },
			extra: { userId: id, userAgent: c.req.header("user-agent") },
			level: "error",
		});

		return c.json(
			{
				success: false as const,
				error: "Internal server error",
				message: "An error occurred while fetching user data",
			},
			500,
		);
	}
});

// ── OpenAPI document (consumed by unified /api/docs Scalar) ────────────────

usersRoute.doc31("/openapi.json", () => ({
	openapi: "3.1.0",
	info: {
		title: "Internal User API",
		version: "0.0.12",
		description:
			"Server-to-server user lookup API, protected by HTTP Basic Auth. Mounted only when API_AUTH_USER and API_AUTH_PASSWORD are configured; otherwise every /api/users/* path returns 503.",
	},
	servers: [{ url: `${SERVER_URL}/api/users`, description: "This auth server" }],
}));

export default usersRoute;
