# ADR 001: Chat Agent — Custom Tools vs SQL Agent

## Status
Accepted

## Context
The chat agent in `apps/server/src/modules/chats/chats.service.ts` needs to answer natural language questions about Costco receipt and purchase data. Two main approaches were considered:

1. **SQL agent** — give the model the DB schema and let it generate raw SQL queries
2. **Custom tools** — define specific Drizzle ORM query functions and let the model call them

A third pattern, **progressive disclosure / skills**, was also considered for managing tool sprawl.

## Decision
Use custom Drizzle tools with `createAgent` from `langchain`.

## Reasons
- **Tenant isolation** — `orgId` is injected server-side via `runtime.context` in every tool. The model cannot leak data between organizations. A SQL agent would require trusting the model to always include `WHERE organization_id = $1`.
- **Predictability** — queries are parameterized and optimized; no risk of the model generating slow or destructive SQL.
- **Production safety** — the LangChain SQL agent docs explicitly state their tooling is "not intended for production use."

## Tradeoffs
Custom tools require writing a new function for every new query pattern. Known gaps that may need tools added later:
- Spending grouped by time period (month/week/year)
- Period-over-period comparison (YoY, MoM)
- Grouping by store location
- Most expensive single item

## Scaling plan
- **~15-20 tools** — add `llmToolSelectorMiddleware` (already available in the installed `langchain` version). Uses a cheap model (Haiku) to filter down to relevant tools per query before the main agent runs.
- **50+ tools** — migrate to progressive disclosure / skills pattern. Tool definitions stay the same; they move to an external store and are loaded on demand.

## References
- [LangChain SQL Agent](https://docs.langchain.com/oss/javascript/langchain/sql-agent)
- [LangGraph SQL Agent](https://docs.langchain.com/oss/javascript/langgraph/sql-agent)
- [LangChain Skills / Progressive Disclosure](https://docs.langchain.com/oss/javascript/langchain/multi-agent/skills-sql-assistant)
- [LangChain Agents](https://docs.langchain.com/oss/javascript/langchain/agents)

## Alternatives considered
- **SQL agent** — rejected due to tenant isolation risk
- **LangGraph graph-based agent** — rejected; `createAgent` is built on LangGraph and handles our use case without the added complexity of managing graph nodes and edges manually. Raw LangGraph is worth revisiting later as the app grows.
- **Progressive disclosure / skills now** — rejected; adds latency (extra LLM round-trip per skill load) with no benefit at current tool count.
