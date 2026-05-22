// lib/email.ts

import * as Sentry from "@sentry/bun";
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim();
if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is missing");

const EMAIL_FROM = process.env.EMAIL_FROM?.trim();
if (!EMAIL_FROM) throw new Error("EMAIL_FROM is missing");

const COMPANY_NAME = process.env.COMPANY_NAME?.trim();
if (!COMPANY_NAME) throw new Error("COMPANY_NAME is missing");

const PRIMARY_COLOR_RAW = process.env.PRIMARY_COLOR?.trim();
if (!PRIMARY_COLOR_RAW) throw new Error("PRIMARY_COLOR is missing");

// Add # prefix if not present
const PRIMARY_COLOR = PRIMARY_COLOR_RAW.startsWith("#")
	? PRIMARY_COLOR_RAW
	: `#${PRIMARY_COLOR_RAW}`;

// Token expiration in seconds (used for both email verification and password reset)
const TOKEN_EXPIRATION_SECONDS = Number.parseInt(
	process.env.TOKEN_EXPIRATION_SECONDS?.trim() || "3600",
	10,
);

const resend = new Resend(RESEND_API_KEY);

// Helper to convert seconds to human-readable format
function formatExpirationTime(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	if (hours > 0 && minutes > 0) {
		return `${hours} hour${hours > 1 ? "s" : ""} and ${minutes} minute${minutes > 1 ? "s" : ""}`;
	}
	if (hours > 0) {
		return `${hours} hour${hours > 1 ? "s" : ""}`;
	}
	if (minutes > 0) {
		return `${minutes} minute${minutes > 1 ? "s" : ""}`;
	}
	return `${seconds} second${seconds > 1 ? "s" : ""}`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function escapeHtmlAttribute(value: string): string {
	return escapeHtml(value);
}

interface User {
	email: string;
	name?: string;
}

async function sendEmail(emailType: string, to: string, subject: string, html: string) {
	const { data, error } = await resend.emails.send({
		from: `${COMPANY_NAME} <${EMAIL_FROM}>`,
		to: [to],
		subject,
		html,
		replyTo: EMAIL_FROM,
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
 * Reusable HTML wrapper for email consistency across devices
 */
function getEmailTemplate(title: string, bodyContent: string, footerContent: string) {
	return `
	<!DOCTYPE html>
	<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
		<head>
			<meta charset="utf-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<meta name="color-scheme" content="light dark">
			<meta name="supported-color-schemes" content="light dark">
			<!--[if mso]>
			<noscript>
				<xml>
					<o:OfficeDocumentSettings>
						<o:PixelsPerInch>96</o:PixelsPerInch>
					</o:OfficeDocumentSettings>
				</xml>
			</noscript>
			<![endif]-->
			<style>
				body { margin: 0; padding: 0; background-color: #f4f4f5; -webkit-font-smoothing: antialiased; }
				table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
				p { margin: 0; padding: 0; margin-bottom: 24px; }
				a { text-decoration: none; }
			</style>
		</head>
		<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
			<table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f4f5;">
				<tr>
					<td align="center" style="padding: 40px 20px;">
						<!--[if mso]>
						<table align="center" width="600" cellspacing="0" cellpadding="0" border="0">
						<tr><td>
						<![endif]-->
						<table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e4e4e7;">
							<tr>
								<td style="padding: 48px 40px;">
									<h1 style="margin: 0 0 24px 0; font-size: 24px; font-weight: 600; color: #18181b; letter-spacing: -0.5px;">${title}</h1>
									
									<div style="font-size: 16px; line-height: 1.6; color: #3f3f46;">
										${bodyContent}
									</div>
								</td>
							</tr>
						</table>
						
						<table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px;">
							<tr>
								<td style="padding: 32px 40px; text-align: left; font-size: 13px; line-height: 1.6; color: #71717a;">
									${footerContent}
								</td>
							</tr>
						</table>
						<!--[if mso]>
						</td></tr>
						</table>
						<![endif]-->
					</td>
				</tr>
			</table>
		</body>
	</html>
	`;
}

/**
 * Sends a verification email to the user
 * @param user - User object containing email and optional name
 * @param verificationUrl - The URL for email verification
 * @returns Promise with the email service response
 */
export async function sendVerificationEmail(user: User, verificationUrl: string) {
	const subject = "Verify your email address";
	const safeName = escapeHtml(user.name || "there");
	const safeCompanyName = escapeHtml(COMPANY_NAME);
	const safeVerificationUrl = escapeHtmlAttribute(verificationUrl);

	const bodyContent = `
		<p>Hello ${safeName},</p>
		<p>Thank you for signing up with <strong>${safeCompanyName}</strong>. To complete your registration and secure your account, please verify your email address.</p>
		<table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top: 10px; margin-bottom: 10px;">
			<tr>
				<td align="left">
					<a href="${safeVerificationUrl}" style="background-color: ${PRIMARY_COLOR}; color: #ffffff; padding: 16px 32px; font-size: 16px; font-weight: 600; display: inline-block; border: 1px solid ${PRIMARY_COLOR};">Verify Email Address</a>
				</td>
			</tr>
		</table>
		<p style="font-size: 14px; color: #71717a;">This link will expire in ${formatExpirationTime(TOKEN_EXPIRATION_SECONDS)}.</p>
	`;

	const footerContent = `
		If you didn't create an account with us, you can safely ignore this email.
	`;

	const html = getEmailTemplate(subject, bodyContent, footerContent);
	return sendEmail("verification", user.email, subject, html);
}

/**
 * Sends a password reset email to the user
 * @param user - User object containing email and optional name
 * @param resetUrl - The URL for password reset
 * @returns Promise with the email service response
 */
export async function sendPasswordResetEmail(user: User, resetUrl: string) {
	const subject = "Reset your password";
	const safeName = escapeHtml(user.name || "there");
	const safeCompanyName = escapeHtml(COMPANY_NAME);
	const safeResetUrl = escapeHtmlAttribute(resetUrl);

	const bodyContent = `
		<p>Hello ${safeName},</p>
		<p>We received a request to reset the password for your <strong>${safeCompanyName}</strong> account. You can set a new password by clicking the button below.</p>
		<table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top: 10px; margin-bottom: 10px;">
			<tr>
				<td align="left">
					<a href="${safeResetUrl}" style="background-color: ${PRIMARY_COLOR}; color: #ffffff; padding: 16px 32px; font-size: 16px; font-weight: 600; display: inline-block; border: 1px solid ${PRIMARY_COLOR};">Reset Password</a>
				</td>
			</tr>
		</table>
		<p style="font-size: 14px; color: #71717a;">This link will expire in ${formatExpirationTime(TOKEN_EXPIRATION_SECONDS)}.</p>
	`;

	const footerContent = `
		If you didn't request a password reset, you can safely ignore this email. Your current password will remain unchanged.
	`;

	const html = getEmailTemplate(subject, bodyContent, footerContent);
	return sendEmail("password-reset", user.email, subject, html);
}

/**
 * Sends a change email confirmation to the user's current email
 * @param user - User object containing email and optional name
 * @param newEmail - The new email address requested
 * @param confirmationUrl - The URL to approve the email change
 * @returns Promise with the email service response
 */
export async function sendChangeEmailConfirmationEmail(
	user: User,
	newEmail: string,
	confirmationUrl: string,
) {
	const subject = "Approve email change";
	const safeName = escapeHtml(user.name || "there");
	const safeCompanyName = escapeHtml(COMPANY_NAME);
	const safeNewEmail = escapeHtml(newEmail);
	const safeConfirmationUrl = escapeHtmlAttribute(confirmationUrl);

	const bodyContent = `
		<p>Hello ${safeName},</p>
		<p>We received a request to change the email address for your <strong>${safeCompanyName}</strong> account to <strong>${safeNewEmail}</strong>. Please approve this change by clicking the button below.</p>
		<table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top: 10px; margin-bottom: 10px;">
			<tr>
				<td align="left">
					<a href="${safeConfirmationUrl}" style="background-color: ${PRIMARY_COLOR}; color: #ffffff; padding: 16px 32px; font-size: 16px; font-weight: 600; display: inline-block; border: 1px solid ${PRIMARY_COLOR};">Approve Email Change</a>
				</td>
			</tr>
		</table>
		<p style="font-size: 14px; color: #71717a;">This link will expire in ${formatExpirationTime(TOKEN_EXPIRATION_SECONDS)}.</p>
	`;

	const footerContent = `
		If you didn't request an email change, please ignore this email and your account email will remain unchanged.
	`;

	const html = getEmailTemplate(subject, bodyContent, footerContent);
	return sendEmail("change-email-confirmation", user.email, subject, html);
}
