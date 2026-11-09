import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "./jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

function extractBearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

// Attaches req.userId when a valid access token is present; `requireAuth`
// rejects. Public routes (society search, categories, health) stay anonymous.
export const authPlugin = fp(async (fastify) => {
  fastify.decorateRequest("userId", undefined);
  fastify.addHook("onRequest", async (req) => {
    const token = extractBearer(req);
    if (!token) return;
    try {
      req.userId = verifyAccessToken(token).sub;
    } catch {
      // invalid/expired: requireAuth will 401
    }
  });
});

// Accounts deleted by this process. Their sessions are gone (refresh fails),
// but an access token stays valid for up to 15 min; this refuses it at once.
// In memory on purpose: borrowvault-api is one container, and after a restart
// the token expiry bounds the window anyway.
const deletedUserIds = new Set<string>();

export function markUserDeleted(userId: string): void {
  deletedUserIds.add(userId);
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!req.userId) {
    return reply.code(401).send({ error: "not_authenticated" });
  }
  if (deletedUserIds.has(req.userId)) {
    return reply.code(401).send({ error: "account_deleted" });
  }
}
