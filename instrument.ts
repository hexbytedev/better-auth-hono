import "dotenv/config";
import * as Sentry from "@sentry/bun";

const SENTRY_DSN = process.env.SENTRY_DSN?.trim();

if (SENTRY_DSN) {
    Sentry.init({
        dsn: SENTRY_DSN,
        tracesSampleRate: 1,
        sendDefaultPii: true,
    });
    console.log("Sentry initialized");
}