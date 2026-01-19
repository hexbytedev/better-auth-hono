// src/routes/users.route.ts
import { zValidator } from "@hono/zod-validator";
import * as Sentry from "@sentry/bun";
import { Hono } from "hono";
import { z } from "zod";
import { validateBasicAuth } from "../middleware/api-key.middleware";
import { getUserByEmail, getUserById } from "../services/user.service";

const usersRoute = new Hono();

// Validation schemas
const emailSchema = z.object({
	email: z.email("Invalid email format"),
});

const userIdSchema = z.object({
	id: z.uuid({ message: "Invalid user ID format", version: "v7" }),
});

/**
 * GET /api/users/email/:email
 * Fetch user information by email address
 * Protected by X-API-Key header
 *
 * @route GET /api/users/email/:email
 * @param {string} email - User's email address (must be valid email format)
 * @header {string} X-API-Key - Required API key for authentication
 *
 * @returns {200} Success Response
 * ```json
 * {
 *   "success": true,
 *   "data": {
 *     "id": "01234567-89ab-cdef-0123-456789abcdef",
 *     "email": "user@example.com",
 *     "name": "John Doe",
 *     "image": "https://example.com/avatar.jpg",
 *     "emailVerified": true,
 *     "twoFactorEnabled": false
 *   }
 * }
 * ```
 *
 * @returns {404} User Not Found
 * ```json
 * {
 *   "success": false,
 *   "error": "User not found",
 *   "message": "No user found with email: user@example.com"
 * }
 * ```
 *
 * @returns {401} Unauthorized - Invalid or missing API key
 * @returns {400} Bad Request - Invalid email format
 * @returns {500} Internal Server Error - Database or system error
 */
usersRoute.get("/email/:email", validateBasicAuth, zValidator("param", emailSchema), async (c) => {
	try {
		const { email } = c.req.param();

		// Get user data using service function
		const user = await getUserByEmail(email);

		if (!user) {
			return c.json(
				{
					success: false,
					error: "User not found",
					message: `No user found with email: ${email}`,
				},
				404,
			);
		}

		// Return structured response with only safe user data
		return c.json({
			success: true,
			data: user, // Already transformed by service
		});
	} catch (error) {
		console.error("Error in /email route:", error);

		// Set user context for Sentry
		Sentry.setUser({ email: c.req.param("email") });

		// Send to Sentry with rich context
		Sentry.captureException(error, {
			tags: {
				feature: "user-api",
				route: "get-user-by-email",
				method: "GET",
			},
			extra: {
				email: c.req.param("email"),
				userAgent: c.req.header("user-agent"),
				ip: c.req.header("x-forwarded-for") || "unknown",
			},
			level: "error",
		});

		return c.json(
			{
				success: false,
				error: "Internal server error",
				message: "An error occurred while fetching user data",
			},
			500,
		);
	}
});

/**
 * GET /api/users/id/:id
 * Fetch user information by user ID
 * Protected by X-API-Key header
 *
 * @route GET /api/users/id/:id
 * @param {string} id - User's unique identifier (UUID v7 format)
 * @header {string} X-API-Key - Required API key for authentication
 *
 * @returns {200} Success Response
 * ```json
 * {
 *   "success": true,
 *   "data": {
 *     "id": "01234567-89ab-cdef-0123-456789abcdef",
 *     "email": "user@example.com",
 *     "name": "John Doe",
 *     "image": "https://example.com/avatar.jpg",
 *     "emailVerified": true,
 *     "twoFactorEnabled": false
 *   }
 * }
 * ```
 *
 * @returns {404} User Not Found
 * ```json
 * {
 *   "success": false,
 *   "error": "User not found",
 *   "message": "No user found with ID: 01234567-89ab-cdef-0123-456789abcdef"
 * }
 * ```
 *
 * @returns {401} Unauthorized - Invalid or missing API key
 * @returns {400} Bad Request - Invalid UUID format
 * @returns {500} Internal Server Error - Database or system error
 */
usersRoute.get("/id/:id", validateBasicAuth, zValidator("param", userIdSchema), async (c) => {
	try {
		const { id } = c.req.param();

		// Get user data using service function
		const user = await getUserById(id);

		if (!user) {
			return c.json(
				{
					success: false,
					error: "User not found",
					message: `No user found with ID: ${id}`,
				},
				404,
			);
		}

		// Return structured response with only safe user data
		return c.json({
			success: true,
			data: user, // Already transformed by service
		});
	} catch (error) {
		console.error("Error in /id route:", error);

		// Set user context for Sentry
		Sentry.setUser({ id: c.req.param("id") });

		// Send to Sentry with rich context
		Sentry.captureException(error, {
			tags: {
				feature: "user-api",
				route: "get-user-by-id",
				method: "GET",
			},
			extra: {
				userId: c.req.param("id"),
				userAgent: c.req.header("user-agent"),
				ip: c.req.header("x-forwarded-for") || "unknown",
			},
			level: "error",
		});

		return c.json(
			{
				success: false,
				error: "Internal server error",
				message: "An error occurred while fetching user data",
			},
			500,
		);
	}
});

export default usersRoute;
