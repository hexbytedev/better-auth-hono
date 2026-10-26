import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createEmailRenderer,
	EMAIL_KINDS,
	type EmailTemplateData,
	OTP_TYPES,
} from "./email-templates";

const data: EmailTemplateData = {
	expiresIn: "1 hour",
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

	test("merges subjects.json per key and does not HTML-escape subjects", () => {
		const dir = makeTemplatesDir({
			"subjects.json": JSON.stringify({ "password-reset": "{{name}} & co: reset your password" }),
		});
		const render = createEmailRenderer(dir);
		expect(render("password-reset", data).subject).toBe("Ada & co: reset your password");
		expect(render("verification", data).subject).toBe("Verify your email address");
	});

	test("replaces a body template", () => {
		const dir = makeTemplatesDir({
			"verification.hbs": verificationWith(
				'Custom {{name}} <a href="{{url}}">go</a> {{expiresIn}}',
			),
		});
		const { html } = createEmailRenderer(dir)("verification", data);
		expect(html).toContain("Custom Ada");
	});

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

	test("throws when subjects.json is malformed", () => {
		const dir = makeTemplatesDir({ "subjects.json": JSON.stringify({ verification: 5 }) });
		expect(() => createEmailRenderer(dir)).toThrow("subjects.json");
	});

	test("rejects a template that drops the action link", () => {
		const dir = makeTemplatesDir({
			"password-reset.hbs": verificationWith("Hi {{name}}, expires {{expiresIn}}"),
		});
		expect(() => createEmailRenderer(dir)).toThrow("{{url}}");
	});

	test("rejects a template that prints the link as text instead of an href", () => {
		const dir = makeTemplatesDir({
			"verification.hbs": verificationWith("Hi {{name}} {{url}} {{expiresIn}}"),
		});
		expect(() => createEmailRenderer(dir)).toThrow('href="{{url}}"');
	});

	test("rejects an OTP template that drops the code", () => {
		const dir = makeTemplatesDir({ "otp.hbs": verificationWith("Code soon, {{expiresIn}}") });
		expect(() => createEmailRenderer(dir)).toThrow("{{otp}}");
	});

	test("rejects a change-email template that drops the address", () => {
		const dir = makeTemplatesDir({
			"change-email-confirmation.hbs": verificationWith(
				'{{name}} <a href="{{url}}">ok</a> {{expiresIn}}',
			),
		});
		expect(() => createEmailRenderer(dir)).toThrow("{{newEmail}}");
	});

	test("rejects unescaped triple-brace output", () => {
		const dir = makeTemplatesDir({
			"verification.hbs": verificationWith('{{{name}}} <a href="{{url}}">go</a> {{expiresIn}}'),
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
