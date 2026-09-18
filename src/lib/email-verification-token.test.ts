import { describe, expect, test } from "bun:test";
import { getEmailVerificationRequestType } from "./email-verification-token";

function encodePayload(payload: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${header}.${body}.sig`;
}

describe("getEmailVerificationRequestType", () => {
	test("reads change-email-verification requestType", () => {
		const token = encodePayload({
			email: "old@example.com",
			updateTo: "new@example.com",
			requestType: "change-email-verification",
		});
		expect(getEmailVerificationRequestType(token)).toBe("change-email-verification");
	});

	test("returns undefined for signup verification tokens", () => {
		const token = encodePayload({ email: "user@example.com" });
		expect(getEmailVerificationRequestType(token)).toBeUndefined();
	});

	test("returns undefined for malformed tokens", () => {
		expect(getEmailVerificationRequestType("not-a-jwt")).toBeUndefined();
		expect(getEmailVerificationRequestType("")).toBeUndefined();
	});
});
