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
 * Every email the server can send. The kind doubles as the config.json subjects key,
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
	expiresInDe: string;
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
		expiresInDe: "SENTINEL_expiresInDe",
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

interface TemplateConfig {
	/** Sender display name, e.g. "Acme" in `Acme <no-reply@acme.com>`. */
	fromName: string;
	/** Subject line per email kind (Handlebars strings). */
	subjects: SubjectMap;
}

function parseConfig(path: string): Partial<TemplateConfig> {
	const parsed: object = JSON.parse(readFileSync(path, "utf8"));
	const fromName = "fromName" in parsed ? parsed.fromName : undefined;
	const subjects = "subjects" in parsed ? parsed.subjects : undefined;

	if (fromName !== undefined && typeof fromName !== "string") {
		throw new Error(`${path}: "fromName" must be a string`);
	}
	// These would break the From header, e.g. `Doe, Inc. <a@b.com>` or an injected extra header.
	if (fromName !== undefined && /[<>",;\r\n]/.test(fromName)) {
		throw new Error(`${path}: "fromName" must not contain < > " , ; or line breaks`);
	}
	if (
		subjects !== undefined &&
		(typeof subjects !== "object" ||
			subjects === null ||
			Array.isArray(subjects) ||
			!isSubjectMap(subjects))
	) {
		throw new Error(`${path}: "subjects" must be an object mapping email kinds to strings`);
	}
	return { fromName: fromName?.trim(), subjects };
}

/**
 * Reads `config.json` ({ "fromName": "...", "subjects": { "<email kind>": "..." } }). The custom
 * directory is overlaid on the built-in one: its `fromName` wins and its `subjects` are merged per
 * key, so a project can override a single subject. Keeping the sender name and subjects in one file
 * (and out of env vars) means the whole brand lives in the template folder.
 */
export function loadTemplateConfig(customDir?: string): TemplateConfig {
	const base = parseConfig(join(DEFAULT_TEMPLATES_DIR, "config.json"));
	const customPath = customDir ? join(resolve(customDir), "config.json") : undefined;
	const custom = customPath && existsSync(customPath) ? parseConfig(customPath) : {};
	return {
		fromName: custom.fromName ?? base.fromName ?? "",
		subjects: { ...base.subjects, ...custom.subjects },
	};
}

/**
 * Loads, compiles and validates every email template, returning a render function.
 *
 * Files are looked up in `customDir` first, then in the built-in defaults, so a project can
 * override only the files it cares about (typically `layout.hbs`). config.json is merged per key. Every email is rendered once with sentinel values, so a syntax error, a missing partial, a
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

	const subjectSources = loadTemplateConfig(customRoot).subjects;

	const subjects = {} as Record<EmailKind, Handlebars.TemplateDelegate<EmailTemplateData>>;
	const bodies: Record<string, Handlebars.TemplateDelegate<RenderContext>> = {};
	for (const kind of EMAIL_KINDS) {
		const source = subjectSources[kind];
		if (!source) throw new Error(`config.json has no subject for "${kind}"`);
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

const OVERRIDABLE_FILES = [
	"layout.hbs",
	...new Set(EMAIL_KINDS.map((kind) => `${templateFileFor(kind)}.hbs`)),
	"config.json",
];

/** Logs where templates come from, so a wrong mount path shows up at startup, not as "wrong design". */
function logTemplateSource(customDir?: string): void {
	if (!customDir) {
		console.log("[EMAIL] Using the built-in email templates");
		return;
	}
	const root = resolve(customDir);
	const found = OVERRIDABLE_FILES.filter((file) => existsSync(join(root, file)));
	if (found.length === 0) {
		console.warn(
			`[EMAIL] EMAIL_TEMPLATES_DIR (${root}) contains no template files, using the built-in templates. Check the mount path.`,
		);
		return;
	}
	console.log(`[EMAIL] Using templates from ${root}, overriding: ${found.join(", ")}`);
}

const EMAIL_TEMPLATES_DIR = optionalEnv("EMAIL_TEMPLATES_DIR");
logTemplateSource(EMAIL_TEMPLATES_DIR);

/** Sender display name from the template folder, or "" when there is none. */
export const EMAIL_FROM_NAME: string = loadTemplateConfig(EMAIL_TEMPLATES_DIR).fromName;

/**
 * Renders an email's subject and HTML body from the configured templates. Every value is
 * HTML-escaped by Handlebars unless a template opts out with triple braces.
 */
export const renderEmail: EmailRenderer = createEmailRenderer(EMAIL_TEMPLATES_DIR);
