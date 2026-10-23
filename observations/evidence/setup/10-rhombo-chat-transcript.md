# Rhombo chat transcript: S3 connection denial

- **When:** 2026-10-21, about 20:05 AEDT
- **Where:** project `drift1` → AI Builder panel, default Analysis mode (no slash command)
- **Credits:** 43 → 38 of 50 (this one message used 5)
- **Rhombo's status line:** "Checked product knowledge", "Worked for 34s"

The text is copied exactly from the chat panel. Emoji and formatting are kept as rendered.

---

## Prompt (sent by me)

> I'm trying to connect an Amazon S3 bucket as a source and it keeps failing. Setup: bucket "rhombus-input-data" in ap-southeast-2, Folder/path blank, one .xlsx file at the bucket root, SSE-S3 encryption. I applied your generated whole-bucket policy exactly (also tried the CloudFormation template, stack CREATE_COMPLETE). Connect S3 source still says: "AWS denied Rhombus AI access to the whole bucket. Folder / path is blank. The required whole-bucket read-only policy is missing or does not match this bucket." AWS CloudTrail shows your account 730335216038 calling GetBucketLocation through VPC endpoint vpce-0f6fe0414ca3e7b48 and getting AccessDenied (403), even though the bucket policy allows it. Questions: 1) What could cause this besides the bucket policy? 2) I'm on the Free plan. Does the S3 source connector (managed compute) require a paid plan? 3) Does the Free plan allow scheduled pipeline runs and more than one data connection (S3 source + GCS destination)?

## Response (Rhombo)

> Great detail in your report — this gives a very clear picture. Let me address all three questions:
>
> **1. Why Is GetBucketLocation Still Getting AccessDenied (403)?**
>
> Your CloudTrail shows the call coming through VPC endpoint vpce-0f6fe0414ca3e7b48 — this is almost certainly the root cause. Here's why:
>
> 🔴 VPC Endpoint Policy Is Blocking It
>
> S3 VPC endpoints (Gateway type) have their own resource policy, separate from the bucket policy. Even if your bucket policy is perfect, the VPC endpoint policy can independently deny requests. The default VPC endpoint policy allows all actions, but if yours has been customized, it may be restricting which principals or buckets can be accessed through it.
>
> What to check in AWS
> - Go to AWS Console → VPC → Endpoints → vpce-0f6fe0414ca3e7b48
> - Click the Policy tab
> - Check if it has a custom policy that restricts:
>   - Which principals can use it (Rhombus's IAM roles may not be listed)
>   - Which resources/buckets are allowed
> - If it has a custom policy, either:
>   - Add Rhombus's two IAM roles to it, or
>   - Set it back to the default full-access policy (if your org allows)
>
> 🟡 Other Possible Causes
>
> | Cause | How to Check |
> |---|---|
> | AWS Organizations SCP | Ask your AWS admin if there's an SCP blocking cross-account S3 access via VPC endpoints |
> | Bucket is in ap-southeast-2 but VPC endpoint routes differently | Confirm the endpoint is a regional S3 endpoint for ap-southeast-2 |
> | SSE-S3 encryption | SSE-S3 (AES-256) does not require any extra KMS key policy — this should be fine and is unlikely the cause |
>
> **2. Does S3 Managed Compute Require a Paid Plan?**
>
> I don't have authoritative details on plan-gating for the S3 managed compute connector in my product knowledge base, so I cannot confirm or deny this definitively. Given that you've gone through the full setup flow and received a policy/CloudFormation template, it appears the feature is accessible to you — but the 403 error is an AWS-side access denial, not a Rhombus plan restriction (which would typically show a different error message in the UI).
>
> 👉 Recommended: Reach out to Rhombus support directly to confirm plan limits — go to Settings → Help / Support in the Rhombus UI.
>
> **3. Free Plan — Scheduled Runs & Multiple Connections?**
>
> Same situation — my product knowledge base doesn't include the specific Free plan feature limits (number of connections, scheduled pipeline runs, etc.). I don't want to give you inaccurate limits.
>
> 👉 Best place to check: The Rhombus AI pricing page or Settings → Plan inside the app for your current plan's entitlements.
>
> ✅ Most Actionable Next Step
>
> Check and fix the VPC endpoint policy — that is almost certainly why your bucket policy and CloudFormation stack are correct yet still getting
>
> The CloudTrail evidence (call routed through vpce-0f6fe0414ca3e7b48) points directly there. If you can share the VPC endpoint policy, I can review it for you.

_(The sentence isn't actually cut off. The UI rendered "…still getting 403. The CloudTrail evidence…" as a numbered list item "403." See [screenshot 7](17-rhombo-chat-7.jpg).)_
