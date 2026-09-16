# Built from the repository root so the monorepo layout is explicit, rather
# than relying on Railway's root-directory setting, which lives outside the repo.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.8.17 /uv /usr/local/bin/uv

# Uvicorn runs as this unprivileged user rather than as root, so a code
# execution bug in the API does not also hand an attacker root in the
# container. The user is created before anything else so every later step —
# installing dependencies, copying source, running the server — can own its
# files as it goes, rather than fixing ownership afterwards with a recursive
# chown, which would duplicate the whole layer and bloat the image.
RUN groupadd --system api && useradd --system --gid api --home-dir /app api

WORKDIR /app
# WORKDIR creates /app as root before this runs. Handing the empty directory
# to the runtime user here is a single, cheap chown of one directory entry —
# not the recursive chown this comment warns against — because nothing has
# been copied into it yet; every COPY and RUN below keeps it owned correctly.
RUN chown api:api /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    HOME=/app

# Dependencies resolve in their own layer so source edits do not re-install them.
COPY --chown=api:api apps/api/pyproject.toml apps/api/uv.lock ./
USER api
RUN uv sync --frozen --no-dev --no-install-project

COPY --chown=api:api apps/api/src ./src
# The family tree is a file in apps/api now (#126 -- moved so a Vercel
# project rooted at apps/api can bundle it without reaching outside its own
# root directory). It ships inside this image too, unchanged. Copied without
# --chown, which leaves it owned by root regardless of the USER above (COPY
# always runs as the builder, not the runtime user) — so the api user keeps
# its normal read access but cannot write it, matching that the API only
# ever reads the tree.
COPY apps/api/data ./data
# The reference manual is served from the root of this service, so it ships
# with it — see default_manual_path() in api.main. Moved alongside the data
# in #126, for the same reason. Read-only to the api user for the same
# reason the tree is: nothing here should ever write to it.
COPY apps/api/manual ./manual
RUN uv sync --frozen --no-dev

ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uv run uvicorn api.main:app --host 0.0.0.0 --port ${PORT}"]
