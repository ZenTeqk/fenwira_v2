# Postgres 16 (Alpine, same base as before) plus pgvector for the AI Assistant knowledge base
# (docs/AI_ASSISTANT.md). Built from the release tarball; OPTFLAGS="" keeps the binary portable
# (no -march=native) and with_llvm=no skips JIT bitcode the Alpine image has no toolchain for.
FROM postgres:16-alpine
ARG PGVECTOR_VERSION=0.8.0
RUN apk add --no-cache --virtual .pgvector-build build-base curl \
 && curl -fsSL "https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VERSION}.tar.gz" | tar xz -C /tmp \
 && make -C "/tmp/pgvector-${PGVECTOR_VERSION}" OPTFLAGS="" with_llvm=no \
 && make -C "/tmp/pgvector-${PGVECTOR_VERSION}" OPTFLAGS="" with_llvm=no install \
 && rm -rf "/tmp/pgvector-${PGVECTOR_VERSION}" \
 && apk del .pgvector-build
