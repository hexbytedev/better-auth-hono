// src/services/user.service.ts

import * as Sentry from "@sentry/bun";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { users } from "../db/schema";
import { maskEmail } from "../lib/redaction";

/**
 * User Response Schema - Controls what data is returned to clients
 * Only exposes safe, necessary user information
 */
export const UserResponseSchema = z.object({
	id: z.uuid(),
	email: z.email(),
	name: z.string().nullable(),
	image: z.string().nullable(),
	emailVerified: z.boolean(),
	twoFactorEnabled: z.boolean(),
});

export type UserResponse = z.infer<typeof UserResponseSchema>;

type SafeUserRow = {
	id: string;
	email: string;
	name: string | null;
	image: string | null;
	emailVerified: boolean;
	twoFactorEnabled: boolean;
};

/**
 * Transform database user to safe response format
 */
function transformUserToResponse(dbUser: SafeUserRow): UserResponse {
	return {
		id: dbUser.id,
		email: dbUser.email,
		name: dbUser.name,
		image: dbUser.image,
		emailVerified: dbUser.emailVerified,
		twoFactorEnabled: dbUser.twoFactorEnabled,
	};
}

/**
 * Get user by email address
 *
 * @param email - User's email address
 * @returns Promise<UserResponse | null> - User data or null if not found
 *
 * @example
 * ```typescript
 * const user = await getUserByEmail("user@example.com");
 * // Returns: { id, email, name, image, emailVerified, twoFactorEnabled }
 * ```
 */
export async function getUserByEmail(email: string): Promise<UserResponse | null> {
	try {
		const user = await db
			.select({
				id: users.id,
				email: users.email,
				name: users.name,
				image: users.image,
				emailVerified: users.emailVerified,
				twoFactorEnabled: users.twoFactorEnabled,
				createdAt: users.createdAt,
				updatedAt: users.updatedAt,
			})
			.from(users)
			.where(eq(users.email, email))
			.limit(1);

		if (!user[0]) {
			return null;
		}

		// Transform to safe response format
		return transformUserToResponse(user[0]);
	} catch (error) {
		console.error("Error fetching user by email:", error);

		// Send to Sentry with database context
		Sentry.captureException(error, {
			tags: {
				feature: "database",
				operation: "getUserByEmail",
				table: "users",
			},
			extra: {
				email: maskEmail(email),
				query: "SELECT user by email",
				database: "postgresql",
			},
			level: "error",
		});

		throw error;
	}
}

/**
 * Get user by ID
 *
 * @param userId - User's unique identifier (UUID v7)
 * @returns Promise<UserResponse | null> - User data or null if not found
 *
 * @example
 * ```typescript
 * const user = await getUserById("01234567-89ab-cdef-0123-456789abcdef");
 * // Returns: { id, email, name, image, emailVerified, twoFactorEnabled }
 * ```
 */
export async function getUserById(userId: string): Promise<UserResponse | null> {
	try {
		const user = await db
			.select({
				id: users.id,
				email: users.email,
				name: users.name,
				image: users.image,
				emailVerified: users.emailVerified,
				twoFactorEnabled: users.twoFactorEnabled,
				createdAt: users.createdAt,
				updatedAt: users.updatedAt,
			})
			.from(users)
			.where(eq(users.id, userId))
			.limit(1);

		if (!user[0]) {
			return null;
		}

		// Transform to safe response format
		return transformUserToResponse(user[0]);
	} catch (error) {
		console.error("Error fetching user by ID:", error);

		// Send to Sentry with database context
		Sentry.captureException(error, {
			tags: {
				feature: "database",
				operation: "getUserById",
				table: "users",
			},
			extra: {
				userId,
				query: "SELECT user by ID",
				database: "postgresql",
			},
			level: "error",
		});

		throw error;
	}
}
