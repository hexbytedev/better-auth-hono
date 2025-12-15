import { relations } from "drizzle-orm";
import { accounts, passkeys, sessions, twoFactors, users } from "./schema";

// ============================================
// USER RELATIONS
// ============================================

export const usersRelations = relations(users, ({ many, one }) => ({
	sessions: many(sessions),
	accounts: many(accounts),
	twoFactor: one(twoFactors, {
		fields: [users.id],
		references: [twoFactors.userId],
	}),
	passkeys: many(passkeys),
}));

// ============================================
// SESSION RELATIONS
// ============================================

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id],
	}),
}));

// ============================================
// ACCOUNT RELATIONS
// ============================================

export const accountsRelations = relations(accounts, ({ one }) => ({
	user: one(users, {
		fields: [accounts.userId],
		references: [users.id],
	}),
}));

// ============================================
// TWO FACTOR RELATIONS
// ============================================

export const twoFactorsRelations = relations(twoFactors, ({ one }) => ({
	user: one(users, {
		fields: [twoFactors.userId],
		references: [users.id],
	}),
}));

// ============================================
// PASSKEY RELATIONS
// ============================================

export const passkeysRelations = relations(passkeys, ({ one }) => ({
	user: one(users, {
		fields: [passkeys.userId],
		references: [users.id],
	}),
}));
