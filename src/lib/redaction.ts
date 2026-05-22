export function maskEmail(email: string): string {
	const [localPart, domain] = email.split("@");
	if (!localPart || !domain) return "[redacted-email]";
	return `${localPart.slice(0, 2)}***@${domain}`;
}
