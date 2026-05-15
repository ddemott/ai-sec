import type { FastifyInstance } from 'fastify';

// The app in `src/index.ts` is constructed with `https` in non-prod and
// plain http in prod — those produce different RawServer generics, so a
// bare `FastifyInstance` can't accept both. Every route module + middleware
// hook receives this loose alias so the wiring in `src/index.ts` doesn't
// have to cast per call. Genuine fix would be threading
// `FastifyInstance<RawServer, RawRequest, RawReply>` through every module
// with a single source of truth for the server type; the alias is the
// conventional Fastify pattern when the server isn't known by the consumer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- framework boundary, see comment above
export type AppFastifyInstance = FastifyInstance<any, any, any>;
