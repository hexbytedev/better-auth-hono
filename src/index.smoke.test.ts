import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const smokeTestEnv: Record<string, string> = {
	APP_PORT: "8558",
	BETTER_AUTH_SERVER_URL: "http://localhost:8558",
	BETTER_AUTH_SECRET: "smoke-test-secret-value-with-enough-length",
	BETTER_AUTH_RP_ID: "localhost",
	BETTER_AUTH_RP_NAME: "Smoke Test App",
	CLIENT_URL: "http://localhost:3000",
	ALLOWED_ORIGINS: "http://localhost:3000, http://localhost:3001",
	DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/smoke_test",
	RESEND_API_KEY: "re_test_smoke",
	EMAIL_FROM: "no-reply@example.com",
	COMPANY_NAME: "Smoke Test Company",
	PRIMARY_COLOR: "2d5a2d",
	TOKEN_EXPIRATION_SECONDS: "3600",
	JWT_EXPIRATION_TIME: "1h",
	EMAIL_PASSWORD_ENABLED: "true",
	EMAIL_OTP_ENABLED: "false",
	OTP_EXPIRATION_SECONDS: "300",
	CROSS_SUBDOMAIN_COOKIES_ENABLED: "false",
	COOKIE_SAME_SITE: "lax",
	COOKIE_SECURE: "false",
	COOKIE_HTTP_ONLY: "true",
	COOKIE_PARTITIONED: "false",
	NODE_ENV: "test",
	BETTER_AUTH_TELEMETRY: "0",
};

const clearedEnvKeys = [
	"API_AUTH_USER",
	"API_AUTH_PASSWORD",
	"APP_HOST",
	"APP_SCHEME",
	"FRAUD_CHECK_API_URL",
	"GOOGLE_CLIENT_ID",
	"GOOGLE_CLIENT_SECRET",
	"GITHUB_CLIENT_ID",
	"GITHUB_CLIENT_SECRET",
	"SENTRY_DSN",
	"SENTRY_TRACES_SAMPLE_RATE",
	"SENTRY_SEND_DEFAULT_PII",
] as const;

type AppModule = {
	default: {
		fetch: (request: Request) => Response | Promise<Response>;
	};
};

type HealthResponse = {
	status: string;
	timestamp: string;
	uptime: number;
};

type RootResponse = {
	message: string;
	description: string;
	basicAuth: string;
	links: Array<{
		text: string;
		href: string;
	}>;
};

type ErrorResponse = {
	success: boolean;
	error: string;
	message: string;
};

const originalEnv = new Map<string, string | undefined>();

let appFetch: AppModule["default"]["fetch"] | undefined;

function captureEnvValue(name: string): void {
	if (!originalEnv.has(name)) {
		originalEnv.set(name, process.env[name]);
	}
}

function applySmokeTestEnv(): void {
	for (const [name, value] of Object.entries(smokeTestEnv)) {
		captureEnvValue(name);
		process.env[name] = value;
	}

	for (const name of clearedEnvKeys) {
		captureEnvValue(name);
		delete process.env[name];
	}
}

function restoreEnv(): void {
	for (const [name, value] of originalEnv.entries()) {
		if (value === undefined) {
			delete process.env[name];
			continue;
		}

		process.env[name] = value;
	}
	originalEnv.clear();
}

async function request(path: string, init?: RequestInit): Promise<Response> {
	if (!appFetch) {
		throw new Error("Application fetch handler is not initialized.");
	}

	return await appFetch(new Request(`http://localhost${path}`, init));
}

beforeAll(async () => {
	applySmokeTestEnv();
	const module = (await import("./index")) as AppModule;
	appFetch = module.default.fetch;
});

afterAll(() => {
	restoreEnv();
});

describe("application smoke tests", () => {
	test("health endpoint responds successfully with CORS headers", async () => {
		const response = await request("/api/health", {
			headers: {
				Origin: smokeTestEnv.CLIENT_URL,
			},
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("access-control-allow-origin")).toBe(smokeTestEnv.CLIENT_URL);

		const body = (await response.json()) as HealthResponse;
		expect(body.status).toBe("ok");
		expect(typeof body.timestamp).toBe("string");
		expect(typeof body.uptime).toBe("number");
	});

	test("root endpoint advertises auth docs and disabled basic auth", async () => {
		const response = await request("/");
		expect(response.status).toBe(200);

		const body = (await response.json()) as RootResponse;
		expect(body.basicAuth).toBe("disabled");
		expect(body.links.some((link) => link.href.endsWith("/api/docs"))).toBe(true);
	});

	test("user API returns 503 when basic auth is not configured", async () => {
		const response = await request("/api/users/id/test-user");
		expect(response.status).toBe(503);

		const body = (await response.json()) as ErrorResponse;
		expect(body.success).toBe(false);
		expect(body.error).toBe("Service Unavailable");
	});

	test("unified API docs endpoint is mounted", async () => {
		const response = await request("/api/docs");
		expect(response.status).toBeGreaterThanOrEqual(200);
		expect(response.status).toBeLessThan(400);

		const body = await response.text();
		expect(body.length).toBeGreaterThan(0);
	});
});
