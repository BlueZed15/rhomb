# 02. GCP: GCS destination bucket

> **What I actually did** (this guide is the plan; here's where reality differed):
> - Names: project `rhombus-1`, bucket `rhom-1`, writer service account `rhombus-output-data`.
> - Rhombus's first connection test returned a **403**. It worked after I widened the writer's permissions on the bucket. I didn't record the exact change, so the minimal custom role in Step 2 is **unconfirmed**.
> - **I didn't create the read-only account (Step 4).** Outputs were downloaded by hand from the console instead, and each one is recorded in [`runs.csv`](../../data-validation/runs.csv).

The goal is a GCS bucket that Rhombus can **write** to using a dedicated service account with a minimal custom role, plus a separate **read-only** service account for the validation script. See [D3](../decisions.md#d3-a-separate-minimal-identity-for-each-job).

All steps use the Google Cloud Console. Nothing here needs `gcloud`.

## Values used (fill these in; they aren't secret)

| Item | Value |
|---|---|
| Project ID | e.g. `rhombus-qa-<suffix>` |
| Bucket | e.g. `rhombus-qa-out-<suffix>` |
| Location | e.g. `australia-southeast1` (single region) |
| Writer service account | `rhombus-writer@<project>.iam.gserviceaccount.com` |
| Reader service account | `qa-reader@<project>.iam.gserviceaccount.com` |
| Custom role | `rhombusGcsWriter` |

---

## Step 0. Project and cost guardrail
1. **Create a new project** `rhombus-qa-<suffix>` and link billing (the free trial is fine).
2. **Billing → Budgets & alerts → Create budget** → $5, alerts at 50/90/100%.

> I used a new project so IAM grants, keys and costs stay separate from everything else you have. You can delete the whole project when you're done, and that revokes everything in one step.

## Step 1. Create the bucket
**Cloud Storage → Buckets → Create**

| Setting | Value | Why |
|---|---|---|
| Name | `rhombus-qa-out-<suffix>` | Globally unique |
| Location type | Region, close to the S3 region | Lower latency. Region doesn't affect what's being tested. |
| Storage class | Standard | Objects are read immediately by the validator |
| **Public access prevention** | **On** | Output may contain test PII-like data |
| Access control | **Uniform** | Lets IAM be granted at the bucket level, which is required for the bucket-scoped grants below |
| Object versioning | Off | Rhombus writes a **new timestamped file per run** at the bucket root (per its docs), so nothing is overwritten |

## Step 2. Custom role for the writer
**IAM & Admin → Roles → Create role**
- Title: `Rhombus GCS writer`, ID: `rhombusGcsWriter`, stage: GA
- Permissions: `storage.objects.create`, `storage.objects.delete`

> I made a custom role with just these two permissions because Rhombus's docs list `objects.create` as required and `objects.delete` as recommended, since its connection test writes a temporary object and deletes it. The predefined `Storage Admin` role would also work, but it can delete the bucket and read everything in it.
>
> Watch for this. If the connection test or a run fails with only these permissions, record the exact error before adding anything. A documented minimum that doesn't work is a valid finding.

## Step 3. Writer service account (used by Rhombus)
1. **IAM & Admin → Service Accounts → Create** → `rhombus-writer`. **Skip** the "grant access to project" step. The access is granted on the bucket in the next step, not on the project.
2. **Cloud Storage → bucket → Permissions → Grant access** → principal `rhombus-writer@…` → role **Custom → Rhombus GCS writer**.
3. **Service account → Keys → Add key → JSON**. The file downloads.
4. Move it **outside the repo**, e.g. `C:\Users\<you>\.secrets\rhombus-writer.json`. You'll paste its full contents into Rhombus in [03 → Step 4](03-rhombus-pipeline.md#step-4-gcs-destination).

> The grant is on the bucket, not the project, because a project-level grant would let this key write to every bucket in the project.
>
> If key creation is blocked, your organization enforces `iam.disableServiceAccountKeyCreation`. Personal accounts with no organization aren't affected. Rhombus's connector needs a JSON key, so note it in the friction log if this happens.

## Step 4. Reader service account (used by `data-validation/`)
1. Create service account `qa-reader` (again with no project grant).
2. Bucket → Permissions → Grant access → `qa-reader@…` → role **Storage Object Viewer**.
3. Create a JSON key and save it outside the repo. Set `GOOGLE_APPLICATION_CREDENTIALS` in `.env` to its path.

> The reader is separate because the validator should never be able to write to or delete pipeline output. If it could, "the output was wrong" could also mean "my script changed it."

## Verify
- [ ] Bucket has **Public access prevention: Enforced** and **Uniform** access
- [ ] Bucket permissions list exactly `rhombus-writer` (custom role) and `qa-reader` (Object Viewer), plus the default owners
- [ ] Neither service account has any **project-level** role (check IAM & Admin → IAM)
- [ ] Both key files are outside the repo, and `git status` is clean
- [ ] Screenshots saved to `observations/evidence/setup/`
