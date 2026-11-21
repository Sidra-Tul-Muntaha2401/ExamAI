# ExamPilot — AI Study & Examination Platform

ExamPilot is a full-stack EdTech platform built for **students** (Study Mode) and **teachers** (Teaching Mode). Both roles can upload `.pdf` and `.docx` documents, preview extracted text, generate structured questions via the **Groq API**, and manage practice quizzes or official timed examinations backed by a local **SQLite** database.

## Technology Stack

- **Frontend:** React 19, Vite, Tailwind CSS v4, Lucide React
- **Backend:** Express (`server.ts`), TypeScript (`tsx`)
- **Database:** Local SQLite (`node:sqlite` built into Node.js 22+)
- **AI Generation:** Groq SDK (`groq-sdk`) using server-side `GROQ_API_KEY`
- **Document Processing:** `unpdf` (text-based PDF extraction) and `mammoth` (DOCX extraction)
- **Authentication:** `scrypt` password hashing, HMAC-SHA256 session tokens, `HttpOnly` cookies + `Bearer` auth, and server-side RBAC (`student` / `teacher`)

## Local Setup (VS Code on Windows / macOS / Linux)

### 1. Prerequisites
- **Node.js v22.5 or newer** (required for built-in `node:sqlite`)
- **npm** (bundled with Node.js)

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env` and add your Groq API key:
```bash
cp .env.example .env
```
Edit `.env`:
```env
GROQ_API_KEY="gsk_your_groq_api_key_here"
GROQ_MODEL="llama-3.3-70b-versatile"
DATABASE_PATH="./data/exampilot.sqlite"
APP_URL="http://localhost:3000"
```

### 4. Initialize Database & Start Application
The SQLite schema and sample demo accounts initialize automatically on first server start:
```bash
npm run dev
```
Open `http://localhost:3000` in your browser.

### 5. Run Unit Tests & Type Checking
```bash
npm test
npm run lint
npm run build
```

## Pre-Seeded Demo Accounts

You can register your own Student or Teacher account on `/register`, or sign in immediately with the seeded accounts:

- **Student Account:** `student@exampilot.edu` / `Student123!`
- **Teacher Account:** `teacher@exampilot.edu` / `Teacher123!`

## Testing Student & Teacher Workflows

1. **Student Study Mode:**
   - Sign in as `student@exampilot.edu`
   - Upload a `.pdf` or `.docx` study guide in **Upload & AI Studio**, preview extracted text, and generate questions (requires `GROQ_API_KEY` in `.env`) or add manual questions and save to **My Practice Quizzes**.
   - Attempt a practice quiz, navigate between questions, submit, and inspect auto-graded scores and explanations.
   - Start **Midterm: Relational Databases & SQL** under **Official Exams** to test the distraction-free exam room, server-synced countdown timer, auto-saved responses, and tab-visibility logging.
2. **Teacher Teaching Mode:**
   - Sign in as `teacher@exampilot.edu`
   - Upload teaching material, generate or manually add questions to the **Question Bank**.
   - Compose and publish a new official exam in **Create & Manage Exams**, configuring duration, passing marks, randomization, and tab-switch warnings.
   - Open **Submissions & Grading** to evaluate Marcus Alvarez's pending descriptive response with marks and written feedback.

## Production Deployment Note

This local MVP stores data in a local SQLite file (`./data/exampilot.sqlite`). Serverless hosts such as Vercel use ephemeral filesystems where local SQLite files do not persist across invocations. For serverless production deployment, migrate `server/db.ts` to a hosted database (e.g., PostgreSQL / Neon / Turso) and set `SESSION_SECRET` and `GROQ_API_KEY` in your hosting provider's environment settings.
