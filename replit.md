# Knockturn Time Strap

## Overview

Knockturn Time Strap is an enterprise employee time tracking and task management system built for Knockturn Private Limited. The application enables employees to log their daily work tasks, track time spent on projects, and submit timesheets for manager approval. It features role-based access control (employee, manager, HR, admin), real-time updates via WebSockets, and analytics dashboards for productivity insights.

The system follows a futuristic design aesthetic with a black and electric blue theme, featuring GSAP animations and a modern SaaS-inspired UI.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript, built using Vite
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state, React Context for auth state
- **Styling**: TailwindCSS with custom dark theme, shadcn/ui component library (New York style)
- **Animations**: GSAP for interactive animations (lamp pull welcome, card flips)
- **Charts**: Chart.js with react-chartjs-2 for analytics visualizations

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ESM modules
- **API Pattern**: RESTful JSON APIs under `/api/*` prefix
- **Real-time**: WebSocket server for live updates on time entry submissions/approvals
- **Authentication**: Session-based with bcrypt password hashing (stored in localStorage on client)

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts` contains all table definitions
- **Core Tables**:
  - `organisations` - Company/organization records
  - `employees` - User accounts with roles and department assignments
  - `timeEntries` - Task logs with approval workflow status
  - `managers` - Manager reference data

### Authentication & Authorization
- Role-based access: employee, manager, HR, admin
- Employees can only view their own time entries
- Managers/HR/Admin can view and approve pending submissions
- Password validation via bcrypt comparison
- Client stores user session in localStorage

### Project Structure
```
client/           # React frontend
  src/
    components/   # Reusable UI components
    pages/        # Route-level page components
    context/      # React context providers (Auth)
    hooks/        # Custom hooks (toast, websocket, mobile detection)
    lib/          # Utilities and query client setup
server/           # Express backend
  routes.ts       # API route definitions
  storage.ts      # Database access layer
  db.ts           # Drizzle/PostgreSQL connection
shared/           # Shared code between client/server
  schema.ts       # Drizzle table schemas and Zod validators
```

## External Dependencies

### Database
- PostgreSQL database (configured via `DATABASE_URL` environment variable)
- Drizzle ORM for type-safe database queries
- Drizzle Kit for schema migrations (`npm run db:push`)

### UI Component Libraries
- shadcn/ui components (Radix UI primitives)
- GSAP for animations
- Chart.js for data visualization
- react-day-picker for calendar components
- embla-carousel for carousel functionality

### Development Tools
- Vite for frontend bundling with HMR
- esbuild for production server bundling
- TypeScript for type safety across the stack

### Key NPM Packages
- `@tanstack/react-query` - Server state management
- `wouter` - Client-side routing
- `bcryptjs` - Password hashing
- `ws` - WebSocket server
- `date-fns` / `date-fns-tz` - Date manipulation with timezone support
- `zod` - Runtime schema validation
- `drizzle-zod` - Drizzle to Zod schema generation