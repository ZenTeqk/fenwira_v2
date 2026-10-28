# AI Assistant: production deployment

Account `569476542351`, region `ap-south-1`. Background: [AI_ASSISTANT.md](AI_ASSISTANT.md), [ADR-0028](adr/0028-ai-assistant-bedrock.md). Do the steps in order.

## 1. IAM policy for the EC2 instance role

The `apac.amazon.nova-lite-v1:0` profile can route to any of the six APAC regions listed below, so each of them needs the foundation-model ARN. Titan embeddings are called in-region.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "FenwiraAiInferenceProfile",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": "arn:aws:bedrock:ap-south-1:569476542351:inference-profile/apac.amazon.nova-lite-v1:0"
    },
    {
      "Sid": "FenwiraAiProfileRoutes",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": [
        "arn:aws:bedrock:ap-south-1::foundation-model/amazon.nova-lite-v1:0",
        "arn:aws:bedrock:ap-southeast-1::foundation-model/amazon.nova-lite-v1:0",
        "arn:aws:bedrock:ap-southeast-2::foundation-model/amazon.nova-lite-v1:0",
        "arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.nova-lite-v1:0",
        "arn:aws:bedrock:ap-northeast-2::foundation-model/amazon.nova-lite-v1:0",
        "arn:aws:bedrock:ap-northeast-3::foundation-model/amazon.nova-lite-v1:0"
      ],
      "Condition": {
        "StringLike": {
          "bedrock:InferenceProfileArn": "arn:aws:bedrock:ap-south-1:569476542351:inference-profile/apac.amazon.nova-lite-v1:0"
        }
      }
    },
    {
      "Sid": "FenwiraAiEmbeddings",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel"],
      "Resource": "arn:aws:bedrock:ap-south-1::foundation-model/amazon.titan-embed-text-v2:0"
    }
  ]
}
```

The Converse API is authorized by `bedrock:InvokeModel`. No other Bedrock actions are needed.

## 2. Environment variables

Add these to both `/etc/fenwira/api.env` and `/etc/fenwira/worker.env`. If those files are rendered from SSM, add the values there instead.

```sh
AI_PROVIDER=bedrock
AI_BEDROCK_REGION=ap-south-1
AI_TEXT_MODEL_ID=apac.amazon.nova-lite-v1:0
AI_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v2:0
AI_EMBEDDING_DIMENSION=1024
AI_MAX_OUTPUT_TOKENS=400
AI_RETRIEVAL_TOP_K=5
AI_MIN_SIMILARITY=0.2
AI_RETRIEVAL_CHAR_BUDGET=6000
AI_HISTORY_MESSAGES=6
AI_MAX_UPLOAD_BYTES=10485760
AI_MAX_SOURCES_PER_WORKSPACE=50
AI_MAX_CHUNKS_PER_SOURCE=500
AI_MAX_CHUNKS_PER_WORKSPACE=5000
AI_REPLY_LOG_RETENTION_DAYS=30
AI_PLAYGROUND_COUNTS_QUOTA=true
AI_PLAYGROUND_PER_MINUTE=10
```

There are no new secrets. Credentials come from the instance role.

## 3. SQL to run once, as the RDS master user, before deploying

```sql
-- connect to the application database (the one in DATABASE_URL), not "postgres"
CREATE EXTENSION IF NOT EXISTS vector;
SELECT extversion FROM pg_extension WHERE extname = 'vector';  -- expect 0.8.x
```

## 4. Services to restart after the deploy (the migration runs first)

```sh
sudo systemctl restart fenwira-api fenwira-worker fenwira-web
sudo systemctl status fenwira-api fenwira-worker fenwira-web --no-pager
```

## 5. Smoke test

1. `journalctl -u fenwira-api -u fenwira-worker --since -5min` shows no env or startup errors, and `/health/ready` is OK on both.
2. In `/platform`, open an internal workspace, enable AI Assistant, set a quota (for example 50) and give a reason.
3. On `/ai-assistant`, go to Knowledge and upload a small text PDF. It turns Ready within a minute, so the worker is running.
4. On the Test tab, a question covered by the PDF gets an answer with sources, and an unrelated question shows "No answer found in your documents".
5. Turn on AI Assistant, then message the connected test number from a phone. The reply arrives labelled "AI" in the inbox.
6. `journalctl -u fenwira-worker | grep "ai model call"` shows token counts and no `AccessDeniedException`.
