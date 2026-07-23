'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import type { User } from '@supabase/supabase-js'
import { 
  ArrowRight, 
  Zap, 
  Check, 
  X, 
  Menu, 
  Search, 
  UploadCloud, 
  FolderOpen,
  FileText,
  Folder,
  ChevronRight,
  Plus,
  ArrowLeft,
  Loader2,
  CheckCircle2
} from 'lucide-react'

// Custom inline SVG icons for Twitter, GitHub, and LinkedIn
const TwitterIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
  </svg>
)

const GithubIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </svg>
)

// Authentic document samples for the feature visualizer sandbox
const MOCK_DOCUMENTS = [
  {
    id: 'document-invoice',
    fileName: 'invoice-sample.pdf',
    folder: 'Invoices',
    fileSize: '142 KB',
    ocrSnippet: 'INVOICE NUMBER: 10485\nDATE: 06/15/2026\nAMOUNT DUE: $148.20\nDUE DATE: 07/01/2026\nITEMS: Services Rendered - $148.20',
    classificationReason: 'Classified as Invoice based on structured billing headers, pricing lines, and payment terms.'
  },
  {
    id: 'document-receipt',
    fileName: 'receipt-sample.jpg',
    folder: 'Receipts',
    fileSize: '1.2 MB',
    ocrSnippet: 'RETAIL RECEIPT\nDATE: 07/04/2026\nITEM A: $14.99\nITEM B: $8.49\nTOTAL: $23.48\nPAID: DEBIT CARD',
    classificationReason: 'Classified as Receipt based on point-of-sale layout and itemized pricing.'
  },
  {
    id: 'document-agreement',
    fileName: 'agreement-sample.pdf',
    folder: 'Contracts',
    fileSize: '4.8 MB',
    ocrSnippet: 'SERVICE AGREEMENT\nEFFECTIVE DATE: 08/01/2026\nTERM: 12 Months\nRATE: $1,800.00 / month\nDEPOSIT: $1,800.00',
    classificationReason: 'Classified as Contract based on formal service terms, monthly rates, and binding references.'
  }
]

export default function RootPage() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [selectedMockDoc, setSelectedMockDoc] = useState(MOCK_DOCUMENTS[0])

  // New Interactive demo states
  const [demoSelectedDoc, setDemoSelectedDoc] = useState<typeof MOCK_DOCUMENTS[0] | null>(null)
  const [demoStep, setDemoStep] = useState<'idle' | 'uploading' | 'ocr' | 'categorizing' | 'done'>('idle')
  const [demoProgress, setDemoProgress] = useState(0)

  const handleTriggerDemo = (doc: typeof MOCK_DOCUMENTS[0]) => {
    setDemoSelectedDoc(doc)
    setDemoStep('uploading')
    setDemoProgress(15)

    const timer1 = setTimeout(() => {
      setDemoStep('ocr')
      setDemoProgress(50)
    }, 1200)

    const timer2 = setTimeout(() => {
      setDemoStep('categorizing')
      setDemoProgress(85)
    }, 2400)

    const timer3 = setTimeout(() => {
      setDemoStep('done')
      setDemoProgress(100)
    }, 3600)

    // Store timeout refs in window if we want to prevent leaking, but simple timeouts are fine for this demo
  }
  
  // Real dashboard preview interactive state
  const [mockView, setMockView] = useState<'dashboard' | 'folder' | 'document'>('dashboard')
  const [selectedMockFolder, setSelectedMockFolder] = useState('Invoices')

  const supabase = createClient()

  useEffect(() => {
    const checkUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        setUser(user)
      } catch (e) {
        console.error('Error checking authentication status:', e)
      } finally {
        setLoading(false)
      }
    }
    checkUser()
  }, [supabase])

  // Filter documents in mockup depending on folder
  const folderMockDocs = MOCK_DOCUMENTS.filter(doc => doc.folder === selectedMockFolder)

  return (
    <div className="min-h-screen bg-white font-satoshi text-black selection:bg-black selection:text-brand-indigo overflow-x-hidden">
      
      {/* Navigation Header - Neo-Brutalist Layout using App Indigo */}
      <header className="sticky top-0 z-50 w-full h-20 bg-brand-indigo border-b-2 border-black flex items-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl w-full mx-auto flex items-center justify-between">
          
          {/* Logo - Matches Dashboard Icon Layout but styling matches header */}
          <Link href="/" className="flex items-center space-x-3 group">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-transform group-hover:-translate-y-0.5">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <span className="text-2xl font-cabinet font-extrabold tracking-tight text-black">
              PaperWait
            </span>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center space-x-8">
            <a href="#features" className="font-bold text-sm hover:underline underline-offset-4 decoration-2">
              Features
            </a>
            <a href="#how-it-works" className="font-bold text-sm hover:underline underline-offset-4 decoration-2">
              How It Works
            </a>
            <a href="#document-types" className="font-bold text-sm hover:underline underline-offset-4 decoration-2">
              Document Types
            </a>
          </nav>

          {/* Action Buttons */}
          <div className="hidden md:flex items-center space-x-4">
            {loading ? (
              <div className="w-20 h-8 bg-black/10 animate-pulse rounded-lg" />
            ) : user ? (
              <>
                <Link href="/dashboard" className="btn-brutal-secondary text-sm !py-2 !px-4">
                  Go to Dashboard
                </Link>
              </>
            ) : (
              <>
                <Link href="/login" className="font-bold text-sm hover:underline">
                  Sign In
                </Link>
                <Link href="/signup" className="btn-brutal-primary text-sm !py-2 !px-4">
                  Start Free Trial
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 border-2 border-black bg-white rounded-lg shadow-hard-sm active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </header>

      {/* Mobile Nav Dropdown */}
      {mobileMenuOpen && (
        <div className="fixed top-20 left-0 right-0 z-40 bg-brand-indigo border-b-2 border-black p-6 flex flex-col space-y-4 md:hidden shadow-hard-lg">
          <a 
            href="#features" 
            onClick={() => setMobileMenuOpen(false)}
            className="font-bold text-lg border-b border-black/10 pb-2"
          >
            Features
          </a>
          <a 
            href="#how-it-works" 
            onClick={() => setMobileMenuOpen(false)}
            className="font-bold text-lg border-b border-black/10 pb-2"
          >
            How It Works
          </a>
          <a 
            href="#document-types" 
            onClick={() => setMobileMenuOpen(false)}
            className="font-bold text-lg border-b border-black/10 pb-2"
          >
            Document Types
          </a>
          <div className="pt-2 flex flex-col space-y-3">
            {user ? (
              <Link 
                href="/dashboard" 
                onClick={() => setMobileMenuOpen(false)}
                className="btn-brutal-primary text-center"
              >
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link 
                  href="/login" 
                  onClick={() => setMobileMenuOpen(false)}
                  className="btn-brutal-secondary text-center"
                >
                  Sign In
                </Link>
                <Link 
                  href="/signup" 
                  onClick={() => setMobileMenuOpen(false)}
                  className="btn-brutal-primary text-center"
                >
                  Start Free Trial
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      {/* Hero Section - Eye-Catchy Indigo Background */}
      <section className="relative w-full bg-brand-indigo bg-dot-pattern border-b-2 border-black py-16 sm:py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Column: Heading and CTAs */}
          <div className="lg:col-span-6 flex flex-col space-y-6">
            <div>
              <span className="inline-flex items-center space-x-1 bg-white border-2 border-black px-3.5 py-1 rounded-full text-xs sm:text-sm font-bold shadow-hard-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>AI-Powered Document Categorization</span>
              </span>
            </div>
            
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-cabinet font-extrabold tracking-tighter text-black leading-none">
              PaperWait: because<br />
              paperwork <span className="text-transparent" style={{ WebkitTextStroke: '2px #000' }}>shouldn&apos;t</span> make you wait.
            </h1>

            <p className="text-lg sm:text-xl font-bold text-black/80 max-w-xl">
              Scan, auto-categorize, and instantly find any invoice, receipt, or contract — powered by OCR and AI.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 pt-2">
              {user ? (
                <Link href="/dashboard" className="btn-brutal-primary text-lg">
                  Go to Your Dashboard
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Link>
              ) : (
                <>
                  <Link href="/signup" className="btn-brutal-primary text-lg">
                    Get Started Free
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Link>
                  <Link href="/login" className="btn-brutal-secondary text-lg">
                    Sign In
                  </Link>
                </>
              )}
            </div>

            <div className="flex items-center space-x-6 pt-4 text-sm font-bold text-black/70">
              <span className="flex items-center"><Check className="w-4 h-4 mr-1 text-black stroke-[3px]" /> Simple Account Setup</span>
              <span className="flex items-center"><Check className="w-4 h-4 mr-1 text-black stroke-[3px]" /> Structured File Sorting</span>
            </div>
          </div>

          {/* Right Column: Real Interactive App Preview Mockup */}
          <div className="lg:col-span-6">
            <div className="bg-[#09090b] border-2 border-black rounded-2xl shadow-hard-xl overflow-hidden text-zinc-100 flex flex-col">
              
              {/* Browser Mockup Header */}
              <div className="bg-zinc-950 text-zinc-400 h-12 flex items-center px-4 justify-between border-b border-zinc-900">
                <div className="flex items-center space-x-2">
                  <span className="w-3.5 h-3.5 rounded-full bg-[#ff5f57]" />
                  <span className="w-3.5 h-3.5 rounded-full bg-[#febc2e]" />
                  <span className="w-3.5 h-3.5 rounded-full bg-[#28c840]" />
                </div>
                <div className="text-xs font-mono opacity-80 select-none bg-zinc-900 px-3 py-1 rounded border border-zinc-800/80 hidden sm:block">
                  {mockView === 'dashboard' && 'paperwait.app/dashboard'}
                  {mockView === 'folder' && `paperwait.app/dashboard/folder/${selectedMockFolder.toLowerCase()}`}
                  {mockView === 'document' && `paperwait.app/dashboard/document/${selectedMockDoc.id}`}
                </div>
                <div className="flex items-center space-x-1.5">
                  <button 
                    onClick={() => setMockView('dashboard')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                      mockView === 'dashboard' 
                        ? 'bg-indigo-600 text-white border-indigo-500' 
                        : 'bg-zinc-900 text-zinc-450 border-zinc-850 hover:bg-zinc-800'
                    }`}
                  >
                    App
                  </button>
                  <button 
                    onClick={() => {
                      setMockView('document')
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                      mockView === 'document' 
                        ? 'bg-indigo-600 text-white border-indigo-500' 
                        : 'bg-zinc-900 text-zinc-450 border-zinc-850 hover:bg-zinc-800'
                    }`}
                  >
                    Viewer
                  </button>
                </div>
              </div>

              {/* Real App Dashboard Showcase */}
              <div className="p-4 sm:p-5 min-h-[380px] bg-[#09090b] flex flex-col justify-between">
                
                {mockView === 'dashboard' && (
                  /* Real Dashboard Preview */
                  <div className="space-y-6 animate-fade-in text-left">
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                      <div>
                        <div className="text-sm font-extrabold text-white">Dashboard</div>
                        <div className="text-[10px] text-zinc-500">Manage folders and drop files to sort automatically.</div>
                      </div>
                      <button className="flex items-center space-x-1 px-2.5 py-1 bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-[10px] font-bold rounded-lg shadow-sm">
                        <Plus className="w-3.5 h-3.5" />
                        <span>New Folder</span>
                      </button>
                    </div>

                    {/* Folders List Row */}
                    <div>
                      <div className="text-[10px] font-bold uppercase text-zinc-500 tracking-wider mb-2">Folders</div>
                      <div className="grid grid-cols-3 gap-3">
                        {['Receipts', 'Invoices', 'Contracts'].map((folderName) => {
                          const count = folderName === 'Receipts' ? 5 : folderName === 'Invoices' ? 3 : 2
                          return (
                            <div
                              key={folderName}
                              onClick={() => {
                                setSelectedMockFolder(folderName)
                                setMockView('folder')
                              }}
                              className="group p-3 bg-zinc-900/30 border border-zinc-800/80 rounded-xl hover:border-zinc-700 hover:bg-zinc-900/60 transition-all cursor-pointer flex flex-col justify-between h-20"
                            >
                              <div className="flex justify-between items-start">
                                <div className="p-1.5 bg-zinc-950 border border-zinc-800 rounded-lg">
                                  <Folder className="w-4 h-4 text-indigo-400" />
                                </div>
                                <span className="text-[9px] bg-indigo-950/40 text-indigo-400 border border-indigo-950 px-1.5 py-0.5 rounded-full font-semibold">
                                  {count}
                                </span>
                              </div>
                              <div className="text-[11px] font-bold text-zinc-300 group-hover:text-white truncate mt-2">{folderName}</div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Upload Zone Mockup */}
                    <div className="border border-dashed border-zinc-800 bg-zinc-900/10 rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer hover:border-zinc-700 transition-all">
                      <div className="p-2 bg-zinc-950 border border-zinc-800 rounded-xl mb-1.5">
                        <UploadCloud className="w-5 h-5 text-indigo-400" />
                      </div>
                      <div className="text-[11px] font-bold text-zinc-350">Drag & Drop Files Here</div>
                      <div className="text-[9px] text-zinc-550 mt-0.5">Supports PDF, Images, Office, CSV, TXT</div>
                    </div>
                  </div>
                )}

                {mockView === 'folder' && (
                  /* Real Folder View Preview */
                  <div className="space-y-4 animate-fade-in text-left">
                    {/* Header */}
                    <div className="flex items-center space-x-3 border-b border-zinc-900 pb-3">
                      <button 
                        onClick={() => setMockView('dashboard')}
                        className="p-1.5 bg-zinc-900 border border-zinc-800 hover:text-white text-zinc-400 rounded-lg transition-colors"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </button>
                      <div>
                        <div className="text-sm font-extrabold text-white flex items-center space-x-1.5">
                          <span>{selectedMockFolder}</span>
                          <span className="text-[9px] bg-zinc-800 text-zinc-400 border border-zinc-800 px-1.5 py-0.25 rounded-full">Folder</span>
                        </div>
                        <div className="text-[10px] text-zinc-500">Documents in this folder</div>
                      </div>
                    </div>

                    {/* Folder Doc List */}
                    <div className="divide-y divide-zinc-900 bg-zinc-900/10 border border-zinc-850 rounded-xl overflow-hidden">
                      {folderMockDocs.map((doc) => (
                        <div
                          key={doc.id}
                          onClick={() => {
                            setSelectedMockDoc(doc)
                            setMockView('document')
                          }}
                          className="flex items-center justify-between p-3 hover:bg-zinc-900/30 transition-all cursor-pointer group"
                        >
                          <div className="flex items-center space-x-3 min-w-0">
                            <div className="p-2 bg-zinc-950 border border-zinc-850 rounded-xl text-zinc-400 group-hover:text-indigo-400 group-hover:border-indigo-500/10 transition-all">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[11px] font-bold text-zinc-200 truncate group-hover:text-white">{doc.fileName}</div>
                              <div className="text-[9px] text-zinc-550 mt-0.5">Size: {doc.fileSize} • Auto-classified</div>
                            </div>
                          </div>
                          <span className="text-[9px] bg-emerald-950/20 text-emerald-400 border border-emerald-900/30 px-2 py-0.5 rounded-full font-bold">
                            Ready
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {mockView === 'document' && (
                  /* Real Document Details View Preview */
                  <div className="space-y-4 animate-fade-in text-left">
                    {/* Header */}
                    <div className="flex items-center space-x-3 border-b border-zinc-900 pb-3">
                      <button 
                        onClick={() => setMockView('folder')}
                        className="p-1.5 bg-zinc-900 border border-zinc-800 hover:text-white text-zinc-400 rounded-lg transition-colors"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Document Details</div>
                        <div className="text-xs font-extrabold text-white truncate max-w-[200px]">{selectedMockDoc.fileName}</div>
                      </div>
                      <span className="text-[9px] bg-indigo-950/40 text-indigo-400 border border-indigo-955 px-2 py-0.5 rounded font-bold uppercase">
                        📁 {selectedMockDoc.folder}
                      </span>
                    </div>

                    {/* Metadata & Description */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-zinc-900/40 border border-zinc-850 p-2.5 rounded-xl text-[10px]">
                        <div className="text-zinc-500">Classification Reason</div>
                        <div className="text-zinc-300 font-bold mt-1 leading-tight">{selectedMockDoc.classificationReason}</div>
                      </div>
                      <div className="bg-zinc-900/40 border border-zinc-850 p-2.5 rounded-xl text-[10px]">
                        <div className="text-zinc-500">File Type</div>
                        <div className="text-zinc-350 font-bold mt-1 uppercase">{selectedMockDoc.fileName.split('.')[1] || 'pdf'}</div>
                      </div>
                    </div>

                    {/* OCR Pre box */}
                    <div className="space-y-1.5">
                      <div className="text-[9px] font-bold text-zinc-550">EXTRACTED OCR CONTENTS</div>
                      <pre className="bg-zinc-950 border border-zinc-900 text-zinc-200 p-2.5 rounded-xl font-mono text-[10px] h-20 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                        {selectedMockDoc.ocrSnippet}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Simulated App Footer Link */}
                <div className="border-t border-zinc-900 pt-3 flex justify-between items-center text-[10px] text-zinc-500 font-medium">
                  <div>Preview Mode</div>
                  <button 
                    onClick={() => {
                      if (mockView === 'dashboard') setMockView('folder')
                      else if (mockView === 'folder') setMockView('document')
                      else setMockView('dashboard')
                    }}
                    className="text-indigo-400 hover:underline flex items-center font-bold"
                  >
                    <span>Next screen</span>
                    <ChevronRight className="w-3 h-3 ml-0.5" />
                  </button>
                </div>

              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Social Proof Marquee */}
      <section className="bg-brand-charcoal border-b-2 border-black py-4 overflow-hidden relative">
        <div className="animate-marquee whitespace-nowrap flex items-center text-brand-indigo font-cabinet font-extrabold uppercase text-lg sm:text-xl tracking-wider select-none">
          {Array(4).fill(
            <>
              <span className="mx-8 flex items-center"><Zap className="w-5 h-5 text-indigo-500 fill-indigo-500 mr-2" /> OCR Scanning</span>
              <span className="mx-8 flex items-center"><Zap className="w-5 h-5 text-indigo-500 fill-indigo-500 mr-2" /> Smart Auto-Categorization</span>
              <span className="mx-8 flex items-center"><Zap className="w-5 h-5 text-indigo-500 fill-indigo-500 mr-2" /> Full-Text Indexing</span>
              <span className="mx-8 flex items-center"><Zap className="w-5 h-5 text-indigo-500 fill-indigo-500 mr-2" /> Secure Access</span>
            </>
          )}
        </div>
      </section>

      {/* Problem vs Solution Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl font-cabinet font-extrabold tracking-tight mb-4">
            Document Organization Made Simple
          </h2>
          <p className="text-lg font-bold text-black/70">
            Compare manual sorting with our automated scanning features.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Card A: Problem */}
          <div className="bg-[#f4f4f5] border-2 border-dashed border-gray-400 opacity-80 rounded-3xl p-8 sm:p-10 flex flex-col justify-between">
            <div>
              <span className="inline-block bg-white text-gray-500 border border-gray-300 font-bold px-3 py-1 rounded-full text-xs uppercase tracking-wide mb-6">
                Manual Chaos
              </span>
              <h3 className="text-2xl font-cabinet font-extrabold mb-6">
                Hours Wasted Sorting Files
              </h3>
              <ul className="space-y-4">
                {[
                  'Renaming files, bills, and agreements one by one.',
                  'Manually dragging files into folders or tagging them.',
                  'Unsearchable scans, camera snapshots, and low-res receipts.',
                  'Navigating deep nested folders to locate a single statement.'
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start">
                    <X className="w-5 h-5 text-indigo-500 stroke-[3px] mr-3 mt-1 flex-shrink-0" />
                    <span className="font-bold text-black/70 text-sm sm:text-base">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-8 border-t border-gray-300 pt-6">
              <p className="text-xs text-gray-500 font-mono">Result: Inefficient filing and lost billing logs.</p>
            </div>
          </div>

          {/* Card B: Solution - Blended with Indigo branding */}
          <div className="bg-brand-indigo border-2 border-black rounded-3xl p-8 sm:p-10 shadow-hard-lg flex flex-col justify-between">
            <div>
              <span className="inline-block bg-white text-black border-2 border-black font-bold px-3 py-1 rounded-full text-xs uppercase tracking-wide mb-6">
                PaperWait System
              </span>
              <h3 className="text-2xl font-cabinet font-extrabold mb-6">
                Automated Filing & Search
              </h3>
              <ul className="space-y-4">
                {[
                  'Drop PDFs or take a photo of documents using your mobile device.',
                  'System extracts textual indices from each page automatically.',
                  'Context classification places invoices, bills, and contracts into folders.',
                  'Type queries to find documents without manual catalog tags.'
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start">
                    <Check className="w-5 h-5 text-black stroke-[3px] mr-3 mt-1 flex-shrink-0" />
                    <span className="font-bold text-black text-sm sm:text-base">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-8 border-t-2 border-black pt-6">
              <p className="text-xs text-black/80 font-mono">Result: Automated indexing and rapid document retrieval.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Grid Section */}
      <section id="features" className="bg-brand-indigo border-t-2 border-b-2 border-black py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          
          <div className="max-w-2xl mb-16">
            <span className="bg-white border-2 border-black px-3.5 py-1 rounded-full text-xs uppercase font-bold tracking-wider shadow-hard-sm">
              Core Capabilities
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-cabinet font-extrabold tracking-tight mt-6 mb-4">
              Document Organization Features
            </h2>
            <p className="text-lg font-bold text-black/80">
              Engineered features to scan, classify, folder, and retrieve document collections.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            
            {/* Feature 1 */}
            <div className="bg-white border-2 border-black p-8 rounded-2xl shadow-hard-sm hover:translate-y-[-4px] hover:shadow-hard-lg transition-all group">
              <div className="w-12 h-12 bg-brand-sage border-2 border-black rounded-lg flex items-center justify-center mb-6 group-hover:bg-brand-indigo transition-colors">
                <UploadCloud className="w-6 h-6 text-black" />
              </div>
              <h3 className="text-xl font-cabinet font-extrabold mb-3">
                OCR Digitization
              </h3>
              <p className="text-sm font-bold text-black/70 leading-relaxed">
                Extract readable string patterns from high and low resolution files, scanned billing receipts, and image uploads.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-white border-2 border-black p-8 rounded-2xl shadow-hard-sm hover:translate-y-[-4px] hover:shadow-hard-lg transition-all group">
              <div className="w-12 h-12 bg-brand-sage border-2 border-black rounded-lg flex items-center justify-center mb-6 group-hover:bg-brand-indigo transition-colors">
                <FolderOpen className="w-6 h-6 text-black" />
              </div>
              <h3 className="text-xl font-cabinet font-extrabold mb-3">
                Auto-Categorization
              </h3>
              <p className="text-sm font-bold text-black/70 leading-relaxed">
                Assigns incoming invoices, expense slips, and agreement layouts to relevant user folders using layout and header parsing.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-white border-2 border-black p-8 rounded-2xl shadow-hard-sm hover:translate-y-[-4px] hover:shadow-hard-lg transition-all group">
              <div className="w-12 h-12 bg-brand-sage border-2 border-black rounded-lg flex items-center justify-center mb-6 group-hover:bg-brand-indigo transition-colors">
                <Search className="w-6 h-6 text-black" />
              </div>
              <h3 className="text-xl font-cabinet font-extrabold mb-3">
                Full-Text Search
              </h3>
              <p className="text-sm font-bold text-black/70 leading-relaxed">
                Query key metrics, statement totals, itemized rows, or terms inside files directly from a unified text indexing dashboard.
              </p>
            </div>

          </div>

        </div>
      </section>

      {/* Interactive Sandbox Ingestion Demo Section */}
      <section className="bg-white py-16 px-4 sm:px-6 lg:px-8 border-b-2 border-black">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-2xl mb-12">
            <span className="bg-brand-indigo border-2 border-black px-3.5 py-1 rounded-full text-xs uppercase font-bold tracking-wider shadow-hard-sm">
              Interactive Sandbox
            </span>
            <h2 className="text-3xl sm:text-4xl font-cabinet font-extrabold tracking-tight mt-6 mb-4">
              Try the AI Ingestion Pipeline
            </h2>
            <p className="text-lg font-bold text-black/70">
              Select one of the sample document types below to simulate the upload, OCR text extraction, and automatic folder sorting processes.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Left: Input Selection & Ingest status */}
            <div className="lg:col-span-5 bg-brand-indigo border-2 border-black p-6 sm:p-8 rounded-2xl shadow-hard-lg flex flex-col justify-between">
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-cabinet font-extrabold text-black mb-1">
                    1. Choose a File Format
                  </h3>
                  <p className="text-xs text-black/70 font-bold">
                    Select a document template to process through our pipeline.
                  </p>
                </div>

                <div className="space-y-3">
                  {MOCK_DOCUMENTS.map((doc) => (
                    <button
                      key={doc.id}
                      onClick={() => handleTriggerDemo(doc)}
                      disabled={demoStep !== 'idle' && demoStep !== 'done'}
                      className={`w-full flex items-center justify-between p-4 bg-white border-2 border-black rounded-xl text-left transition-all ${
                        demoStep !== 'idle' && demoStep !== 'done'
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none cursor-pointer'
                      } ${
                        demoSelectedDoc?.id === doc.id && 'ring-2 ring-indigo-650 ring-offset-2'
                      }`}
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className="p-2 bg-brand-sage border border-black rounded-lg text-black">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-extrabold text-black truncate">{doc.fileName}</div>
                          <div className="text-[10px] text-black/60 font-bold uppercase">{doc.folder} format • {doc.fileSize}</div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-black flex-shrink-0" />
                    </button>
                  ))}
                </div>

                {/* Processing Steps Status indicator */}
                {demoStep !== 'idle' && (
                  <div className="pt-4 border-t border-black/10 space-y-4">
                    <div className="flex items-center justify-between text-xs font-bold text-black">
                      <span>Ingestion Progress</span>
                      <span>{demoProgress}%</span>
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="w-full bg-black/10 h-3 border-2 border-black rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-black transition-all duration-300"
                        style={{ width: `${demoProgress}%` }}
                      />
                    </div>

                    {/* Step log list */}
                    <div className="space-y-2 text-xs font-bold text-left">
                      <div className="flex items-center space-x-2">
                        {demoProgress >= 15 ? (
                          demoProgress > 15 ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Loader2 className="w-4 h-4 animate-spin text-black" />
                          )
                        ) : (
                          <div className="w-4 h-4 border border-black/40 rounded-full" />
                        )}
                        <span className={demoProgress >= 15 ? 'text-black' : 'text-black/45'}>Uploading secure file payload</span>
                      </div>

                      <div className="flex items-center space-x-2">
                        {demoProgress >= 50 ? (
                          demoProgress > 50 ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Loader2 className="w-4 h-4 animate-spin text-black" />
                          )
                        ) : (
                          <div className="w-4 h-4 border border-black/40 rounded-full" />
                        )}
                        <span className={demoProgress >= 50 ? 'text-black' : 'text-black/45'}>Extracting layout texts (OCR digitization)</span>
                      </div>

                      <div className="flex items-center space-x-2">
                        {demoProgress >= 85 ? (
                          demoProgress > 85 ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Loader2 className="w-4 h-4 animate-spin text-black" />
                          )
                        ) : (
                          <div className="w-4 h-4 border border-black/40 rounded-full" />
                        )}
                        <span className={demoProgress >= 85 ? 'text-black' : 'text-black/45'}>Categorizing content tags with AI model</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Reset button */}
              {demoStep === 'done' && (
                <button
                  onClick={() => {
                    setDemoStep('idle')
                    setDemoSelectedDoc(null)
                    setDemoProgress(0)
                  }}
                  className="mt-6 w-full py-2.5 bg-black hover:bg-zinc-900 text-white font-bold rounded-xl text-xs border-2 border-black transition-all cursor-pointer"
                >
                  Reset Simulator
                </button>
              )}
            </div>

            {/* Right: AI Ingestion Output Console */}
            <div className="lg:col-span-7 bg-brand-charcoal text-white rounded-2xl border-2 border-black shadow-hard-lg overflow-hidden flex flex-col justify-between min-h-[380px]">
              {/* Console Header */}
              <div className="bg-[#0e1310] border-b border-white/5 px-6 py-4 flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <span className={`w-2 h-2 rounded-full ${demoStep === 'done' ? 'bg-emerald-500' : demoStep === 'idle' ? 'bg-zinc-650' : 'bg-amber-500 animate-pulse'}`} />
                  <span className="font-mono text-zinc-400 font-bold">PaperWait Ingestion Engine</span>
                </div>
                <span className="font-mono opacity-60">Status: {demoStep.toUpperCase()}</span>
              </div>

              {/* Console Body */}
              <div className="flex-1 p-6 flex flex-col justify-center text-left">
                {demoStep === 'idle' && (
                  <div className="text-center max-w-sm mx-auto space-y-4">
                    <UploadCloud className="w-12 h-12 text-zinc-700 mx-auto opacity-50" />
                    <h4 className="font-cabinet font-extrabold text-lg text-zinc-350">Awaiting file input...</h4>
                    <p className="text-xs text-zinc-500 font-medium leading-relaxed">
                      Select one of the three sample document buttons on the left to watch how they are parsed, scanned, and filed into the app directories.
                    </p>
                  </div>
                )}

                {demoStep === 'uploading' && (
                  <div className="text-center max-w-sm mx-auto space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin text-brand-indigo mx-auto" />
                    <h4 className="font-cabinet font-extrabold text-sm text-zinc-200 uppercase tracking-widest">Ingesting payload...</h4>
                    <p className="text-xs text-zinc-550 font-mono">
                      POST /api/upload/secure-ingress?name={demoSelectedDoc?.fileName}
                    </p>
                  </div>
                )}

                {demoStep === 'ocr' && (
                  <div className="space-y-4 font-mono text-xs text-left">
                    <div className="text-brand-indigo font-bold">{`>>> STARTING OPTICAL CHARACTER RECOGNITION (OCR)...`}</div>
                    <div className="text-zinc-500 text-[10px] leading-relaxed">
                      Scanning pixels for text blocks...<br />
                      Detected text grids. Executing layout analyzer models...
                    </div>
                    <div className="bg-white/5 border border-white/10 p-3 rounded text-[11px] font-mono animate-pulse">
                      {demoSelectedDoc?.ocrSnippet.split('\n')[0]}...
                    </div>
                  </div>
                )}

                {demoStep === 'categorizing' && (
                  <div className="space-y-4 font-mono text-xs text-left">
                    <div className="text-brand-indigo font-bold">{`>>> RECOGNIZED OCR STRINGS COMPLETE.`}</div>
                    <div className="text-zinc-500 text-[10px] leading-relaxed">
                      Extracting metadata...<br />
                      Running Neural classifier for category determination...
                    </div>
                    <div className="bg-white/5 border border-white/10 p-3 rounded text-[11px] font-bold text-amber-400">
                      Tagging targets: {demoSelectedDoc?.folder} format detected
                    </div>
                  </div>
                )}

                {demoStep === 'done' && demoSelectedDoc && (
                  <div className="space-y-4 animate-fade-in text-left">
                    {/* Header */}
                    <div className="flex items-center justify-between text-xs border-b border-white/10 pb-3">
                      <span className="text-zinc-450 font-bold font-mono">Processed Output</span>
                      <span className="bg-brand-indigo text-black font-extrabold border border-black px-2.5 py-0.5 rounded text-[10px] uppercase font-mono">
                        📁 Filed in: {demoSelectedDoc.folder}
                      </span>
                    </div>

                    {/* OCR Snippet block */}
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-bold text-zinc-500 tracking-wider uppercase font-mono">EXTRACTED OCR TEXT</div>
                      <pre className="bg-[#0e1310] border border-white/5 text-zinc-200 p-3 rounded-xl font-mono text-[10px] max-h-24 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                        {demoSelectedDoc.ocrSnippet}
                      </pre>
                    </div>

                    {/* AI Reasoning block */}
                    <div className="bg-white/5 border border-white/10 p-3 rounded-xl">
                      <div className="text-[10px] font-bold text-brand-indigo tracking-wider uppercase font-mono mb-1">AI Classification Reason</div>
                      <p className="text-[11px] text-zinc-300 leading-relaxed font-bold">
                        {demoSelectedDoc.classificationReason}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Console Footer */}
              <div className="bg-[#0e1310] border-t border-white/5 px-6 py-3 text-[10px] text-zinc-500 flex justify-between font-mono font-medium select-none">
                <span>API Node: v16.2</span>
                <span>© PaperWait OCR Daemon</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="bg-brand-charcoal text-white py-20 px-4 sm:px-6 lg:px-8 border-b-2 border-black">
        <div className="max-w-7xl mx-auto">
          
          <div className="text-center max-w-2xl mx-auto mb-16">
            <span className="bg-brand-charcoal border-2 border-white/20 text-brand-indigo px-3.5 py-1 rounded-full text-xs uppercase font-bold tracking-wider">
              Workflow Steps
            </span>
            <h2 className="text-3xl sm:text-4xl font-cabinet font-extrabold tracking-tight mt-6 mb-4 text-white">
              How PaperWait Operates
            </h2>
            <p className="text-lg font-bold text-white/70">
              Three simple operations from document ingest to retrieval.
            </p>
          </div>

          <div className="relative">
            {/* Timeline connection line */}
            <div className="absolute top-12 left-6 right-6 h-[2px] bg-brand-gray hidden md:block" />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative z-10">
              
              {/* Step 1 */}
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-brand-charcoal border-4 border-brand-sage flex items-center justify-center font-cabinet font-extrabold text-2xl shadow-[0_0_15px_rgba(183,198,194,0.4)]">
                  1
                </div>
                <h3 className="text-xl font-cabinet font-extrabold">Snap & Upload</h3>
                <p className="text-sm text-white/70 max-w-xs leading-relaxed font-bold">
                  Capture receipts with your mobile camera, import bill attachments, or drag and drop PDFs into the browser workspace.
                </p>
              </div>

              {/* Step 2 */}
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-brand-charcoal border-4 border-brand-indigo flex items-center justify-center font-cabinet font-extrabold text-2xl shadow-[0_0_15px_rgba(199,210,254,0.4)]">
                  2
                </div>
                <h3 className="text-xl font-cabinet font-extrabold">Extract & Process</h3>
                <p className="text-sm text-white/70 max-w-xs leading-relaxed font-bold">
                  Our background text recognition processes characters, indexing textual sequences and billing terms.
                </p>
              </div>

              {/* Step 3 */}
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-brand-charcoal border-4 border-white flex items-center justify-center font-cabinet font-extrabold text-2xl shadow-[0_0_15px_rgba(255,255,255,0.4)]">
                  3
                </div>
                <h3 className="text-xl font-cabinet font-extrabold">File & Query</h3>
                <p className="text-sm text-white/70 max-w-xs leading-relaxed font-bold">
                  Document tags and classifications auto-assign files to designated directories, ready for immediate keyword queries.
                </p>
              </div>

            </div>
          </div>

        </div>
      </section>

      {/* Document Types Bento Grid Section */}
      <section id="document-types" className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="bg-brand-indigo border-2 border-black px-3.5 py-1 rounded-full text-xs uppercase font-bold tracking-wider shadow-hard-sm">
            Compatibility
          </span>
          <h2 className="text-3xl sm:text-4xl font-cabinet font-extrabold tracking-tight mt-6 mb-4">
            Supported Document Categories
          </h2>
          <p className="text-lg font-bold text-black/70">
            Filing parameters tailored to common accounting and legal templates.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Card 1: Receipts */}
          <div className="bg-brand-sage border-2 border-black rounded-3xl p-8 flex flex-col justify-between hover:translate-y-[-4px] transition-all">
            <div>
              <div className="mb-6">
                <span className="inline-block bg-white text-black border-2 border-black font-extrabold text-[11px] tracking-wider uppercase px-3 py-1 rounded-full shadow-hard-sm">
                  Receipts & Expenses
                </span>
              </div>
              <h3 className="text-2xl font-cabinet font-extrabold text-black mb-4">
                Expense Record-Keeping
              </h3>
              <p className="text-sm font-bold text-black/80 leading-relaxed mb-6">
                Store retail statements, transaction slips, and office supplies. The indexer registers amounts and dates for tracking records.
              </p>
            </div>
            <div className="border-t border-black/10 pt-4 text-xs font-bold text-black/70 font-mono">
              Accepts: PDF, PNG, JPG, DOCX, PPTX, CSV, TXT
            </div>
          </div>

          {/* Card 2: Invoices (Vibrant App Indigo Card) */}
          <div className="bg-brand-indigo border-2 border-black rounded-3xl p-8 flex flex-col justify-between shadow-hard-lg hover:translate-y-[-4px] transition-all">
            <div>
              <div className="mb-6">
                <span className="inline-block bg-white text-black border-2 border-black font-extrabold text-[11px] tracking-wider uppercase px-3 py-1 rounded-full shadow-hard-sm">
                  Invoices & Statements
                </span>
              </div>
              <h3 className="text-2xl font-cabinet font-extrabold text-black mb-4">
                Billing Statements
              </h3>
              <p className="text-sm font-bold text-black/80 leading-relaxed mb-6">
                File utility accounts, client invoices, and recurring fees. Key indices capture reference markers and transaction dates.
              </p>
            </div>
            <div className="border-t border-black/20 pt-4 text-xs font-bold text-black/70 font-mono">
              Accepts: PDF, PNG, JPG, XLSX, PPTX, CSV
            </div>
          </div>

          {/* Card 3: Contracts */}
          <div className="bg-brand-charcoal border-2 border-black rounded-3xl p-8 flex flex-col justify-between text-white hover:translate-y-[-4px] transition-all">
            <div>
              <div className="mb-6">
                <span className="inline-block bg-white text-black border-2 border-black font-extrabold text-[11px] tracking-wider uppercase px-3 py-1 rounded-full shadow-hard-sm">
                  Legal Documents
                </span>
              </div>
              <h3 className="text-2xl font-cabinet font-extrabold text-white mb-4">
                Contracts & Agreements
              </h3>
              <p className="text-sm font-bold text-white/80 leading-relaxed mb-6">
                Organize service contracts, leases, and agreements. Full-text indexing lets you find terms or clauses inside text scans.
              </p>
            </div>
            <div className="border-t border-white/10 pt-4 text-xs font-bold text-white/70 font-mono">
              Accepts: PDF, DOCX, PPTX, TXT
            </div>
          </div>

        </div>
      </section>

      {/* Final CTA Section */}
      <section className="bg-brand-indigo py-20 px-4 sm:px-6 lg:px-8 border-b-2 border-black text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-dot-pattern opacity-10 pointer-events-none" />
        <div className="max-w-4xl mx-auto relative z-10 space-y-6">
          <h2 className="text-4xl sm:text-5xl font-cabinet font-extrabold tracking-tight text-black leading-tight">
            Because waiting to find it<br />isn&apos;t an option.
          </h2>
          <p className="text-lg font-bold text-black/80 max-w-xl mx-auto">
            Digitize, organize, and query your archives without manually sorting files into nested folders.
          </p>
          <div className="pt-4">
            {user ? (
              <Link href="/dashboard" className="btn-brutal-primary text-lg !px-8">
                Enter Your Dashboard
                <ArrowRight className="w-5 h-5 ml-2" />
              </Link>
            ) : (
              <Link href="/signup" className="btn-brutal-primary text-lg !px-8">
                Start Free Trial
                <ArrowRight className="w-5 h-5 ml-2" />
              </Link>
            )}
          </div>
          <div className="text-xs font-bold text-black/60 pt-2">
            Instant Setup • Free Tier Available
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-brand-charcoal text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-12 border-b border-white/10 pb-12 mb-12">
          
          {/* Column 1: Brand info */}
          <div className="md:col-span-6 space-y-4">
            {/* Logo - Matches Dashboard Icon Layout */}
            <Link href="/" className="flex items-center space-x-2.5 group w-max">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 shadow-md shadow-indigo-500/20">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight text-white font-cabinet">
                PaperWait
              </span>
            </Link>
            <p className="text-sm text-white/60 font-bold max-w-sm">
              Scan, organize, and retrieve your documents instantly. Because waiting to find it isn&apos;t an option.
            </p>
          </div>

          {/* Column 2: Navigation Links */}
          <div className="md:col-span-3 space-y-3">
            <div className="font-cabinet font-extrabold text-sm uppercase text-brand-sage tracking-wider">Product</div>
            <ul className="space-y-2 text-sm text-white/70 font-bold">
              <li><a href="#features" className="hover:text-brand-indigo transition-colors">Features</a></li>
              <li><a href="#how-it-works" className="hover:text-brand-indigo transition-colors">How It Works</a></li>
              <li><Link href="/login" className="hover:text-brand-indigo transition-colors">Sign In</Link></li>
            </ul>
          </div>

          {/* Column 3: Use Cases Links */}
          <div className="md:col-span-3 space-y-3">
            <div className="font-cabinet font-extrabold text-sm uppercase text-brand-sage tracking-wider">Categories</div>
            <ul className="space-y-2 text-sm text-white/70 font-bold">
              <li><a href="#document-types" className="hover:text-brand-indigo transition-colors">Expenses & Receipts</a></li>
              <li><a href="#document-types" className="hover:text-brand-indigo transition-colors">Invoices & Statements</a></li>
              <li><a href="#document-types" className="hover:text-brand-indigo transition-colors">Contracts & Agreements</a></li>
            </ul>
          </div>

        </div>

        {/* Footer bottom bar */}
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <span className="text-xs text-white/50 font-bold">
            © {new Date().getFullYear()} PaperWait. All rights reserved.
          </span>
        </div>
      </footer>

    </div>
  )
}
