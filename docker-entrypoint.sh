#!/bin/sh
# Entrypoint for the better-auth-hono image.
#
# Usage (pass the mode as the container command):
#   (default / "app")  start the auth server
#   migrate            apply committed Drizzle migrations (drizzle/*.sql) — non-interactive, safe for CI/containers
#   push               push schema directly to the DB — interactive, needs a TTY
#   <anything else>    exec the given command verbatim (e.g. `sh`)
#
# Extra args are forwarded, e.g. `push --force`.

# -e: Exit immediately if any command fails.
# -u: Treat unset variables as an error and exit immediately.
set -eu

case "${1:-app}" in
	app)
		exec bun dist/index.js
		;;
	migrate)
		shift
		exec bunx drizzle-kit migrate "$@"
		;;
	push)
		shift
		exec bunx drizzle-kit push "$@"
		;;
	*)
		exec "$@"
		;;
esac
