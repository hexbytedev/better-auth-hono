import { describe, expect, test } from "bun:test";
import { isChangeEmailVerificationToken } from "./email-verification-token";

function encodePayload(payload: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${header}.${body}.sig`;
}

describe("isChangeEmailVerificationToken", () => {
	test("detects a change-email token via updateTo (requestType set)", () => {
		const token = encodePayload({
			email: "old@example.com",
			updateTo: "new@example.com",
			requestType: "change-email-verification",
		});
		expect(isChangeEmailVerificationToken(token)).toBe(true);
	});

	test("detects a change-email token via updateTo even without requestType (updateEmailWithoutVerification path)", () => {
		const token = encodePayload({ email: "new@example.com", updateTo: undefined });
		// Better Auth's updateEmailWithoutVerification path creates the token with
		// just the new email, no updateTo/requestType at all; that one genuinely
		// can't be distinguished from a signup token and is documented as a known gap.
		expect(isChangeEmailVerificationToken(token)).toBe(false);

		const changeEmailToken = encodePayload({
			email: "old@example.com",
			updateTo: "new@example.com",
		});
		expect(isChangeEmailVerificationToken(changeEmailToken)).toBe(true);
	});

	test("returns false for signup verification tokens", () => {
		const token = encodePayload({ email: "user@example.com" });
		expect(isChangeEmailVerificationToken(token)).toBe(false);
	});

	test("returns false for malformed tokens", () => {
		expect(isChangeEmailVerificationToken("not-a-jwt")).toBe(false);
		expect(isChangeEmailVerificationToken("")).toBe(false);
	});
});
