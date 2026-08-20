# Local demo image only (kind reproduction, examples/m2-kubernetes-enforcer)
# — not a published/production artifact. Build context must be the repo
# root because this is an npm workspaces monorepo:
#
#   docker build -f packages/kubernetes-enforcer/Dockerfile \
#     -t changesafe-kubernetes-enforcer:dev .
#
FROM node:22-slim AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/domain-network/package.json packages/domain-network/package.json
COPY packages/domain-terraform/package.json packages/domain-terraform/package.json
COPY packages/domain-kubernetes/package.json packages/domain-kubernetes/package.json
COPY packages/kubernetes-enforcer/package.json packages/kubernetes-enforcer/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/ledger/package.json packages/ledger/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/kubernetes-collector/package.json packages/kubernetes-collector/package.json
RUN npm ci

COPY tsconfig.json ./
COPY scripts scripts
COPY packages/core packages/core
COPY packages/domain-kubernetes packages/domain-kubernetes
COPY packages/kubernetes-enforcer packages/kubernetes-enforcer

RUN npm run build -w @changesafe/core -w @changesafe/domain-kubernetes -w @changesafe/kubernetes-enforcer

FROM node:22-slim
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/packages/kubernetes-enforcer
ENV PORT=8443
EXPOSE 8443
CMD ["node", "dist/main.js"]
