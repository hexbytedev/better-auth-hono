// lib/email.ts

import * as Sentry from "@sentry/bun";
import { Resend } from "resend";
import { OTP_EXPIRATION_SECONDS, TOKEN_EXPIRATION_SECONDS } from "../config/app.config";
import {
	EMAIL_FROM_NAME,
	type EmailKind,
	type EmailTemplateData,
	type OtpType,
	renderEmail,
} from "./email-templates";
import { requireEnv } from "./env";

const RESEND_API_KEY = requireEnv("RESEND_API_KEY");
const EMAIL_FROM = requireEnv("EMAIL_FROM");
// EMAIL_FROM is normally a bare address; the sender name comes from the templates' config.json.
// A "Name <address>" value still works and wins, so existing configs keep their From header.
// Reply-To always gets the bare address.
const EMAIL_FROM_ADDRESS = EMAIL_FROM.match(/<([^>]+)>/)?.[1] ?? EMAIL_FROM;
const EMAIL_FROM_HEADER =
	EMAIL_FROM.includes("<") || !EMAIL_FROM_NAME ? EMAIL_FROM : `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`;

// Deferred to avoid crash during module init when env vars are missing.
// By the time sendEmail runs, checkEnv() has already validated all requireEnv() calls.
let resend: Resend | undefined;
function getResend(): Resend {
	resend ??= new Resend(RESEND_API_KEY);
	return resend;
}

type Locale = "en" | "de";

// Units per locale: [singular, plural]. German is used by bilingual templates ({{expiresInDe}}).
const TIME_UNITS: Record<
	Locale,
	{
		hour: [string, string];
		minute: [string, string];
		second: [string, string];
		and: string;
		fallback: string;
	}
> = {
	en: {
		hour: ["hour", "hours"],
		minute: ["minute", "minutes"],
		second: ["second", "seconds"],
		and: "and",
		fallback: "a short time",
	},
	de: {
		hour: ["Stunde", "Stunden"],
		minute: ["Minute", "Minuten"],
		second: ["Sekunde", "Sekunden"],
		and: "und",
		fallback: "kurze Zeit",
	},
};

// Helper to convert seconds to human-readable format
function formatExpirationTime(seconds: number, locale: Locale = "en"): string {
	const units = TIME_UNITS[locale];
	// Safety net for non-finite / zero / negative durations. With the range
	// validation in app.config.ts these never reach here, but guard anyway so a
	// misconfiguration can't render "0 second" / "-30 seconds" / "NaN second".
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return units.fallback;
	}

	const count = (value: number, [singular, plural]: [string, string]) =>
		`${value} ${value === 1 ? singular : plural}`;
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	if (hours > 0 && minutes > 0) {
		return `${count(hours, units.hour)} ${units.and} ${count(minutes, units.minute)}`;
	}
	if (hours > 0) {
		return count(hours, units.hour);
	}
	if (minutes > 0) {
		return count(minutes, units.minute);
	}
	return count(seconds, units.second);
}

interface User {
	email: string;
	name?: string;
}

/** The user's name for a greeting, or undefined so templates can fall back to a plain "Hello,". */
function greetingName(user: User): string | undefined {
	return user.name?.trim() || undefined;
}

/** Renders the template for `kind` with the formatted expiry, then sends it. */
async function sendTemplatedEmail(
	kind: EmailKind,
	to: string,
	data: Pick<EmailTemplateData, "name" | "url" | "email" | "newEmail" | "otp" | "otpType"> & {
		expiresInSeconds: number;
	},
) {
	const { expiresInSeconds, ...rest } = data;
	const { subject, html } = renderEmail(kind, {
		expiresIn: formatExpirationTime(expiresInSeconds),
		expiresInDe: formatExpirationTime(expiresInSeconds, "de"),
		...rest,
	});
	return sendEmail(kind, to, subject, html);
}

async function sendEmail(emailType: string, to: string, subject: string, html: string) {
	const { data, error } = await getResend().emails.send({
		from: EMAIL_FROM_HEADER,
		to: [to],
		subject,
		html,
		replyTo: EMAIL_FROM_ADDRESS,
	});

	if (error) {
		const emailError = new Error(`Failed to send email: ${error.message}`);

		// Send to Sentry with email service context
		Sentry.captureException(emailError, {
			tags: {
				feature: "email-service",
				operation: "send-email",
				emailType,
				errorName: error.name,
			},
			extra: {
				errorMessage: error.message,
				statusCode: error.statusCode,
				// Don't log sensitive email content, just metadata
				recipientDomain: to.split("@")[1],
			},
			level: "error",
		});

		throw emailError;
	}

	return data;
}

/**
 * Sends a verification email to the user
 * @param user - User object containing email and optional name
 * @param verificationUrl - The URL for email verification
 * @returns Promise with the email service response
 */
export async function sendVerificationEmail(user: User, verificationUrl: string) {
	return sendTemplatedEmail("verification", user.email, {
		name: greetingName(user),
		url: verificationUrl,
		expiresInSeconds: TOKEN_EXPIRATION_SECONDS,
	});
}

/**
 * Sends a password reset email to the user
 * @param user - User object containing email and optional name
 * @param resetUrl - The URL for password reset
 * @returns Promise with the email service response
 */
export async function sendPasswordResetEmail(user: User, resetUrl: string) {
	return sendTemplatedEmail("password-reset", user.email, {
		name: greetingName(user),
		url: resetUrl,
		expiresInSeconds: TOKEN_EXPIRATION_SECONDS,
	});
}

/**
 * Sends an OTP code to the user's email
 * @param email - The recipient email address
 * @param otp - The one-time password to send
 * @param type - The type of OTP (sign-in, email-verification, forget-password)
 * @returns Promise with the email service response
 */
export async function sendOtpEmail(email: string, otp: string, type: OtpType) {
	return sendTemplatedEmail(`otp-${type}`, email, {
		otp,
		otpType: type,
		expiresInSeconds: OTP_EXPIRATION_SECONDS,
	});
}

/**
 * Sends a verification email to the *new* address during an email change.
 * Distinct from signup verification so the copy does not mention signing up.
 * `user.email` is the new address here: Better Auth overrides it to `newEmail`
 * before invoking this step (see update-user.mjs / email-verification.mjs).
 */
export async function sendChangeEmailVerificationEmail(user: User, verificationUrl: string) {
	return sendTemplatedEmail("change-email-verification", user.email, {
		name: greetingName(user),
		email: user.email,
		url: verificationUrl,
		expiresInSeconds: TOKEN_EXPIRATION_SECONDS,
	});
}

/**
 * Sends a change email confirmation to the user's current email, before the
 * verification link is sent to the new address.
 * @param user - User object containing the current email and optional name
 * @param newEmail - The new email address requested
 * @param confirmationUrl - The URL to approve the email change
 * @returns Promise with the email service response
 */
export async function sendChangeEmailConfirmationEmail(
	user: User,
	newEmail: string,
	confirmationUrl: string,
) {
	return sendTemplatedEmail("change-email-confirmation", user.email, {
		name: greetingName(user),
		newEmail,
		url: confirmationUrl,
		expiresInSeconds: TOKEN_EXPIRATION_SECONDS,
	});
}
