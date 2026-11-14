import { db } from "@benstack-aws/db";
import { env } from "@benstack-aws/env/server";
import { createAuth } from "./factory";

export const auth = createAuth(db, env);
