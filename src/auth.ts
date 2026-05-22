// auth.ts

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { expo } from "@better-auth/expo";
import { passkey } from "@better-auth/passkey";
import * as Sentry from "@sentry/bun";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { jwt, openAPI, twoFactor } from "better-auth/plugins";
import { and, eq, ilike, inArray, not, or } from "drizzle-orm";
import { getAllowedOrigins } from "./config/app.config";
import { db } from "./db";
import * as schema from "./db/schema";
import {
	sendChangeEmailConfirmationEmail,
	sendPasswordResetEmail,
	sendVerificationEmail,
} from "./lib/email";
import { maskEmail } from "./lib/redaction";

const OUTBOUND_REQUEST_TIMEOUT_MS = 5000;

function maskIpAddress(ip: string): string {
	if (!ip || ip === "unknown") return "unknown";
	if (ip.includes(":")) {
		const segments = ip.split(":");
		return `${segments.slice(0, 2).join(":")}:****`;
	}
	const octets = ip.split(".");
	if (octets.length !== 4) return "[redacted-ip]";
	return `${octets[0]}.${octets[1]}.x.x`;
}

function getRequestSignal(): AbortSignal {
	return AbortSignal.timeout(OUTBOUND_REQUEST_TIMEOUT_MS);
}

const allowedOrigins = getAllowedOrigins();

const SERVER_URL = process.env.BETTER_AUTH_SERVER_URL?.trim();
if (!SERVER_URL) throw new Error("BETTER_AUTH_SERVER_URL is missing");

const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET?.trim();
if (!BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is missing");

const BETTER_AUTH_RP_ID = process.env.BETTER_AUTH_RP_ID?.trim();
if (!BETTER_AUTH_RP_ID) throw new Error("BETTER_AUTH_RP_ID is missing");

const BETTER_AUTH_RP_NAME = process.env.BETTER_AUTH_RP_NAME?.trim();
if (!BETTER_AUTH_RP_NAME) throw new Error("BETTER_AUTH_RP_NAME is missing");

const CLIENT_URL = process.env.CLIENT_URL?.trim();
if (!CLIENT_URL) throw new Error("CLIENT_URL is missing");

const JWT_EXPIRATION_TIME = process.env.JWT_EXPIRATION_TIME?.trim();
if (!JWT_EXPIRATION_TIME) throw new Error("JWT_EXPIRATION_TIME is missing");

// Optional: Fraud check API URL
const FRAUD_CHECK_API_URL = process.env.FRAUD_CHECK_API_URL?.trim();

// Token expiration in seconds (used for both email verification and password reset)
const TOKEN_EXPIRATION_SECONDS = Number.parseInt(
	process.env.TOKEN_EXPIRATION_SECONDS?.trim() || "3600",
	10,
);

// Cross-subdomain and cookie configuration
const CROSS_SUBDOMAIN_COOKIES_ENABLED = process.env.CROSS_SUBDOMAIN_COOKIES_ENABLED?.trim();
const CROSS_SUBDOMAIN_COOKIES_DOMAIN = process.env.CROSS_SUBDOMAIN_COOKIES_DOMAIN?.trim();
const COOKIE_SAME_SITE = process.env.COOKIE_SAME_SITE?.trim();
const COOKIE_SECURE = process.env.COOKIE_SECURE?.trim();
const COOKIE_HTTP_ONLY = process.env.COOKIE_HTTP_ONLY?.trim();
const COOKIE_PARTITIONED = process.env.COOKIE_PARTITIONED?.trim();

// --- Dynamic Provider Flags ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim();
const isGoogleEnabled = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID?.trim();
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET?.trim();
const isGithubEnabled = Boolean(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET);

// Check if email/password authentication should be enabled (Defaults to true unless explicitly "false")
const EMAIL_PASSWORD_ENABLED = process.env.EMAIL_PASSWORD_ENABLED?.trim() !== "false";

export const auth = betterAuth({
	baseURL: SERVER_URL,
	trustedOrigins: [
		...allowedOrigins,
		// Expo app scheme for deep link authentication
		...(process.env.APP_SCHEME ? [`${process.env.APP_SCHEME}://`] : []),
		// Development mode - Expo's exp:// scheme with local IP ranges
		...(process.env.NODE_ENV === "development"
			? ["exp://", "exp://**", "exp://192.168.*.*:*/**"]
			: []),
	],
	secret: BETTER_AUTH_SECRET,

	// Conditionally add Social Providers
	socialProviders: {
		...(isGoogleEnabled && {
			google: {
				clientId: GOOGLE_CLIENT_ID as string,
				clientSecret: GOOGLE_CLIENT_SECRET as string,
				redirectURI: `${SERVER_URL}/api/auth/callback/google`,
			},
		}),
		...(isGithubEnabled && {
			github: {
				clientId: GITHUB_CLIENT_ID as string,
				clientSecret: GITHUB_CLIENT_SECRET as string,
				scope: ["read:user", "user:email"],
				redirectURI: `${SERVER_URL}/api/auth/callback/github`,
			},
		}),
	},

	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			// Check for email/password signup
			if (ctx.path === "/sign-up/email" && ctx.method === "POST") {
				const body = ctx.body;
				const email = body?.email;

				if (email && typeof email === "string" && FRAUD_CHECK_API_URL) {
					try {
						// Step 1: Check the full email first
						const emailResponse = await fetch(
							`${FRAUD_CHECK_API_URL}/email/${encodeURIComponent(email)}`,
							{
								method: "GET",
								signal: getRequestSignal(),
								redirect: "error",
								headers: {
									"User-Agent": "better-auth-app",
								},
							},
						);

						if (emailResponse.status === 200) {
							// Email is valid, proceed to next checks
						} else {
							// Email check failed, throw error immediately
							console.log(`Email fraud check failed for email: ${maskEmail(email)}`);
							throw new APIError("BAD_REQUEST", {
								code: "EMAIL_NOT_ALLOWED",
								message: "The email address is not allowed. Please use a different email address.",
							});
						}

						// Step 2: Check IP address
						// Check headers sequentially for client IP
						const headers = ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"];
						let clientIP = "unknown";

						for (const header of headers) {
							const headerValue = ctx.request?.headers?.get(header);
							if (headerValue) {
								// For x-forwarded-for, take the first IP if it contains multiple IPs
								clientIP =
									header === "x-forwarded-for"
										? headerValue.split(",")[0]?.trim()
										: headerValue.trim();
								break; // Found IP, stop checking other headers
							}
						}

						console.log(`Checking IP: ${maskIpAddress(clientIP)} for email: ${maskEmail(email)}`);

						if (clientIP && clientIP !== "unknown") {
							try {
								const ipResponse = await fetch(
									`${FRAUD_CHECK_API_URL}/ip/${encodeURIComponent(clientIP)}`,
									{
										method: "GET",
										signal: getRequestSignal(),
										redirect: "error",
										headers: {
											"User-Agent": "better-auth-app",
										},
									},
								);

								if (ipResponse.status === 200) {
									const ipData = await ipResponse.json();
									const security = ipData?.security;

									if (security && security.is_threat === true) {
										console.log(`IP fraud check failed for IP: ${maskIpAddress(clientIP)}`, {
											is_threat: security.is_threat,
										});
										throw new APIError("FORBIDDEN", {
											code: "IP_NOT_ALLOWED",
											message: "Registration from your IP is blocked due to security concerns.",
										});
									}
								} else {
									// IP check API returned non-200, log but don't block
									console.log(
										`IP check API returned ${ipResponse.status} for IP: ${maskIpAddress(clientIP)}`,
									);
								}
							} catch (ipError) {
								if (ipError instanceof APIError) {
									throw ipError; // Re-throw security validation errors
								}
								// Log IP check errors but don't block signup
								console.error("IP fraud check API error:", ipError);
								Sentry.captureException(ipError, {
									tags: { feature: "fraud-check", operation: "ip-check-error" },
									extra: {
										clientIP: maskIpAddress(clientIP),
										email: maskEmail(email),
									},
									level: "warning",
								});
							}
						} else {
							console.log(`Could not determine client IP for email: ${maskEmail(email)}`);
						}

						// All checks passed, allow registration
						return;
					} catch (error) {
						if (error instanceof APIError) {
							throw error; // Re-throw API validation errors
						}

						// Log network/API errors but don't block signup
						console.error("Fraud check API error:", error);
						Sentry.captureException(error, {
							tags: { feature: "fraud-check", operation: "api-error" },
							extra: { email: maskEmail(email) },
							level: "error",
						});

						// Allow signup to proceed if fraud check API is down
						return;
					}
				}
			}
		}),
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
					signal: getRequestSignal(),
					redirect: "error",
				});

				if (!res.ok) {
					console.error("[hooks.after] GitHub API error", res.status);

					// Capture GitHub API errors in Sentry
					Sentry.captureException(new Error(`GitHub API error: ${res.status}`), {
						tags: {
							feature: "github-auth",
							api: "github-emails",
						},
						extra: {
							status: res.status,
							userId,
						},
					});
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
						Sentry.captureException(err, {
							tags: { feature: "github-auth", operation: "insert-emails" },
							extra: { userId, emailCount: filtered.length },
						});
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
						Sentry.captureException(err, {
							tags: { feature: "github-auth", operation: "update-email-flags" },
							extra: { userId, emailCount: filtered.length },
						});
					}

					// Clean up stale records
					const keepEmails = filtered.map((e) => e.email);
					try {
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
						Sentry.captureException(err, {
							tags: { feature: "github-auth", operation: "cleanup-emails" },
							extra: { userId, keepEmailsCount: keepEmails.length },
						});
					}
				}
			} catch (e) {
				console.error("[hooks.after] Failed to fetch/log GitHub emails:", e);
				Sentry.captureException(e, {
					tags: { feature: "github-auth", operation: "fetch-github-emails" },
					extra: { userId },
					level: "error",
				});
			}
		}),
	},

	// Conditionally enable Email & Password
	...(EMAIL_PASSWORD_ENABLED && {
		emailAndPassword: {
			enabled: true,
			autoSignIn: false,
			requireEmailVerification: true,
			async sendResetPassword({ user, url, token }, request) {
				try {
					await sendPasswordResetEmail(user, url);
				} catch (error) {
					console.error("Failed to send password reset email:", error);
					Sentry.captureException(error, {
						tags: { feature: "auth", operation: "send-reset-email" },
						user: { id: user.id },
						extra: { urlPath: new URL(url).pathname },
					});
					throw error; // Re-throw so Better Auth knows it failed
				}
			},
			password: {},
			resetPasswordTokenExpiresIn: TOKEN_EXPIRATION_SECONDS,
		},
	}),

	...(EMAIL_PASSWORD_ENABLED && {
		emailVerification: {
			sendOnSignUp: true,
			sendOnSignIn: false, // Don't send on every sign-in attempt
			autoSignInAfterVerification: false,
			async sendVerificationEmail({ user, url }) {
				try {
					await sendVerificationEmail(user, url);
				} catch (error) {
					Sentry.captureException(error, {
						tags: { feature: "auth", operation: "send-verification-email" },
						user: { id: user.id },
					});
					throw error;
				}
			},
			expiresIn: TOKEN_EXPIRATION_SECONDS,
		},
	}),

	plugins: [
		expo(),
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
		crossSubDomainCookies: {
			enabled: CROSS_SUBDOMAIN_COOKIES_ENABLED === "true",
			domain: CROSS_SUBDOMAIN_COOKIES_DOMAIN,
		},
		defaultCookieAttributes: {
			sameSite: COOKIE_SAME_SITE as "strict" | "lax" | "none",
			secure: COOKIE_SECURE === "true",
			httpOnly: COOKIE_HTTP_ONLY === "true",
			partitioned: COOKIE_PARTITIONED === "true",
		},
		database: {
			generateId: false,
		},
	},

	// Custom table names for Core Drizzle ORM models
	user: {
		modelName: "users",
		...(EMAIL_PASSWORD_ENABLED && {
			changeEmail: {
				enabled: true,
				sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
					try {
						await sendChangeEmailConfirmationEmail(user, newEmail, url);
					} catch (error) {
						console.error("Failed to send change email confirmation:", error);
						Sentry.captureException(error, {
							tags: { feature: "auth", operation: "send-change-email-confirmation" },
							user: { id: user.id },
							extra: {
								urlPath: new URL(url).pathname,
								newEmail: maskEmail(newEmail),
							},
						});
						throw error;
					}
				},
			},
		}),
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

	database: drizzleAdapter(db, {
		provider: "pg",
		schema: {
			users: schema.users,
			sessions: schema.sessions,
			accounts: schema.accounts,
			verifications: schema.verifications,
			twoFactors: schema.twoFactors,
			passkeys: schema.passkeys,
			jwks: schema.jwks,
		},
	}),
});
