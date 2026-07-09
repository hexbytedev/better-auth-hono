import {
	bigint,
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

// ============================================
// USERS TABLE - Core user data
// ============================================

export const users = pgTable(
	"users",
	{
		id: uuid("id")
			.primaryKey()
			.$defaultFn(() => uuidv7()),
		email: varchar("email", { length: 255 }).notNull(),
		emailVerified: boolean("email_verified").default(false).notNull(),
		name: varchar("name", { length: 255 }),
		image: text("image"),

		// Two Factor Authentication field (required by Better Auth)
		twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),

		// Timestamps
		createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		// A UNIQUE constraint is backed by a unique B-tree index in Postgres,
		// so it already serves email lookups; no separate index needed.
		unique("users_email_unique").on(table.email),
	],
);

// ============================================
// SESSIONS TABLE - Active user sessions
// ============================================

export const sessions = pgTable(
	"sessions",
	{
		id: uuid("id")
			.primaryKey()
			.$defaultFn(() => uuidv7()),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),

		// Token management
		token: text("token").notNull(),

		// Expiration
		expiresAt: timestamp("expires_at", {
			mode: "date",
			withTimezone: true,
		}).notNull(),

		// Session metadata
		ipAddress: varchar("ip_address", { length: 45 }), // Support IPv6
		userAgent: text("user_agent"),

		// Timestamps
		createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		unique("sessions_token_unique").on(table.token),
		index("sessions_user_id_idx").on(table.userId),
		index("sessions_expires_at_idx").on(table.expiresAt),
	],
);

// ============================================
// ACCOUNTS TABLE - Authentication providers
// ============================================

export const accounts = pgTable(
	"accounts",
	{
		id: uuid("id")
			.primaryKey()
			.$defaultFn(() => uuidv7()),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),

		// Provider information
		accountId: text("account_id").notNull(), // Provider's user ID
		providerId: text("provider_id").notNull(), // "google", "github", "credential"

		// OAuth tokens
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at", {
			mode: "date",
			withTimezone: true,
		}),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
			mode: "date",
			withTimezone: true,
		}),
		scope: text("scope"),

		// Credentials (for email/password)
		password: text("password"),

		// Timestamps
		createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		unique("accounts_provider_account_unique").on(table.providerId, table.accountId),
		index("accounts_user_id_idx").on(table.userId),
	],
);

// ============================================
// VERIFICATION TABLE - Tokens for verification
// ============================================

export const verifications = pgTable(
	"verifications",
	{
		id: uuid("id")
			.primaryKey()
			.$defaultFn(() => uuidv7()),
		identifier: text("identifier").notNull(), // email or userId
		value: text("value").notNull(), // token value

		// Expiration
		expiresAt: timestamp("expires_at", {
			mode: "date",
			withTimezone: true,
		}).notNull(),

		// Timestamps
		createdAt: timestamp("created_at", {
			mode: "date",
			withTimezone: true,
		})
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		// The composite unique's leftmost column (identifier) already serves
		// identifier-only lookups as a B-tree prefix scan.
		unique("verifications_identifier_value_unique").on(table.identifier, table.value),
		index("verifications_expires_at_idx").on(table.expiresAt),
	],
);

// ============================================
// TWO FACTOR TABLE - TOTP Authentication (Better Auth Spec)
// ============================================

export const twoFactors = pgTable(
	"two_factors",
	{
		id: uuid("id")
			.primaryKey()
			.$defaultFn(() => uuidv7()),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),

		// TOTP Secret
		secret: text("secret").notNull(),

		// Backup codes (stored as JSON string array)
		backupCodes: text("backup_codes").notNull(),

		// Whether the user has verified/activated 2FA
		verified: boolean("verified").notNull().default(false),

		// Account lockout: consecutive failed second-factor verifications
		failedVerificationCount: integer("failed_verification_count").notNull().default(0),
		lockedUntil: timestamp("locked_until", { mode: "date", withTimezone: true }),

		// Timestamps
		createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		// UNIQUE(user_id) is backed by a unique B-tree index that serves
		// user_id lookups; no separate index needed.
		unique("two_factors_user_id_unique").on(table.userId),
	],
);

// ============================================
// PASSKEY TABLE - WebAuthn credentials (Better Auth Spec)
// ============================================

export const passkeys = pgTable(
	"passkeys",
	{
		id: uuid("id")
			.primaryKey()
			.$defaultFn(() => uuidv7()),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),

		// Passkey information
		name: varchar("name", { length: 255 }),

		// WebAuthn data
		publicKey: text("public_key").notNull(),
		credentialID: text("credential_id").notNull(),
		counter: bigint("counter", { mode: "number" }).default(0).notNull(),

		// Device information
		deviceType: varchar("device_type", { length: 255 }).notNull(),
		backedUp: boolean("backed_up").default(false).notNull(),
		transports: text("transports"), // JSON string array

		// Authenticator Attestation GUID
		aaguid: text("aaguid"),

		// Timestamp
		createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// UNIQUE(credential_id) is backed by a unique B-tree index that serves
		// credential_id lookups; only the user_id index is separately needed.
		unique("passkeys_credential_id_unique").on(table.credentialID),
		index("passkeys_user_id_idx").on(table.userId),
	],
);

// ============================================
// JWKS TABLE - JWT Key Management (Better Auth Spec)
// ============================================

export const jwks = pgTable(
	"jwks",
	{
		id: uuid("id")
			.primaryKey()
			.$defaultFn(() => uuidv7()),

		// Key pair
		publicKey: text("public_key").notNull(),
		privateKey: text("private_key").notNull(),

		// Timestamps
		createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
		expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }),
	},
	(table) => [index("jwks_created_at_idx").on(table.createdAt)],
);

// ============================================
// USER EMAILS TABLE - Multiple emails per user
// ============================================
export const userEmails = pgTable(
	"user_emails",
	{
		id: uuid("id")
			.primaryKey()
			.$defaultFn(() => uuidv7()),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),

		email: varchar("email", { length: 255 }).notNull(),
		primary: boolean("primary").default(false).notNull(),
		verified: boolean("verified").default(false).notNull(),
		createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		unique("user_emails_unique_per_user").on(table.userId, table.email),
		index("user_emails_user_id_idx").on(table.userId),
		index("user_emails_email_idx").on(table.email),
	],
);

// ============================================
// RATE LIMIT TABLE - Better Auth rate limiting
// ============================================
export const rateLimit = pgTable("rate_limit", {
	id: uuid("id")
		.primaryKey()
		.$defaultFn(() => uuidv7()),
	key: text("key").notNull().unique(),
	count: integer("count").notNull(),
	lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// ============================================
// TYPE EXPORTS
// ============================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
export type TwoFactor = typeof twoFactors.$inferSelect;
export type NewTwoFactor = typeof twoFactors.$inferInsert;
export type Passkey = typeof passkeys.$inferSelect;
export type NewPasskey = typeof passkeys.$inferInsert;
export type Jwks = typeof jwks.$inferSelect;
export type NewJwks = typeof jwks.$inferInsert;
export type UserEmail = typeof userEmails.$inferSelect;
export type NewUserEmail = typeof userEmails.$inferInsert;
