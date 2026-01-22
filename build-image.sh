docker buildx build --platform linux/amd64,linux/arm64 -t pilinux/better-auth-hono-migrate:0.0.1 --target migrate --output type=docker .
docker buildx build --platform linux/amd64,linux/arm64 -t pilinux/better-auth-hono:0.0.1 --target runner --output type=docker .
# docker push pilinux/better-auth-hono-migrate:0.0.1
# docker push pilinux/better-auth-hono:0.0.1
