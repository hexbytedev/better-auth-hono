// lib/email-templates.ts

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import Handlebars from "handlebars";
import { optionalEnv } from "./env";

export const OTP_TYPES = [
	"sign-in",
	"email-verification",
	"forget-password",
	"change-email",
] as const;
export type OtpType = (typeof OTP_TYPES)[number];

/**
 * Every email the server can send. The kind doubles as the subjects.json key,
 * and (minus the `otp-` prefix) as the template file name.
 */
export const EMAIL_KINDS = [
	"verification",
	"password-reset",
	"change-email-verification",
	"change-email-confirmation",
	...OTP_TYPES.map((type) => `otp-${type}` as const),
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** Variables available to every template and subject. Optional ones depend on the email kind. */
export interface EmailTemplateData {
	expiresIn: string;
	name?: string;
	url?: string;
	email?: string;
	newEmail?: string;
	otp?: string;
	otpType?: OtpType;
}

type RenderContext = EmailTemplateData & { subject: string };
type SubjectMap = Record<string, string>;

type RenderedEmail = { subject: string; html: string };
export type EmailRenderer = (kind: EmailKind, data: EmailTemplateData) => RenderedEmail;

// Resolved against the working directory (/app in the Docker image, the repo root in dev).
const DEFAULT_TEMPLATES_DIR = resolve(process.cwd(), "templates/email");

// Variables each email file must actually print (`name` is an optional greeting, not listed). Verified at startup (see createEmailRenderer), so
// a custom design that drops the action link or the code fails the boot instead of shipping.
const REQUIRED_VARIABLES: Record<string, (keyof EmailTemplateData)[]> = {
	verification: ["url", "expiresIn"],
	"password-reset": ["url", "expiresIn"],
	"change-email-verification": ["email", "url", "expiresIn"],
	"change-email-confirmation": ["newEmail", "url", "expiresIn"],
	otp: ["otp", "expiresIn"],
};

// Unique, escape-safe values, so each variable can be found in the rendered output.
const SENTINEL_URL = "https://example.invalid/SENTINEL_url";
function sentinelData(otpType?: OtpType): EmailTemplateData {
	return {
		name: "SENTINEL_name",
		url: SENTINEL_URL,
		expiresIn: "SENTINEL_expiresIn",
		email: "SENTINEL_email",
		newEmail: "SENTINEL_newEmail",
		otp: "SENTINEL_otp",
		otpType,
	};
}

function templateFileFor(kind: EmailKind): string {
	return kind.startsWith("otp-") ? "otp" : kind;
}

function isSubjectMap(value: object): value is SubjectMap {
	return Object.values(value).every((entry) => typeof entry === "string");
}

function parseSubjects(path: string): SubjectMap {
	const parsed: object = JSON.parse(readFileSync(path, "utf8"));
	if (Array.isArray(parsed) || !isSubjectMap(parsed)) {
		throw new Error(`${path} must be a JSON object mapping email kinds to subject strings`);
	}
	return parsed;
}

/**
 * Loads, compiles and validates every email template, returning a render function.
 *
 * Files are looked up in `customDir` first, then in the built-in defaults, so a project can
 * override only the files it cares about (typically `layout.hbs`). subjects.json is merged per
 * key. Every email is rendered once with sentinel values, so a syntax error, a missing partial, a
 * template that drops a required variable (the action link, the code, ...) or one that uses
 * unescaped `{{{ }}}` output throws here (at startup) instead of when a user requests a reset.
 */
export function createEmailRenderer(customDir?: string): EmailRenderer {
	const customRoot = customDir ? resolve(customDir) : undefined;
	if (customRoot && (!existsSync(customRoot) || !statSync(customRoot).isDirectory())) {
		throw new Error(`EMAIL_TEMPLATES_DIR is not a directory: ${customRoot}`);
	}
	const dirs = customRoot ? [customRoot, DEFAULT_TEMPLATES_DIR] : [DEFAULT_TEMPLATES_DIR];

	const readTemplateFile = (fileName: string): string => {
		const path = dirs.map((dir) => join(dir, fileName)).find((candidate) => existsSync(candidate));
		if (!path) {
			throw new Error(`Email template "${fileName}" not found in: ${dirs.join(", ")}`);
		}
		const source = readFileSync(path, "utf8");
		// Triple braces disable HTML escaping, which would let a user's name inject markup.
		if (/\{\{\{|\{\{&/.test(source)) {
			throw new Error(
				`${path} uses unescaped output ({{{value}}} or {{&value}}); use {{value}} instead`,
			);
		}
		return source;
	};

	const layoutSource = readTemplateFile("layout.hbs");
	for (const block of ["body", "footer"]) {
		if (!new RegExp(`\\{\\{>\\s*${block}\\s*\\}\\}`).test(layoutSource)) {
			throw new Error(`layout.hbs must render the "${block}" block with {{> ${block}}}`);
		}
	}

	// Isolated instance so the registered partial and helper never leak to other Handlebars users.
	const hbs = Handlebars.create();
	hbs.registerHelper("eq", (a: string, b: string) => a === b);
	hbs.registerPartial("layout", layoutSource);

	const subjectSources = parseSubjects(join(DEFAULT_TEMPLATES_DIR, "subjects.json"));
	const customSubjects = customRoot ? join(customRoot, "subjects.json") : undefined;
	if (customSubjects && existsSync(customSubjects)) {
		Object.assign(subjectSources, parseSubjects(customSubjects));
	}

	const subjects = {} as Record<EmailKind, Handlebars.TemplateDelegate<EmailTemplateData>>;
	const bodies: Record<string, Handlebars.TemplateDelegate<RenderContext>> = {};
	for (const kind of EMAIL_KINDS) {
		const source = subjectSources[kind];
		if (!source) throw new Error(`subjects.json has no subject for "${kind}"`);
		// Subjects are plain text, so they must not be HTML-escaped.
		subjects[kind] = hbs.compile<EmailTemplateData>(source, { noEscape: true });

		const file = templateFileFor(kind);
		bodies[file] ??= hbs.compile<RenderContext>(readTemplateFile(`${file}.hbs`));
	}

	const render: EmailRenderer = (kind, data) => {
		const subject = subjects[kind](data);
		const html = bodies[templateFileFor(kind)]({ ...data, subject });
		return { subject, html };
	};

	for (const kind of EMAIL_KINDS) {
		const file = templateFileFor(kind);
		const otpType = OTP_TYPES.find((type) => kind === `otp-${type}`);
		let html: string;
		try {
			({ html } = render(kind, sentinelData(otpType)));
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`Email template for "${kind}" failed to render: ${reason}`);
		}

		const data = sentinelData(otpType);
		for (const variable of REQUIRED_VARIABLES[file] ?? []) {
			// The action link must be the href of a link or button, not just text.
			const expected = variable === "url" ? `href="${SENTINEL_URL}"` : String(data[variable]);
			if (!html.includes(expected)) {
				const where = variable === "url" ? 'as the href="{{url}}" of the button' : "in the body";
				throw new Error(`${file}.hbs must print {{${variable}}} ${where} (checked for "${kind}")`);
			}
		}
	}

	return render;
}

/**
 * Renders an email's subject and HTML body from the configured templates. Every value is
 * HTML-escaped by Handlebars unless a template opts out with triple braces.
 */
export const renderEmail: EmailRenderer = createEmailRenderer(optionalEnv("EMAIL_TEMPLATES_DIR"));
