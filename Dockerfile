# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df
RUN --mount=type=secret,id=corporate_ca \
    set -eu; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends git ca-certificates; \
    if [ -f /run/secrets/corporate_ca ]; then cp /run/secrets/corporate_ca /usr/local/share/ca-certificates/harness-build-ca.crt; update-ca-certificates; fi; \
    rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json /opt/pi/
RUN --mount=type=secret,id=corporate_ca \
    set -eu; \
    if [ -f /run/secrets/corporate_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/corporate_ca; fi; \
    cd /opt/pi; npm ci --ignore-scripts; ln -s /opt/pi/node_modules/.bin/pi /usr/local/bin/pi
ENV PI_OFFLINE=1 PI_TELEMETRY=0
WORKDIR /work
ENTRYPOINT ["pi"]
