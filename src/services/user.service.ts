// src/services/user.service.ts

import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";

/**
 * Get user by email address
 */
export async function getUserByEmail(email: string) {
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

		return user[0] || null;
	} catch (error) {
		console.error("Error fetching user by email:", error);
		throw error;
	}
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string) {
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

		return user[0] || null;
	} catch (error) {
		console.error("Error fetching user by ID:", error);
		throw error;
	}
}
