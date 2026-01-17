// auth.ts

import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, jwt, openAPI, twoFactor } from "better-auth/plugins";
import { and, eq, ilike, inArray, not, or } from "drizzle-orm";
import { getAllowedOrigins } from "./config/app.config";
import { db } from "./db";
import * as schema from "./db/schema";
import { sendPasswordResetEmail, sendVerificationEmail } from "./lib/email";

const allowedOrigins = getAllowedOrigins();

const SERVER_URL = process.env.BETTER_AUTH_SERVER_URL?.trim();
if (!SERVER_URL) throw new Error("BETTER_AUTH_SERVER_URL is missing");

const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET?.trim();
if (!BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is missing");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();
if (!GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID is missing");

const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim();
if (!GOOGLE_CLIENT_SECRET) throw new Error("GOOGLE_CLIENT_SECRET is missing");

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID?.trim();
if (!GITHUB_CLIENT_ID) throw new Error("GITHUB_CLIENT_ID is missing");

const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET?.trim();
if (!GITHUB_CLIENT_SECRET) throw new Error("GITHUB_CLIENT_SECRET is missing");

const BETTER_AUTH_RP_ID = process.env.BETTER_AUTH_RP_ID?.trim();
if (!BETTER_AUTH_RP_ID) throw new Error("BETTER_AUTH_RP_ID is missing");

const BETTER_AUTH_RP_NAME = process.env.BETTER_AUTH_RP_NAME?.trim();
if (!BETTER_AUTH_RP_NAME) throw new Error("BETTER_AUTH_RP_NAME is missing");

const CLIENT_URL = process.env.CLIENT_URL?.trim();
if (!CLIENT_URL) throw new Error("CLIENT_URL is missing");

const JWT_EXPIRATION_TIME = process.env.JWT_EXPIRATION_TIME?.trim();
if (!JWT_EXPIRATION_TIME) throw new Error("JWT_EXPIRATION_TIME is missing");

export const auth = betterAuth({
	baseURL: SERVER_URL,
	trustedOrigins: allowedOrigins,
	secret: BETTER_AUTH_SECRET,
	socialProviders: {
		google: {
			clientId: GOOGLE_CLIENT_ID,
			clientSecret: GOOGLE_CLIENT_SECRET,
			redirectURI: `${SERVER_URL}/api/auth/callback/google`,
		},
		github: {
			clientId: GITHUB_CLIENT_ID,
			clientSecret: GITHUB_CLIENT_SECRET,
			scope: ["read:user", "user:email"],
			redirectURI: `${SERVER_URL}/api/auth/callback/github`,
		},
	},
	hooks: {
		after: createAuthMiddleware(async (ctx) => {
			// Your existing GitHub email fetching logic
			const newSession = (
				ctx as {
					context?: {
						newSession?: { user?: { id?: string }; userId?: string };
					};
				}
			).context?.newSession;
			const userId: string | undefined = newSession?.user?.id ?? newSession?.userId;
			if (!userId) return;

			try {
				// GitHub email fetching logic...
				const [ghAccount] = await db
					.select({ accessToken: schema.accounts.accessToken })
					.from(schema.accounts)
					.where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, "github")))
					.limit(1);

				const accessToken = ghAccount?.accessToken;
				if (!accessToken) return;

				const res = await fetch("https://api.github.com/user/emails", {
					headers: {
						Authorization: `Bearer ${accessToken}`,
						Accept: "application/vnd.github+json",
						"X-GitHub-Api-Version": "2022-11-28",
						"User-Agent": "better-auth-app",
					},
					cache: "no-store",
				});

				if (!res.ok) {
					const text = await res.text().catch(() => "");
					console.error("[hooks.after] GitHub API error", res.status, text);
					return;
				}

				const emails: Array<{
					email: string;
					primary?: boolean;
					verified?: boolean;
					visibility?: string | null;
				}> = await res.json();

				// Process and store verified emails
				const filteredInput = emails
					.filter(
						(e) => Boolean(e.verified) && !/@(?:users\.)?noreply\.github\.com$/i.test(e.email),
					)
					.sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));

				const seen = new Set<string>();
				const filtered = [] as Array<{
					email: string;
					primary: boolean;
					verified: true;
				}>;
				for (const e of filteredInput) {
					if (seen.has(e.email)) continue;
					seen.add(e.email);
					filtered.push({
						email: e.email,
						primary: Boolean(e.primary),
						verified: true,
					});
				}

				if (filtered.length) {
					// Insert verified emails
					try {
						await db
							.insert(schema.userEmails)
							.values(
								filtered.map((e) => ({
									userId,
									email: e.email,
									primary: Boolean(e.primary),
									verified: true,
								})),
							)
							.onConflictDoNothing({
								target: [schema.userEmails.userId, schema.userEmails.email],
							});
					} catch (err) {
						console.error("[hooks.after] Failed to insert verified emails:", err);
					}

					// Update flags
					try {
						for (const e of filtered) {
							await db
								.update(schema.userEmails)
								.set({
									primary: Boolean(e.primary),
									verified: true,
								})
								.where(
									and(eq(schema.userEmails.userId, userId), eq(schema.userEmails.email, e.email)),
								);
						}
					} catch (err) {
						console.error("[hooks.after] Failed to update email flags:", err);
					}

					// Clean up stale records
					try {
						const keepEmails = filtered.map((e) => e.email);
						await db
							.delete(schema.userEmails)
							.where(
								and(
									eq(schema.userEmails.userId, userId),
									or(
										eq(schema.userEmails.verified, false),
										ilike(schema.userEmails.email, "%@noreply.github.com"),
										ilike(schema.userEmails.email, "%@users.noreply.github.com"),
										not(inArray(schema.userEmails.email, keepEmails)),
									),
								),
							);
					} catch (err) {
						console.error("[hooks.after] Failed to clean up unverified/noreply emails:", err);
					}
				}

				console.log(
					"Verified reachable GitHub emails:",
					filtered.map((e) => e.email),
				);
			} catch (e) {
				console.error("[hooks.after] Failed to fetch/log GitHub emails:", e);
			}
		}),
	},
	emailAndPassword: {
		enabled: true,
		autoSignIn: false,
		requireEmailVerification: true,
		async sendResetPassword({ user, url, token }, request) {
			// Use the imported function
			await sendPasswordResetEmail(user, url);
		},
		password: {},
	},
	emailVerification: {
		sendOnSignUp: true,
		autoSignInAfterVerification: false,
		async sendVerificationEmail({ user, url, token }) {
			// Extract callbackURL (default to /dashboard)
			let callbackPath = "/success";
			try {
				const u = new URL(url);
				callbackPath = u.searchParams.get("callbackURL") || "/success";
			} catch {}

			// Build verify-api URL but with absolute client callback
			const verifyApiUrl = new URL(`${SERVER_URL}/api/auth/verify-email`);
			verifyApiUrl.searchParams.set("token", token);

			// Fix: Use the first origin if allowedOrigins is an array
			const origin = Array.isArray(allowedOrigins) ? allowedOrigins[0] : allowedOrigins;

			verifyApiUrl.searchParams.set("callbackURL", `${origin}${callbackPath}`);
			console.log("The verification URL is", verifyApiUrl.toString());

			await sendVerificationEmail(user, verifyApiUrl.toString());
		},
	},
	plugins: [
		openAPI(),
		passkey({
			schema: {
				passkey: {
					modelName: "passkeys",
				},
			},
			rpID: BETTER_AUTH_RP_ID,
			rpName: BETTER_AUTH_RP_NAME,
			origin: CLIENT_URL,
			authenticatorSelection: {
				authenticatorAttachment: undefined,
				residentKey: "preferred",
				userVerification: "preferred",
			},
		}),
		twoFactor({
			schema: {
				twoFactor: {
					modelName: "twoFactors",
				},
			},
		}),
		jwt({
			schema: {
				jwks: {
					modelName: "jwks",
				},
			},
			jwt: {
				issuer: SERVER_URL, // Use server URL for issuer
				audience: CLIENT_URL, // Client URL for audience
				expirationTime: JWT_EXPIRATION_TIME,
				definePayload: async (session) => {
					// Get user data from database
					const userData = await db.query.users.findFirst({
						where: (users, { eq }) => eq(users.id, session.user.id),
					});

					// Check if user has email/password account
					const emailPasswordAccount = await db.query.accounts.findFirst({
						where: (accounts, { eq, and }) =>
							and(eq(accounts.userId, session.user.id), eq(accounts.providerId, "credential")),
					});

					return {
						user: {
							id: session.user.id,
							// email: session.user.email,
							emailVerified: session.user.emailVerified,
							// name: session.user.name,
							isTwoFactorEnabled: userData?.twoFactorEnabled ?? false,
							isCredentialBased: !!emailPasswordAccount,
							createdAt: userData?.createdAt,
							updatedAt: userData?.updatedAt,
							image: session.user.image,
						},
					};
				},
			},
		}),
	],
	advanced: {
		// Testing new cookie config here
		//! Uncomment this only when using authentication under sub domain
		// crossSubDomainCookies: {
		// 	enabled: true,
		// 	domain: "sub.domain.com",
		// },
		defaultCookieAttributes: {
			sameSite: "none",
			secure: true,
			httpOnly: true,
			partitioned: true,
		},

		// ends here

		database: {
			generateId: false,
		},
	},

	// Added Custom table names for Drizzle ORM and avoiding better auth default
	user: {
		modelName: "users",
	},
	session: {
		modelName: "sessions",
	},
	account: {
		modelName: "accounts",
	},
	verification: {
		modelName: "verifications",
	},
	twoFactor: {
		modelName: "twoFactors",
	},
	jwk: {
		modelName: "jwks",
	},
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: {
			users: schema.users, // not user:
			sessions: schema.sessions, // not session:
			accounts: schema.accounts,
			verifications: schema.verifications,
			twoFactors: schema.twoFactors,
			passkeys: schema.passkeys,
			jwks: schema.jwks,
		},
	}),
});
