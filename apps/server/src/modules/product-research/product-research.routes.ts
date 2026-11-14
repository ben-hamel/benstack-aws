import { createTransactionalDb } from "@benstack-aws/db/transactional";
import { env } from "@benstack-aws/env/server";
import { authMiddleware, orgMiddleware } from "../../middleware/auth";
import { createResearchRoutes } from "./product-research.http";

export default createResearchRoutes({ db: createTransactionalDb(env.DATABASE_URL), origin: new URL(env.CORS_ORIGIN).origin,
  middleware: [authMiddleware, orgMiddleware] });
