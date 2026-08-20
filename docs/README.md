# Documentation

| Doc                                            | Read it when                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **[getting-started.md](./getting-started.md)** | You just cloned this. First 15 minutes, plus what to change before it is _your_ project. |
| **[adding-a-module.md](./adding-a-module.md)** | You need a new CRUD resource. A complete worked example — every file, full contents.     |
| **[common-tasks.md](./common-tasks.md)**       | "How do I add a filter / a permission / an env var / a background action?" Recipes.      |
| **[decision-guides.md](./decision-guides.md)** | You are not sure which tool the template intends for a problem. Lookup tables.           |
| **[architecture.md](./architecture.md)**       | You want to know _why_ it is built this way. Walkthroughs and tradeoffs.                 |
| **[testing.md](./testing.md)**                 | You are writing tests and want the existing patterns.                                    |
| **[troubleshooting.md](./troubleshooting.md)** | Something broke and the error is unhelpful.                                              |

Start with **getting-started**, then **adding-a-module**. Everything else is reference.

---

## The one-paragraph version

Requests flow `middleware → route → validate → authenticate → authorize → controller → service → repository → Prisma`. Controllers only speak HTTP, services hold business rules and know nothing about Express, repositories only read and write. Everything is wired by hand in `src/routes/index.ts`. You throw errors and one global handler formats them. You validate with Zod and the same schemas generate the OpenAPI docs. To add a feature, copy `src/modules/user/`.
