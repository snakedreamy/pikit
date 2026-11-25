# Stage 1: Build the frontend SPA and run license, CSP, i18n, and architecture boundary guards
FROM node:24-alpine AS web-builder
WORKDIR /build/web

COPY web/.npmrc web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run lint:guards && npm run check && npm run build

# Stage 2: Compile a static musl Rust single binary with embedded frontend assets
FROM rust:alpine AS rust-builder
RUN apk add --no-cache musl-dev
WORKDIR /build

ARG PIKBAY_BUILD_COMMIT=unknown
ENV PIKBAY_BUILD_COMMIT=${PIKBAY_BUILD_COMMIT}

COPY Cargo.toml Cargo.lock build.rs config.example.toml ./
COPY src/ ./src/
COPY --from=web-builder /build/web/dist ./web/dist

RUN TARGET="$(rustc -vV | sed -n 's/^host: //p')" \
    && RUSTFLAGS="-C target-feature=+crt-static -D warnings" cargo build --release --locked --target "${TARGET}" \
    && cp "/build/target/${TARGET}/release/pikbay" /build/pikbay \
    && strip /build/pikbay

# Stage 3: Shell-less, non-root, --read-only compatible scratch runtime image
FROM scratch

USER 65532:65532
ENV PIKBAY_CONFIG=/config/pikbay.toml
ENV PIKBAY_LOG=info

COPY --from=rust-builder /build/pikbay /pikbay

EXPOSE 8080
ENTRYPOINT ["/pikbay"]
