export function maskEmail(email: string): string {
	const atIndex = email.indexOf("@");
	// Need at least one local-part char before "@" and one domain char after.
	if (atIndex <= 0 || atIndex === email.length - 1) return "[redacted-email]";

	const localPart = email.slice(0, atIndex);
	const domain = email.slice(atIndex + 1);

	// Reveal fewer characters for shorter local parts so the whole local part is
	// never disclosed; a 1-char local part reveals nothing.
	const revealCount = localPart.length <= 1 ? 0 : localPart.length <= 3 ? 1 : 2;
	return `${localPart.slice(0, revealCount)}***@${domain}`;
}

export function maskIpAddress(raw: string): string {
	if (!raw || raw === "unknown") return "unknown";

	// Strip an IPv4-mapped IPv6 prefix and a trailing :port so an IPv4 value is
	// recognized as IPv4 (e.g. "::ffff:203.0.113.7" or "203.0.113.7:443").
	let ip = raw.replace(/^::ffff:/i, "");
	const v4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
	if (v4WithPort) ip = v4WithPort[1];

	const octets = ip.split(".");
	if (octets.length === 4) return `${octets[0]}.${octets[1]}.x.x`;
	if (ip.includes(":")) return `${ip.split(":").slice(0, 2).join(":")}:****`;
	return "[redacted-ip]";
}
