# ──────────────────────────────────────────────────────────────
# Stage 1 – EXPORT: use Poetry to export a requirements.txt
# ──────────────────────────────────────────────────────────────
# Poetry 2.x can segfault under Podman / QEMU on ARM64 during
# `poetry install`.  We side-step this by only using Poetry to
# *export* a pinned requirements.txt, then let pip do the heavy
# lifting in the build stage.
# ──────────────────────────────────────────────────────────────
FROM python:3.13-slim AS export

ARG APT_MIRROR=https://deb.debian.org/debian
ARG APT_SECURITY_MIRROR=https://deb.debian.org/debian-security

ENV POETRY_VERSION=2.1.3 \
    POETRY_HOME=/opt/poetry \
    POETRY_NO_INTERACTION=1

ENV PATH=$POETRY_HOME/bin:$PATH

RUN sed -i "s|http://deb.debian.org/debian|${APT_MIRROR}|g; s|http://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
 && apt-get update -o Acquire::Retries=3 \
 && apt-get install -y --no-install-recommends -o Acquire::Retries=3 curl ca-certificates \
 && curl -sSL https://install.python-poetry.org | python3 - --version $POETRY_VERSION \
 && poetry self add poetry-plugin-export \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml poetry.lock ./

RUN poetry export --only main --without-hashes -f requirements.txt -o requirements.txt


# ──────────────────────────────────────────────────────────────
# Stage 2 – BUILD: pip install into a venv using requirements.txt
# ──────────────────────────────────────────────────────────────
FROM python:3.13-slim AS build

ARG APT_MIRROR=https://deb.debian.org/debian
ARG APT_SECURITY_MIRROR=https://deb.debian.org/debian-security

# Install every system library needed to *compile* native wheels:
#   build-essential  → gcc / g++ / make (contourpy, etc.)
#   libffi-dev       → cffi
#   python3-dev      → CPython headers
#   libpq-dev        → psycopg
#   libgdal-dev      → pyogrio / GDAL (transitive via geopandas)
RUN sed -i "s|http://deb.debian.org/debian|${APT_MIRROR}|g; s|http://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
 && apt-get update -o Acquire::Retries=3 \
 && apt-get install -y --no-install-recommends -o Acquire::Retries=3 \
      build-essential \
      libffi-dev \
      python3-dev \
      libpq-dev \
      libgdal-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create a virtualenv and install deps via pip (no Poetry at runtime)
RUN python -m venv .venv
ENV PATH="/app/.venv/bin:$PATH"

COPY --from=export /app/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt


# ──────────────────────────────────────────────────────────────
# Stage 3 – RUNTIME: slim image with only runtime libraries
# ──────────────────────────────────────────────────────────────
FROM python:3.13-slim

ARG APT_MIRROR=https://deb.debian.org/debian
ARG APT_SECURITY_MIRROR=https://deb.debian.org/debian-security

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONOPTIMIZE=1

# Runtime system libraries only (no compilers):
#   libpq5           → psycopg runtime
#   libgeos-dev      → shapely runtime
#   libgdal*         → pyogrio / GDAL runtime
# Note: The exact libgdal package name varies by Debian version.
RUN sed -i "s|http://deb.debian.org/debian|${APT_MIRROR}|g; s|http://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
 && apt-get update -o Acquire::Retries=3 \
 && apt-get install -y --no-install-recommends -o Acquire::Retries=3 \
      ca-certificates \
      libpq5 \
      libgeos-dev \
      gdal-bin \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the pre-built virtualenv from the build stage
COPY --from=build /app/.venv .venv

# Put the venv's Python on PATH
ENV PATH="/app/.venv/bin:$PATH"

# Copy application code
COPY . .

# Precompile Python bytecode for faster imports at runtime
RUN python -m compileall -q .

# Thread pool defaults (overridable at runtime)
ENV GEOPILOT_HIGH_PRIORITY_THREADS="" \
    GEOPILOT_LOW_PRIORITY_THREADS="" \
    GEOPILOT_MAX_CONCURRENT_PRELOADS="3"

EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
