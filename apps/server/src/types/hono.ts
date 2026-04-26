import type { auth } from "@benstack-aws/auth";

export type AppVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
  orgId: string | null;
};

export type AppEnv = {
  Variables: AppVariables;
};
