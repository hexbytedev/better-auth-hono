/**
 * Detects whether a Better Auth email-verification JWT is for a change-email flow,
 * without verifying the signature. Callers already receive a freshly issued token
 * from Better Auth; this is only used to pick the correct email template (signup
 * vs change-email).
 *
 * Checks for the `updateTo` claim rather than `requestType`: Better Auth sets
 * `updateTo` on every token it creates for an email change (including the
 * `updateEmailWithoutVerification` path, which omits `requestType` entirely), while
 * signup/sign-in verification tokens never carry it. `requestType` alone would miss
 * that path.
 */
export function isChangeEmailVerificationToken(token: string): boolean {
	try {
		const payloadPart = token.split(".")[1];
		if (!payloadPart) return false;
		const json = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Record<
			string,
			unknown
		>;
		return typeof json.updateTo === "string" && json.updateTo.length > 0;
	} catch {
		return false;
	}
}
