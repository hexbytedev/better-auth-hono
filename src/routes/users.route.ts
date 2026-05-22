// src/routes/users.route.ts
import { zValidator } from "@hono/zod-validator";
import * as Sentry from "@sentry/bun";
import { Hono } from "hono";
import { z } from "zod";
import { maskEmail } from "../lib/redaction";
import { validateBasicAuth } from "../middleware/api-key.middleware";
import { getUserByEmail, getUserById } from "../services/user.service";

const usersRoute = new Hono();

// Validation schemas
const emailBodySchema = z.object({
	email: z.email("Invalid email format"),
});

const userIdSchema = z.object({
	id: z.uuid({ message: "Invalid user ID format", version: "v7" }),
});

/**
 * POST /api/users/email
 * Fetch user information by email address
 * Protected by Basic Authentication
 *
 * @route POST /api/users/email
 * @body {string} email - User's email address (must be valid email format)
 * @header {string} Authorization - Required Basic Auth header (format: "Basic base64(username:password)")
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
 *   "message": "No matching user found"
 * }
 * ```
 *
 * @returns {401} Unauthorized - Invalid or missing Basic Auth credentials
 * @returns {400} Bad Request - Invalid email format
 * @returns {500} Internal Server Error - Database or system error
 */
usersRoute.post("/email", validateBasicAuth, zValidator("json", emailBodySchema), async (c) => {
	const requestBody = c.req.valid("json");

	try {
		const { email } = requestBody;

		// Get user data using service function
		const user = await getUserByEmail(email);

		if (!user) {
			return c.json(
				{
					success: false,
					error: "User not found",
					message: "No matching user found",
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

		// Send to Sentry with rich context
		Sentry.captureException(error, {
			tags: {
				feature: "user-api",
				route: "get-user-by-email",
				method: "POST",
			},
			extra: {
				email: maskEmail(requestBody.email),
				userAgent: c.req.header("user-agent"),
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
 * Protected by Basic Authentication
 *
 * @route GET /api/users/id/:id
 * @param {string} id - User's unique identifier (UUID v7 format)
 * @header {string} Authorization - Required Basic Auth header (format: "Basic base64(username:password)")
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
 * @returns {401} Unauthorized - Invalid or missing Basic Auth credentials
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
