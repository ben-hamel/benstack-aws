#!/bin/sh
TASK=$(aws ecs list-tasks --cluster benstack --service-name benstack-api --query 'taskArns[0]' --output text)
aws ecs execute-command \
  --cluster benstack \
  --task "$TASK" \
  --container api \
  --interactive \
  --command "/bin/sh -c 'psql \$(echo \$DATABASE_URL | sed s/sslmode=no-verify/sslmode=require/)'"
