# Daylight Candidate Studio

Single-page candidate application flow with autosave, offline-friendly drafts, magic-link auth, and signed resume uploads. Built with vanilla JS, HTML, and CSS; backed by an AWS CDK stack (HTTP API + Lambda + DynamoDB + S3).

## Architecture (Mermaid)
```mermaid
graph LR
  A[Browser SPA] -->|HTTPS| B[API Gateway (HTTP API)]
  B -->|Lambda proxy| C[Job Portal Lambda]
  C --> D[DynamoDB (applications + magic links)]
  C --> E[S3 Resumes Bucket (presigned uploads)]
  A -->|PUT/POST presigned| E
  F[Static Site S3] -->|public website| A
```

## Stack
- Frontend: `webapp/` (vanilla JS, no build step; served from static S3)
- Backend: `infra/` CDK stack provisioning HTTP API, Lambda, DynamoDB table, and S3 bucket with CORS for signed uploads
- Magic links: Stored in DynamoDB with 30-minute TTL; validated via `/magic-link/validate`

## Local notes
- Static preview: open `webapp/index.html` in a browser (requires internet for vendor scripts)
- Infra build: `cd infra && npm install && npm run build`
- Synth/deploy: `cd infra && npm run synth` then `cdk deploy` (requires AWS creds)
