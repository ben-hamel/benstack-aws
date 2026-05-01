# Costco Receipt Tracker — Built on AWS

A full-stack web app for tracking Costco purchases deployed on AWS. Use the [Costco Receipts Downloader](https://chromewebstore.google.com/detail/costco-receipts-downloade/nnalnbomehfogoleegpfegaeoofheemn) Chrome extension to upload receipts, which get processed through an event-driven pipeline built on S3, SQS, Lambda, and RDS. The API and frontend are hosted on ECS. A planned LLM chat feature will let you query your purchase history conversationally.

## Architecture

### Receipt Upload Pipeline

Receipt uploads are handled asynchronously through an event-driven AWS pipeline. The client gets a presigned S3 URL, uploads directly to S3, and a Lambda function processes the file in the background while the UI polls for progress. All infrastructure is provisioned as code using Terraform.

```mermaid
flowchart LR
    Client(["🖥️ Client"])

    subgraph AWS["☁️ AWS Cloud"]
        CloudFront["🌐 CloudFront"]
        ALB["⚖️ ALB"]
        S3Frontend["🪣 S3 Frontend"]
        S3["🪣 S3 Receipts"]
        SQS["📨 SQS Queue"]
        subgraph VPC["🔒 Custom VPC"]
            API["📦 API Server<br/>ECS"]
            Lambda["λ Lambda<br/>receipt-processor"]
            RDS[("🐘 PostgreSQL<br/>RDS")]
            S3Endpoint(["S3 VPC Endpoint"])
        end
    end

    Client -->|"load app"| CloudFront
    CloudFront --> S3Frontend
    Client -->|"① Request upload URL"| ALB
    ALB --> API
    API -->|"Upload URL"| Client
    Client -->|"② Upload file"| S3
    Client -->|"⑤ Check progress"| ALB
    API <-->|"Track job status"| RDS
    S3 -->|"③ File uploaded trigger"| SQS
    SQS -->|"④ Start processing"| Lambda
    Lambda -->|"Download file"| S3Endpoint
    S3Endpoint -->|"private"| S3
    Lambda <-->|"Save receipts"| RDS

    classDef ecs fill:none,stroke:#FF9900,stroke-width:2px,color:#fff
    classDef s3 fill:none,stroke:#3F8624,stroke-width:2px,color:#fff
    classDef sqs fill:none,stroke:#FF4F8B,stroke-width:2px,color:#fff
    classDef lambda fill:none,stroke:#FF9900,stroke-width:2px,color:#fff
    classDef rds fill:none,stroke:#527FFF,stroke-width:2px,color:#fff
    classDef client fill:none,stroke:#aaa,stroke-width:2px,color:#fff
    classDef alb fill:none,stroke:#8C4FFF,stroke-width:2px,color:#fff
    classDef cdn fill:none,stroke:#8C4FFF,stroke-width:2px,color:#fff
    classDef endpoint fill:none,stroke:#666,stroke-dasharray:3 3,color:#aaa

    class API ecs
    class S3 s3
    class SQS sqs
    class Lambda lambda
    class RDS rds
    class Client client
    class ALB alb
    class CloudFront cdn
    class S3Frontend s3
    class S3Endpoint endpoint

    style AWS fill:none,stroke:#FF9900,stroke-width:2px,color:#fff
    style VPC fill:none,stroke:#666,stroke-width:1px,stroke-dasharray:4 4,color:#aaa
```

> **Note:** Using a custom VPC with public subnets. A production setup would add private subnets and a NAT Gateway for full network isolation.

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
- ![AWS](https://img.shields.io/badge/AWS-FF9900?style=flat-square&logo=amazonaws&logoColor=white) - ECS, Lambda, S3, SQS, RDS, CloudFront
- ![Terraform](https://img.shields.io/badge/Terraform-7B42BC?style=flat-square&logo=terraform&logoColor=white) - Infrastructure as code for all AWS resources
- ![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=flat-square&logo=githubactions&logoColor=white) - CI/CD pipelines for automated deployments

### Tooling

- ![Git](https://img.shields.io/badge/Git-F05032?style=flat-square&logo=git&logoColor=white) - Version control
- ![GitHub](https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white) - Code hosting and collaboration
- ![Turborepo](https://img.shields.io/badge/Turborepo-EF4444?style=flat-square&logo=turborepo&logoColor=white) - Optimized monorepo build system

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup instructions, available scripts, and UI customization.
