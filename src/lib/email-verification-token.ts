/**
 * Reads `requestType` from a Better Auth email-verification JWT without verifying
 * the signature. Callers already receive a freshly issued token from Better Auth;
 * this is only used to pick the correct email template (signup vs change-email).
 */
export function getEmailVerificationRequestType(token: string): string | undefined {
	try {
		const payloadPart = token.split(".")[1];
		if (!payloadPart) return undefined;
		const json: unknown = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
		if (
			typeof json === "object" &&
			json !== null &&
			"requestType" in json &&
			typeof (json as { requestType: unknown }).requestType === "string"
		) {
			return (json as { requestType: string }).requestType;
		}
		return undefined;
	} catch {
		return undefined;
	}
}
