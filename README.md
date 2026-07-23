# 📄 PaperWait

> *Because waiting to find it isn't an option.*

PaperWait is a premium, AI-powered document organizer that automates document uploads, performs optical character recognition (OCR), classifies document types, extracts key entities, and routes files into dynamically generated or existing folders. Built on Next.js, Supabase, and NVIDIA NIM APIs, it provides a fast and highly secure digital document safe.

---

## 🌟 Key Features

- ⚡ **Multi-Format Processing**: Supports PDFs, images (PNG, JPEG), Word docs (DOCX/DOC), Excel spreadsheets (XLSX), PowerPoint slides (PPTX/PPT), CSV, and TXT files.
- 🤖 **Ensembled Multi-Model AI Routing**:
  - **Llama 3.1 8B**: Evaluates fast-path document classification.
  - **Nemotron-3-Nano Reasoning**: Solves deep categorization and entities extraction.
  - **DeepSeek V4 Flash**: Creates friendly 1-sentence descriptions and summaries.
  - **Llama 3.2 11B Vision**: Describes visual-only and photo uploads.
- 📁 **Smart Folder Match & Auto-Creation**: Merges document context with user folder structures. Automatically routes transactional files (receipts, utility bills) and matches existing folders through substring and Levenshtein distance metrics.
- 🖼️ **On-Demand Visual Previews**: Automatically extracts the first page of PDFs, resizes images, and generates SVG/Canvas-based document cards for text and office files.
- 🔒 **Enterprise-Grade Security**: Strictly enforced Row Level Security (RLS) on both Postgres tables and Supabase Storage buckets ensures zero cross-tenant data leaks.

---

## 🏗️ Technical Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, TailwindCSS v4, TypeScript)
- **Database & Storage**: [Supabase](https://supabase.com/) (PostgreSQL with RLS, Supabase Storage buckets)
- **Document Text Extractors**:
  - **mammoth** (DOCX to text extraction)
  - **xlsx** (Excel data extraction)
  - **officeparser** (PowerPoint XML parsing)
- **AI Pipelines**: [NVIDIA NIM API](https://build.nvidia.com/) (Nemotron OCR v2, Llama 3.1/3.2, DeepSeek, and Nemotron reasoning models)
- **Canvas Rendering**: `@napi-rs/canvas` (High-performance Node canvas implementation for server-side preview thumbnail generation)

---

## ⚙️ Environment Configuration

To run PaperWait locally, copy `.env.local.example` to `.env.local` and configure the following variables:

```bash
# Supabase credentials (pointing to your Supabase project)
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...

# Required for background tasks where user cookies are not present
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...

# NVIDIA API credentials for OCR and LLMs
NVIDIA_API_KEY_OCR=nvapi-...
NVIDIA_API_KEY_LLM=nvapi-...

# Gotenberg document conversion service (optional, defaults to local dev server)
GOTENBERG_URL=http://localhost:3000
```

---

## 🗄️ Database & Storage Setup

All database migrations are located in the `supabase/migrations/` directory.

### 1. Database Schema
Execute the migration scripts against your Supabase Postgres database. The schema configures:
- `public.folders`: Maps folders to specific user sessions.
- `public.documents`: Stores document statuses, OCR transcripts, metadata, folder relationships, and JSON-serialized AI analysis details.

### 2. Row Level Security (RLS)
The migration enforces security boundaries using `auth.uid() = user_id`. No client can read, insert, update, or delete folders or documents unless they own them.

### 3. Supabase Storage Policies
Create a private bucket named `documents` in Supabase Storage. The storage policies enforce folder boundaries by parsing the storage path using the user's UUID:
```sql
CREATE POLICY "Allow users to read their own folder"
  ON storage.objects FOR SELECT
  USING ( bucket_id = 'documents' AND (auth.uid()::text = (storage.foldername(name))[1]) );
```
This ensures a user authenticated under UUID `X` can only read or write to paths matching `X/...` inside the bucket (e.g. `X/previews/doc-id.png` or `X/doc-id.pdf`).

---

## 🚀 Running the Application

### Installation
Install project dependencies:
```bash
npm install
```

### Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Linting & Formatting
Verify your code syntax and TypeScript definitions:
```bash
npm run lint
```

### Production Build
Compile the application:
```bash
npm run build
```
Builds are optimized for production deployments (e.g., Vercel, Docker).

---

## 📂 Project Structure

```
├── .env.local.example       # Template environment variables
├── supabase/
│   └── migrations/          # Postgres migrations (Schema + RLS + Bucket Policies)
├── src/
│   ├── app/                 # Next.js App Router (Dashboard, Login, APIs)
│   │   ├── api/             # API routes (upload, document, folders management)
│   │   └── dashboard/       # Dashboard pages, folder navigation, doc viewer
│   ├── components/          # Reusable UI widgets (VelocityLoader, ConfirmModal, etc.)
│   └── utils/
│       ├── ai.ts            # NVIDIA NIM API connectors, OCR & classification logic
│       └── supabase/        # Supabase SSR client, server, and middleware configurations
```
