# Setup: S3 source won't connect, even with the correct policy

> New to the terms here (`code_sha`, LLM node, Table 1 (3).csv…)? See the [glossary](README.md#terms-used-in-the-write-ups).

| | |
|---|---|
| Date | 2026-10-21 (AEDT) |
| Status | **Blocked on Rhombus's side.** Worked around in [D9](../docs/decisions.md#d9-s3-through-a-presigned-url-instead-of-the-s3-connector) |
| Severity | **High.** It blocks setup, and the error points at the wrong cause ([rubric](../README.md#severity-rubric)) |

## What I did
I created bucket `rhombus-input-data` in Sydney (`ap-southeast-2`) with SSE-S3 and one `.xlsx` at the root. In Rhombus I went to **Data Input → Third Party Sources → Amazon S3**, entered the bucket and region, left the folder blank, and added the policy Rhombus generated to the bucket ([saved copy](../infra/aws/rhombus-source-bucket-policy.json)). I expected it to connect.

## What happened
It failed every time:

```text
AWS denied Rhombus AI access to the whole bucket. Folder / path is blank. The required
whole-bucket read-only policy is missing or does not match this bucket. ...
```
[screenshot](evidence/setup/01-rhombus-s3-connect-error.jpg)

The policy wasn't missing. It matched Rhombus's own exactly ([screenshot](evidence/setup/02-s3-bucket-policy.jpg)), and the region, bucket name, file type and encryption were all fine.

**AWS's logs show the real story.** CloudTrail has Rhombus's account (`730335216038`) calling `GetBucketLocation` on the right bucket and getting **AccessDenied**, through **a VPC endpoint owned by Rhombus** (`vpce-0f6fe0414ca3e7b48`). [Record](evidence/setup/s3-connect-accessdenied-cloudtrail.json) · screenshots [1](evidence/setup/03-cloudtrail-accessdenied-summary.jpg) [2](evidence/setup/04-cloudtrail-record-caller-and-error.jpg) [3](evidence/setup/05-cloudtrail-record-vpc-endpoint.jpg)

**Their CloudFormation template didn't help either.** My first try rolled back because I'd left the role ARNs empty (my mistake, though the template could catch that up front) ([1](evidence/setup/06-cfn-stack1-create-failed.jpg), [2](evidence/setup/07-cfn-stack1-empty-principal-params.jpg)). The second try completed, and the connection still failed with the same error ([1](evidence/setup/08-cfn-stack2-create-complete.jpg), [2](evidence/setup/09-rhombus-connect-error-after-cfn.jpg)). So it's not a copy-paste problem on my end.

**I followed their troubleshooting to the letter.** Their docs have an entry for this exact error ([screenshot](evidence/setup/18-docs-troubleshooting-whole-bucket.jpg)), and everything it lists checked out: whole-bucket policy applied, folder blank ([form](evidence/setup/20-rhombus-form-folder-blank.jpg)), region matching ([form](evidence/setup/19-rhombus-form-bucket-region.jpg)), and no KMS. A retry at 20:19 still failed ([screenshot](evidence/setup/21-rhombus-error-2019-retry.jpg)), and CloudTrail showed the same denial through the same endpoint ([screenshot](evidence/setup/22-cloudtrail-2019-retry-accessdenied.jpg)).

The docs don't mention VPC endpoints at all. The pricing page says the Free plan (which I'm on) has 1 data connection and no scheduled runs or "big data processing".

## What Rhombo (the chatbot) said
[Transcript](evidence/setup/10-rhombo-chat-transcript.md) · [screenshots 11–17](evidence/setup/)

| I asked | It said | My take |
|---|---|---|
| What else could cause this? | The VPC endpoint policy. Fix it in *AWS Console → VPC → Endpoints*. | Right idea, wrong owner. That endpoint is Rhombus's, so I can't touch it. |
| Does S3 need a paid plan? | Doesn't know, then says it's "not a plan restriction". | Contradicts itself. |
| Free plan limits? | Doesn't know. Check the pricing page. | Fair. |

The fix wasn't something I could apply. There's also a small rendering bug: "…still getting 403." showed up as a numbered list item "403." ([screenshot](evidence/setup/17-rhombo-chat-7.jpg)).

## What I think is going on
My guess is that something on Rhombus's side blocks the call, most likely their endpoint policy, possibly because S3 needs managed compute (the "big data processing" feature), which the Free plan doesn't have. Either way, the error message sent me to fix a policy that was already correct. Something like "denied on our side, contact support" or "this needs plan X" would have saved a couple of hours.

## Reproduce
1. Create a bucket in `ap-southeast-2` with one CSV or XLSX file at the root.
2. In Rhombus: Data Input → Third Party Sources → Amazon S3. Enter the bucket and region, leave the folder blank.
3. Apply the generated policy and click **Connect S3 source**.
4. AWS: CloudTrail → Event history → find `GetBucketLocation` with no user name.

## Side notes
- The Data Input node samples the first 100k rows by default. I'll keep that in mind for the row counts.
- I turned Block Public Access off while debugging. It wasn't the cause, so it should go back on.
