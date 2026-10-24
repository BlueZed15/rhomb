# 01. AWS: S3 source bucket

> **What I actually did** (this guide is the plan; here's where reality differed):
> - Names: bucket `rhombus-input-data` (`ap-southeast-2`), IAM user `rhombus-input-1`.
> - **The S3 connection in Step 4 never worked.** Rhombus was denied inside its own network, with the bucket policy and their CloudFormation template both applied ([write-up](../../observations/setup-s3-source-connection.md)). So Rhombus reads the file through a presigned link instead ([D9](../decisions.md#d9-s3-through-a-presigned-url-instead-of-the-s3-connector)). Steps 0–3 are still used: the bucket, versioning and the IAM user power that workaround.
> - I turned **Block Public Access off** while debugging. It wasn't the cause, and it should go back on.

The goal is an S3 bucket that Rhombus can **read** (through a bucket policy it generates, so no keys are shared), plus a separate IAM user that my local scripts use to upload drift files and read input. See [D3](../decisions.md#d3-a-separate-minimal-identity-for-each-job), [D4](../decisions.md#d4-versioning-on-the-s3-bucket) and [D5](../decisions.md#d5-each-drift-file-is-its-own-import-and-a-case-switches-the-input).

All steps use the AWS Console. Nothing here needs the AWS CLI.

## Values used (fill these in; they aren't secret)

| Item | Value |
|---|---|
| Region | e.g. `ap-southeast-2` |
| Source bucket | e.g. `rhombus-qa-src-<suffix>` |
| Source objects | `input/fuelcheck.xlsx` (live) + one copy per case in `input/archive/` ([runs.csv](../../data-validation/runs.csv)) |
| Local QA IAM user | `rhombus-qa-local` |

---

## Step 0. Cost guardrail (2 min)
**Billing and Cost Management → Budgets → Create budget → "Zero spend budget"** → your email.
> Everything here fits in the free tier, so a zero-spend alert catches mistakes such as a leaked key or a runaway loop on the day they happen, not on the invoice.

## Step 1. Create the bucket
**S3 → Create bucket**

| Setting | Value | Why |
|---|---|---|
| Bucket type | General purpose | |
| Name | `rhombus-qa-src-<suffix>` | Bucket names are globally unique, so add a suffix |
| Region | your choice, recorded above | Rhombus's S3 connector needs the bucket's **actual** region. A mismatch fails verification. |
| Object Ownership | ACLs disabled (default) | Access is controlled by policy only, not per-object ACLs |
| Block **all** public access | **On** (default) | Rhombus's docs require it, and nothing here should be public |
| Bucket Versioning | **Enable** | Every drift version can be recovered and cited by `VersionId` ([D4](../decisions.md#d4-versioning-on-the-s3-bucket)) |
| Default encryption | SSE-S3 (default) | SSE-KMS would need extra KMS key-policy grants for Rhombus. It adds complexity without adding anything to these tests. |

## Step 2. Create the `input/` folder
Open the bucket → **Create folder** → `input`.
> This matters because the Rhombus grant is limited to this prefix ("Folder / path"), so Rhombus can't read anything else you put in the bucket later, such as notes or old outputs.

Don't upload the dataset yet. That happens after the dataset is generated ([`datasets/`](../../datasets/)).

## Step 3. Local QA IAM user (for my scripts, not Rhombus)
1. **IAM → Users → Create user** → `rhombus-qa-local`. **Don't** give it console access.
2. **Permissions → Attach policies directly → Create inline policy → JSON**. Paste [`infra/aws/local-qa-user-policy.json`](../../infra/aws/local-qa-user-policy.json), replacing `<SOURCE_BUCKET>`. Name it `rhombus-qa-local-s3`.
3. Open the user → **Security credentials → Create access key** → use case **"Local code"** → copy both values into `.env` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).

> The scripts only need to upload drift files and read them back, so that's all this user can do. There's no delete permission, so a bug in a script can't destroy evidence, and versioning keeps every overwrite.

## Step 4. Grant Rhombus read access
Do this in Rhombus, following [03-rhombus-pipeline.md → Connect S3](03-rhombus-pipeline.md#step-2-connect-s3-source). In short:
1. In Rhombus: **Data → Sources → Amazon S3**. Enter the bucket, region, and **Folder / path = `input/`**.
2. Expand **AWS access setup**, copy the generated policy, and save a copy to `infra/aws/rhombus-source-bucket-policy.json`. Its principal ARNs belong to Rhombus and aren't secret.
3. **S3 → bucket → Permissions → Bucket policy → Edit** → paste the statements → Save.
4. Back in Rhombus → **Connect S3 source**.

> I went with the bucket policy rather than CloudFormation because it's one visible JSON document that a reviewer can read and diff. I tried Rhombus's CloudFormation template as well when the policy didn't work. Neither connected.

## Verify
- [ ] Bucket shows **Versioning: Enabled** and **Block all public access: On**
- [ ] `input/` exists
- [ ] Bucket policy contains only the Rhombus statements, which grant `GetBucketLocation`, `ListBucket` and `GetObject` and are scoped to `input/`
- [ ] `.env` has the local user's keys, and `git status` doesn't show `.env`
- [ ] Screenshots saved to `observations/evidence/setup/` (redact account IDs if you want)
