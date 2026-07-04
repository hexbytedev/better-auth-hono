// src/services/user.service.ts

import * as Sentry from "@sentry/bun";
import { eq, type SQL } from "drizzle-orm";
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
 * Shared user lookup: fetch a single user by an arbitrary WHERE condition and
 * shape it through the safe response transform. Centralizes the select list,
 * not-found handling, and error reporting shared by the public lookups below.
 *
 * @param where - Drizzle WHERE condition selecting at most one user
 * @param context - Reporting context: Sentry operation tag, a human label used
 *   in the log/breadcrumb strings ("email" / "ID"), and extra Sentry fields
 */
async function findUser(
	where: SQL,
	context: {
		operation: "getUserByEmail" | "getUserById";
		label: string;
		extra: Record<string, unknown>;
	},
): Promise<UserResponse | null> {
	try {
		const user = await db
			.select({
				id: users.id,
				email: users.email,
				name: users.name,
				image: users.image,
				emailVerified: users.emailVerified,
				twoFactorEnabled: users.twoFactorEnabled,
			})
			.from(users)
			.where(where)
			.limit(1);

		if (!user[0]) {
			return null;
		}

		// Transform to safe response format
		return transformUserToResponse(user[0]);
	} catch (error) {
		console.error(`Error fetching user by ${context.label}:`, error);

		// Send to Sentry with database context
		Sentry.captureException(error, {
			tags: {
				feature: "database",
				operation: context.operation,
				table: "users",
			},
			extra: {
				...context.extra,
				query: `SELECT user by ${context.label}`,
				database: "postgresql",
			},
			level: "error",
		});

		throw error;
	}
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
	return findUser(eq(users.email, email.trim().toLowerCase()), {
		operation: "getUserByEmail",
		label: "email",
		extra: { email: maskEmail(email) },
	});
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
	return findUser(eq(users.id, userId), {
		operation: "getUserById",
		label: "ID",
		extra: { userId },
	});
}
