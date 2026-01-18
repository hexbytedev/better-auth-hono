// lib/email.ts

import * as Sentry from "@sentry/bun";

const EMAIL_SERVICE_URL = process.env.EMAIL_SERVICE_API?.trim();
if (!EMAIL_SERVICE_URL) throw new Error("EMAIL_SERVICE_API is missing");

// --- New Environment Variables for Basic Auth ---
const EMAIL_SERVICE_USERNAME = process.env.EMAIL_SERVICE_USERNAME?.trim();
if (!EMAIL_SERVICE_USERNAME) throw new Error("EMAIL_SERVICE_USERNAME is missing");

const EMAIL_SERVICE_PASSWORD = process.env.EMAIL_SERVICE_PASSWORD?.trim();
if (!EMAIL_SERVICE_PASSWORD) throw new Error("EMAIL_SERVICE_PASSWORD is missing");

interface User {
	email: string;
	name?: string;
}

async function sendEmail(endpoint: string, data: any) {
	// Create the Base64 encoded credentials for the Authorization header
	const credentials = `${EMAIL_SERVICE_USERNAME}:${EMAIL_SERVICE_PASSWORD}`;
	const encodedCredentials = Buffer.from(credentials).toString("base64");

	const url = `${EMAIL_SERVICE_URL}${endpoint}`;
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			// The Authorization header for Basic Auth
			Authorization: `Basic ${encodedCredentials}`,
		},
		body: JSON.stringify(data),
	});

	const responseData = await response.json().catch(() => ({}));

	if (!response.ok) {
		const error = new Error(`Failed to send email: ${response.status} ${response.statusText}`);

		// Send to Sentry for monitoring
		Sentry.captureException(error, {
			extra: {
				endpoint,
				status: response.status,
				responseData,
				emailType: endpoint.split('/').pop() // e.g., "verification-email"
			}
		});

		throw error;
	}

	return responseData;
}

/**
 * Sends a verification email to the user
 * @param user - User object containing email and optional name
 * @param verificationUrl - The URL for email verification
 * @returns Promise with the email service response
 */
export async function sendVerificationEmail(user: User, verificationUrl: string) {
	return sendEmail("/emails/auth/verification-email", {
		user: {
			email: user.email,
			name: user.name || "",
		},
		verificationUrl,
	});
}

/**
 * Sends a password reset email to the user
 * @param user - User object containing email and optional name
 * @param resetUrl - The URL for password reset
 * @returns Promise with the email service response
 */
export async function sendPasswordResetEmail(user: User, resetUrl: string) {
	return sendEmail("/emails/auth/password-reset-email", {
		user: {
			email: user.email,
			name: user.name || "",
		},
		resetUrl,
	});
}
