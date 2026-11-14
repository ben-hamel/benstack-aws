import { auth } from "@benstack-aws/auth";
import { db } from "@benstack-aws/db";
import { createAuthMiddlewares } from "./auth-factory";

export const { authMiddleware, orgMiddleware } = createAuthMiddlewares(auth, db);
