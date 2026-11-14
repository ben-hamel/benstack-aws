# AWS Emulator pilot

This is an optional compatibility probe, not a replacement for AWS staging.
It does not import the application, load `.env`, connect to PostgreSQL, or use
real AWS credentials. It creates synthetic receipt-shaped JSON only.

## Run

Install AWS Emulator using the [official Linux instructions](https://docs.aws.amazon.com/emulator/latest/userguide/getting-started-linux.html), then:

```bash
bash scripts/aws-emulator-smoke.sh
# Or pass an extracted/native binary without installing it system-wide:
bash scripts/aws-emulator-smoke.sh /absolute/path/to/aws-emulator
```

Requires Node and the repository's already-installed server dependencies.
The runner starts an isolated emulator with a temporary HOME, random loopback
port, authentication enabled, and telemetry disabled. It stops the process and
removes its temporary configuration on exit. The probe explicitly supplies the
local endpoint and emulator credentials; it never uses the normal credential
provider chain. TLS verification stays enabled with the emulator certificate.

A nonzero exit status means an assertion failed or compatibility gaps were found.
The CORS check sends browser-style headers but is not a real-browser test (it does
not validate browser certificate trust).

## Observed results

Tested AWS Emulator 1.0.345 (release 2026-11-13) using the repository's installed
AWS SDK dependencies:

- PASS: health, CreateBucket, PutBucketCors configuration accepted.
- GAP: browser-style OPTIONS preflight returns HTTP 501.
- GAP: presigned PutObject upload returns HTTP 403 / SignatureDoesNotMatch.
- PASS: header-signed SDK PutObject, GetObject with matching content.
- PASS: missing key returns NoSuchKey / HTTP 404.
- PASS: delete object and bucket cleanup.

The presigned URL failure is an observed compatibility issue, not a diagnosed
root cause. No real-AWS comparison was performed in this trial.

**Conclusion:** useful for basic backend S3 tests, but the current app's browser
receipt-upload flow cannot run unchanged against this tested version. Do not
wire normal development or deployment to it yet. S3 notifications, SQS, Lambda
execution, the Parameters/Secrets extension, Terraform, and database integration
remain untested.
