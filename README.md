# Costco Receipt Tracker — Built on AWS

A full-stack web app for tracking Costco purchases deployed on AWS. Use the [Costco Receipts Downloader](https://chromewebstore.google.com/detail/costco-receipts-downloade/nnalnbomehfogoleegpfegaeoofheemn) Chrome extension to upload receipts, which get processed through an event-driven pipeline built on S3, SQS, Lambda, and RDS. A planned LLM chat feature will let you query your purchase history conversationally.

## Architecture

The API runs as a Lambda Web Function behind CloudFront. The receipt processor runs as a Lambda Event Function and consumes SQS messages from S3 uploads. Both use [Neon](https://neon.tech) Postgres. A separate CloudFront distribution serves the web app from S3.

See the [Web Function deployment runbook](docs/web-function-cutover.md) for API releases.

```mermaid
flowchart LR
    Client(["🖥️ Client"])

    subgraph AWS["☁️ AWS Cloud"]
        CloudFront["🌐 CloudFront"]
        S3Frontend["🪣 S3 Frontend"]
        S3["🪣 S3 Receipts"]
        SQS["📨 SQS Queue"]
        APICDN["🌐 CloudFront\nAPI"]
        LambdaAPI["λ Lambda Web Function\nbenstack-api-web"]
        LambdaProcessor["λ Lambda\nreceipt-processor"]
        SSM["🔑 SSM\nParameter Store"]
    end

    Neon[("🐘 Neon\nServerless Postgres")]

    Client -->|"load app"| CloudFront
    CloudFront --> S3Frontend
    Client -->|"① Request upload URL"| APICDN
    APICDN --> LambdaAPI
    LambdaAPI -->|"Upload URL"| Client
    LambdaAPI <-->|"fetch config"| SSM
    Client -->|"② Upload file"| S3
    Client -->|"⑤ Check progress"| APICDN
    LambdaAPI <-->|"Track job status"| Neon
    S3 -->|"③ File uploaded trigger"| SQS
    SQS -->|"④ Start processing"| LambdaProcessor
    LambdaProcessor <-->|"fetch config"| SSM
    LambdaProcessor <-->|"Save receipts"| Neon

    classDef gateway fill:none,stroke:#8C4FFF,stroke-width:2px,color:#fff
    classDef lambda fill:none,stroke:#FF9900,stroke-width:2px,color:#fff
    classDef s3 fill:none,stroke:#3F8624,stroke-width:2px,color:#fff
    classDef sqs fill:none,stroke:#FF4F8B,stroke-width:2px,color:#fff
    classDef neon fill:none,stroke:#00E599,stroke-width:2px,color:#fff
    classDef ssm fill:none,stroke:#DD344C,stroke-width:2px,color:#fff
    classDef client fill:none,stroke:#aaa,stroke-width:2px,color:#fff
    classDef cdn fill:none,stroke:#8C4FFF,stroke-width:2px,color:#fff

    class APICDN cdn
    class LambdaAPI,LambdaProcessor lambda
    class S3,S3Frontend s3
    class SQS sqs
    class Neon neon
    class SSM ssm
    class Client client
    class CloudFront cdn

    style AWS fill:none,stroke:#FF9900,stroke-width:2px,color:#fff
```

### LLM Chat *(coming soon)*

A planned conversational interface for querying your purchase history using an LLM.

## Tech Stack

### Languages

- ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) - Typed superset of JavaScript used across the full stack
- ![HTML](https://img.shields.io/badge/HTML-E34F26?style=flat-square&logo=html5&logoColor=white) - Markup
- ![CSS](https://img.shields.io/badge/CSS-1572B6?style=flat-square&logo=css&logoColor=white) - Styling
- ![SQL](https://img.shields.io/badge/SQL-4169E1?style=flat-square&logo=postgresql&logoColor=white) - Database queries and schema

### Frontend

- ![React](https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black) - UI library
- ![TanStack Router](https://img.shields.io/badge/TanStack_Router-FF4154?style=flat-square&logoColor=white) - File-based routing with full type safety
- ![TailwindCSS](https://img.shields.io/badge/TailwindCSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white) - Utility-first CSS
- ![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-000000?style=flat-square&logo=shadcnui&logoColor=white) - Shared UI primitives
- ![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white) - Frontend build tool

### Backend

- ![Hono](https://img.shields.io/badge/Hono-E36002?style=flat-square&logo=hono&logoColor=white) - Lightweight, performant server framework
- ![Bun](https://img.shields.io/badge/Bun-000000?style=flat-square&logo=bun&logoColor=white) - Runtime environment
- ![Drizzle](https://img.shields.io/badge/Drizzle-C5F74F?style=flat-square&logo=drizzle&logoColor=black) - TypeScript-first ORM
- ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white) - Database
- ![Better Auth](https://img.shields.io/badge/Better--Auth-6D28D9?style=flat-square&logoColor=white) - Authentication
- ![REST API](https://img.shields.io/badge/REST_API-555555?style=flat-square&logoColor=white) - JSON API design and implementation

### Infrastructure

- ![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white) - Containerisation
- ![AWS](https://img.shields.io/badge/AWS-FF9900?style=flat-square&logo=amazonaws&logoColor=white) - Lambda Web Functions, Lambda Event Functions, S3, SQS, CloudFront
- ![Terraform](https://img.shields.io/badge/Terraform-7B42BC?style=flat-square&logo=terraform&logoColor=white) - Infrastructure as code for all AWS resources
- ![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=flat-square&logo=githubactions&logoColor=white) - CI/CD pipelines for automated deployments

### Tooling

- ![Git](https://img.shields.io/badge/Git-F05032?style=flat-square&logo=git&logoColor=white) - Version control
- ![GitHub](https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white) - Code hosting and collaboration
- ![Turborepo](https://img.shields.io/badge/Turborepo-EF4444?style=flat-square&logo=turborepo&logoColor=white) - Optimized monorepo build system

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup instructions, available scripts, and UI customization.

## Terraform state

Terraform state is stored remotely in the private, versioned S3 bucket
`benstack-terraform-state-989459974685`. S3 native state locking is enabled.
Terraform 1.10 or newer is required.

To use Terraform from a fresh clone, authenticate to AWS and initialize the
backend:

```bash
cd infra
aws login
terraform init
terraform plan
```

Create `infra/terraform.tfvars` from `infra/terraform.tfvars.example` before
planning. The variables file is intentionally excluded from Git because it
contains environment-specific values and secrets.
