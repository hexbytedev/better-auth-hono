import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createEmailRenderer,
	EMAIL_KINDS,
	type EmailTemplateData,
	loadTemplateConfig,
	OTP_TYPES,
	resolveTemplatesDir,
	toExpiresIn,
} from "./email-templates";

const data: EmailTemplateData = {
	expiresIn: { hours: 1, minutes: 0, seconds: 0 },
	name: "Ada",
	url: "https://example.com/verify?token=abc&next=%2Fhome",
	email: "ada@example.com",
	newEmail: "new-ada@example.com",
	otp: "654321",
};

const tempDirs: string[] = [];

function verificationWith(body: string): string {
	return `{{#> layout}}{{#*inline "body"}}${body}{{/inline}}{{#*inline "footer"}}f{{/inline}}{{/layout}}`;
}

function makeTemplatesDir(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "email-templates-"));
	tempDirs.push(dir);
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, name), content);
	}
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("default email templates", () => {
	const render = createEmailRenderer();

	test("renders every email kind with its subject and the branding variables", () => {
		for (const kind of EMAIL_KINDS) {
			const otpType = OTP_TYPES.find((type) => kind === `otp-${type}`);
			const { subject, html } = render(kind, { ...data, otpType });
			expect(subject.length).toBeGreaterThan(0);
			expect(html).toContain("<!DOCTYPE html>");
			expect(html).toContain(
				`<h1 style="${html.match(/<h1 style="([^"]*)"/)?.[1]}">${subject}</h1>`,
			);
			expect(html).toContain("1 hour");
		}
	});

	test("HTML-escapes user-supplied values, including inside the href attribute", () => {
		const { html } = render("verification", {
			...data,
			name: "<script>alert(1)</script>",
			url: 'https://example.com/?a=1&b="2"',
		});
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		// Handlebars also encodes "=" (as &#x3D;), which mail clients decode before following the link.
		expect(html).toContain('href="https://example.com/?a&#x3D;1&amp;b&#x3D;&quot;2&quot;"');
	});

	test("shows different copy per OTP type", () => {
		const copy = OTP_TYPES.map((otpType) => {
			const { html } = render(`otp-${otpType}`, { ...data, otpType });
			expect(html).toContain("654321");
			return html.match(/<p>(Use the following code[^<]*)<\/p>/)?.[1];
		});
		expect(new Set(copy).size).toBe(OTP_TYPES.length);
		expect(copy.every(Boolean)).toBe(true);
	});

	test("change-email emails address the right email", () => {
		expect(render("change-email-verification", data).html).toContain("ada@example.com");
		expect(render("change-email-confirmation", data).html).toContain("new-ada@example.com");
	});
});

describe("custom email templates", () => {
	test("overrides only the files it provides and falls back to the defaults for the rest", () => {
		const dir = makeTemplatesDir({
			"layout.hbs": "<main>BRANDED {{subject}} {{> body}} | {{> footer}}</main>",
		});
		const render = createEmailRenderer(dir);
		const { html } = render("verification", data);
		expect(html).toContain("<main>BRANDED Verify your email address");
		expect(html).toContain("Hello Ada,");
		expect(html).not.toContain("<!DOCTYPE html>");
	});

	test("merges config.json subjects per key and does not HTML-escape subjects", () => {
		const dir = makeTemplatesDir({
			"config.json": JSON.stringify({
				subjects: { "password-reset": "{{name}} & co: reset your password" },
			}),
		});
		const render = createEmailRenderer(dir);
		expect(render("password-reset", data).subject).toBe("Ada & co: reset your password");
		expect(render("verification", data).subject).toBe("Verify your email address");
	});

	test("replaces a body template", () => {
		const dir = makeTemplatesDir({
			"verification.hbs": verificationWith(
				'Custom {{name}} <a href="{{url}}">go</a> {{expiresIn.hours}}',
			),
		});
		const { html } = createEmailRenderer(dir)("verification", data);
		expect(html).toContain("Custom Ada");
	});

	test("EMAIL_TEMPLATES_DIR falls back to the built-in templates when the folder doesn't exist", () => {
		expect(resolveTemplatesDir(undefined)).toBeUndefined();
		expect(resolveTemplatesDir(join(tmpdir(), "does-not-exist-email-templates"))).toBeUndefined();
		const dir = makeTemplatesDir({ "layout.hbs": "x" });
		expect(resolveTemplatesDir(dir)).toBe(dir);
		const empty = makeTemplatesDir({});
		expect(resolveTemplatesDir(empty)).toBe(empty);
		expect(resolveTemplatesDir(join(dir, "layout.hbs"))).toBeUndefined();
	});

	// Root can read anything, so these permission checks only mean something for a normal user.
	const asRoot = process.getuid?.() === 0;

	test.skipIf(asRoot)(
		"an unreadable EMAIL_TEMPLATES_DIR falls back to the built-in templates",
		() => {
			const dir = makeTemplatesDir({ "layout.hbs": "x" });
			chmodSync(dir, 0o000);
			try {
				expect(resolveTemplatesDir(dir)).toBeUndefined();
			} finally {
				chmodSync(dir, 0o755);
			}
		},
	);

	test.skipIf(asRoot)(
		"an unreadable template file stops the boot with the fix in the message",
		() => {
			const dir = makeTemplatesDir({ "layout.hbs": "x" });
			chmodSync(join(dir, "layout.hbs"), 0o000);
			expect(() => createEmailRenderer(dir)).toThrow("layout.hbs is not readable by the server");
		},
	);

	test("throws when the directory does not exist", () => {
		expect(() => createEmailRenderer(join(tmpdir(), "does-not-exist-email-templates"))).toThrow(
			"EMAIL_TEMPLATES_DIR is not a directory",
		);
	});

	test("throws at load time on a template syntax error", () => {
		const dir = makeTemplatesDir({ "otp.hbs": "{{#if}}unclosed" });
		expect(() => createEmailRenderer(dir)).toThrow();
	});

	test("throws at load time when a template references a missing partial", () => {
		const dir = makeTemplatesDir({ "password-reset.hbs": "{{> nonexistent}}" });
		expect(() => createEmailRenderer(dir)).toThrow(/password-reset.*nonexistent/);
	});

	test("throws when config.json subjects are malformed", () => {
		const dir = makeTemplatesDir({
			"config.json": JSON.stringify({ subjects: { verification: 5 } }),
		});
		expect(() => createEmailRenderer(dir)).toThrow("subjects");
	});

	test("rejects a template that drops the action link", () => {
		const dir = makeTemplatesDir({
			"password-reset.hbs": verificationWith("Hi {{name}}, expires {{expiresIn.hours}}"),
		});
		expect(() => createEmailRenderer(dir)).toThrow("{{url}}");
	});

	test("rejects a template that prints the link as text instead of an href", () => {
		const dir = makeTemplatesDir({
			"verification.hbs": verificationWith("Hi {{name}} {{url}} {{expiresIn.hours}}"),
		});
		expect(() => createEmailRenderer(dir)).toThrow('href="{{url}}"');
	});

	test("rejects an OTP template that drops the code", () => {
		const dir = makeTemplatesDir({ "otp.hbs": verificationWith("Code soon, {{expiresIn.hours}}") });
		expect(() => createEmailRenderer(dir)).toThrow("{{otp}}");
	});

	test("rejects a change-email template that drops the address", () => {
		const dir = makeTemplatesDir({
			"change-email-confirmation.hbs": verificationWith(
				'{{name}} <a href="{{url}}">ok</a> {{expiresIn.hours}}',
			),
		});
		expect(() => createEmailRenderer(dir)).toThrow("{{newEmail}}");
	});

	test("rejects unescaped triple-brace output", () => {
		const dir = makeTemplatesDir({
			"verification.hbs": verificationWith(
				'{{{name}}} <a href="{{url}}">go</a> {{expiresIn.hours}}',
			),
		});
		expect(() => createEmailRenderer(dir)).toThrow("unescaped output");
	});

	test("rejects a layout that does not render the body or footer blocks", () => {
		const noBody = makeTemplatesDir({ "layout.hbs": "<html>{{subject}} {{> footer}}</html>" });
		expect(() => createEmailRenderer(noBody)).toThrow('"body"');
		const noFooter = makeTemplatesDir({ "layout.hbs": "<html>{{subject}} {{> body}}</html>" });
		expect(() => createEmailRenderer(noFooter)).toThrow('"footer"');
	});
});

describe("expiresIn (numbers only, units written by the template)", () => {
	test("toExpiresIn splits seconds into every part, without rounding", () => {
		expect(toExpiresIn(30)).toEqual({ hours: 0, minutes: 0, seconds: 30 });
		expect(toExpiresIn(300)).toEqual({ hours: 0, minutes: 5, seconds: 0 });
		expect(toExpiresIn(3600)).toEqual({ hours: 1, minutes: 0, seconds: 0 });
		expect(toExpiresIn(4830)).toEqual({ hours: 1, minutes: 20, seconds: 30 });
		expect(toExpiresIn(90061)).toEqual({ hours: 25, minutes: 1, seconds: 1 });
	});

	test("toExpiresIn turns invalid durations into zeros instead of NaN", () => {
		for (const bad of [0, -60, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(toExpiresIn(bad)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
		}
		expect(toExpiresIn(90.9)).toEqual({ hours: 0, minutes: 1, seconds: 30 });
	});

	test("the built-in templates print every non-zero part with English units", () => {
		const render = createEmailRenderer();
		const expires = (expiresIn: EmailTemplateData["expiresIn"]) =>
			render("verification", { ...data, expiresIn }).html;
		expect(expires({ hours: 1, minutes: 0, seconds: 0 })).toContain("expire in 1 hour.");
		expect(expires({ hours: 0, minutes: 5, seconds: 0 })).toContain("expire in 5 minutes.");
		expect(expires({ hours: 1, minutes: 20, seconds: 30 })).toContain(
			"expire in 1 hour 20 minutes 30 seconds.",
		);
		expect(expires({ hours: 2, minutes: 0, seconds: 1 })).toContain("expire in 2 hours 1 second.");
	});

	test("a custom template can write the units in its own language", () => {
		const dir = makeTemplatesDir({
			"verification.hbs": verificationWith(
				'<a href="{{url}}">go</a> [{{expiresIn.hours}} Stunde {{expiresIn.minutes}} Minuten {{expiresIn.seconds}} Sekunden]',
			),
		});
		const { html } = createEmailRenderer(dir)("verification", {
			...data,
			expiresIn: { hours: 1, minutes: 20, seconds: 30 },
		});
		expect(html).toContain("[1 Stunde 20 Minuten 30 Sekunden]");
	});

	test("a template that prints no part of the expiry fails the boot", () => {
		const dir = makeTemplatesDir({
			"verification.hbs": verificationWith('<a href="{{url}}">go</a>'),
		});
		expect(() => createEmailRenderer(dir)).toThrow(
			"must print {{expiresIn.hours/minutes/seconds}}",
		);
	});

	test("the built-in templates greet without a name instead of printing an empty one", () => {
		const { html } = createEmailRenderer()("password-reset", { ...data, name: undefined });
		expect(html).toContain("Hello,");
		expect(html).not.toContain("Hello ,");
	});
});

describe("config.json (sender name and subjects)", () => {
	test("the built-in templates have no sender name", () => {
		expect(loadTemplateConfig().fromName).toBe("");
	});

	test("a custom config.json overrides the sender name, and a missing one falls back", () => {
		const custom = makeTemplatesDir({
			"config.json": JSON.stringify({ fromName: "  Acme GmbH " }),
		});
		expect(loadTemplateConfig(custom).fromName).toBe("Acme GmbH");
		expect(loadTemplateConfig(makeTemplatesDir({})).fromName).toBe("");
	});

	test("a custom config without fromName keeps the default, and an empty one clears it", () => {
		const onlySubjects = makeTemplatesDir({ "config.json": JSON.stringify({ subjects: {} }) });
		expect(loadTemplateConfig(onlySubjects).fromName).toBe("");
		const cleared = makeTemplatesDir({ "config.json": JSON.stringify({ fromName: "" }) });
		expect(loadTemplateConfig(cleared).fromName).toBe("");
	});

	test("rejects characters that would break the From header", () => {
		for (const fromName of ["Evil <x@y.z>", 'Say "hi"', "Doe, Inc.", "A\r\nBcc: x@y.z", "A;B"]) {
			const dir = makeTemplatesDir({ "config.json": JSON.stringify({ fromName }) });
			expect(() => loadTemplateConfig(dir)).toThrow("fromName");
		}
		const wrongType = makeTemplatesDir({ "config.json": JSON.stringify({ fromName: 5 }) });
		expect(() => loadTemplateConfig(wrongType)).toThrow("string");
	});
});
