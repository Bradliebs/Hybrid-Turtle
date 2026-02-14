## AI / Agent Rules
See AGENT.md — must be followed for architecture, server/client boundaries, Prisma usage, and conventions.

Project Identity

This is a full-stack TypeScript application built using:

Next.js 14.1.0 (App Router architecture)

React 18

Tailwind CSS 3

Prisma ORM

SQLite database

Windows batch scripts for setup and launch

The project uses strict TypeScript and follows a server/client separation model enforced by Next.js.

1️⃣ Core Architectural Rules (Non-Negotiable)
Server vs Client

Default to Server Components

Use "use client" only when:

State is required

Browser APIs are required

Event handlers are required

Never:

Call Prisma inside client components

Expose server logic to client

Mix DB logic with UI components

2️⃣ Folder Conventions

Expected structure:

/app
  /api
  /dashboard
  layout.tsx
  page.tsx

/components
/lib
/prisma
/types
/public
/styles


Rules:

API logic → /app/api/*

Reusable UI → /components

Prisma client → /lib/prisma.ts

Shared types → /types

Database schema → /prisma/schema.prisma

Do not:

Create arbitrary folders

Duplicate logic across directories

Break established structure

3️⃣ TypeScript Rules

strict mode is enabled

No any

All component props must be typed

All API responses must have explicit return types

Shared interfaces belong in /types

Use zod or validation schemas for API input if needed

4️⃣ Prisma Rules

Prisma client must be instantiated in /lib/prisma.ts

Never create multiple Prisma instances

Use async/await properly

Catch and return structured errors

Schema changes must follow:

1. Edit schema.prisma
2. Run prisma migrate dev
3. Regenerate client


Never manually edit the SQLite file.

5️⃣ Tailwind CSS Rules

Use utility-first classes

No inline styles unless absolutely necessary

Extract repeated UI patterns into components

Do not introduce additional CSS frameworks

6️⃣ API Route Standards

All API routes must:

Validate input

Return structured JSON

Handle errors safely

Never leak stack traces

Never expose environment variables

Example response structure:

{
  success: boolean;
  data?: T;
  error?: string;
}

7️⃣ Performance Guidelines

Prefer server data fetching

Avoid unnecessary useEffect

Avoid client-side fetching if server rendering is possible

Minimize hydration complexity

8️⃣ Security Guidelines

Never expose secrets

Validate all request bodies

Sanitize user content

Do not trust client-side validation

9️⃣ Windows Script Rules
install.bat

Must:

Install dependencies

Run Prisma generate

Run migrations

start.bat

Must:

Start Next.js dev server

Do not modify scripts unless explicitly instructed.

🔟 Code Modification Protocol (For AI Agents)

When modifying code:

Preserve existing architecture.

Do not refactor unrelated code.

Maintain strict typing.

Follow existing naming conventions.

Explain structural changes.

Keep code modular.

Avoid overengineering.

11️⃣ Feature Addition Protocol

When adding new features:

Determine if it is:

UI

API

Database

Full-stack

Implement minimal viable logic.

Respect server/client boundaries.

Reuse existing patterns.

Do not introduce unnecessary libraries.

12️⃣ Development Philosophy

Clarity over cleverness.

Predictable over magical.

Explicit over implicit.

Modular over monolithic.

Maintainable over complex.

13️⃣ Agent Behavior Expectations

AI agents operating in this repository must:

Understand Next.js App Router architecture.

Respect server/client separation.

Maintain Prisma best practices.

Follow strict TypeScript rules.

Preserve Tailwind styling conventions.

Avoid architectural drift.

If uncertain, ask before refactoring.