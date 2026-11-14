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
  CheckCircle2, 
  Sparkles, 
  Bot, 
  ShieldCheck, 
  FileSearch,
  MessageSquare
} from 'lucide-react'

// Authentic document samples for the feature visualizer sandbox
const MOCK_DOCUMENTS = [
  {
    id: 'document-invoice',
    fileName: 'invoice-sample.pdf',
    folder: 'Invoices',
    fileSize: '142 KB',
    ocrSnippet: 'INVOICE NUMBER: 10485\nDATE: 06/15/2026\nAMOUNT DUE: $148.20\nDUE DATE: 07/01/2026\nITEMS: Services Rendered - $148.20',
    classificationReason: 'Classified as Invoice based on structured billing headers, pricing lines, and payment terms.',
    vectorStatus: 'Indexed & Searchable',
    sampleQuery: 'invoice amount due and payment terms',
    chatQA: {
      question: 'When is invoice #10485 due and what is the balance?',
      answer: 'Invoice #10485 has an amount due of **$148.20** with a payment deadline of **07/01/2026** for Services Rendered.',
      sourcePage: 'Page 1'
    }
  },
  {
    id: 'document-receipt',
    fileName: 'receipt-sample.jpg',
    folder: 'Receipts',
    fileSize: '1.2 MB',
    ocrSnippet: 'RETAIL RECEIPT\nDATE: 07/04/2026\nITEM A: $14.99\nITEM B: $8.49\nTOTAL: $23.48\nPAID: DEBIT CARD',
    classificationReason: 'Classified as Receipt based on point-of-sale layout and itemized pricing.',
    vectorStatus: 'Indexed & Searchable',
    sampleQuery: 'retail receipt paid with debit card',
    chatQA: {
      question: 'What items were purchased on the retail receipt and how was it paid?',
      answer: 'The retail receipt from 07/04/2026 totals **$23.48** paid via **Debit Card**:\n• **Item A**: $14.99\n• **Item B**: $8.49',
      sourcePage: 'Page 1'
    }
  },
  {
    id: 'document-agreement',
    fileName: 'agreement-sample.pdf',
    folder: 'Contracts',
    fileSize: '4.8 MB',
    ocrSnippet: 'SERVICE AGREEMENT\nEFFECTIVE DATE: 08/01/2026\nTERM: 12 Months\nRATE: $1,800.00 / month\nDEPOSIT: $1,800.00',
    classificationReason: 'Classified as Contract based on formal service terms, monthly rates, and binding references.',
    vectorStatus: 'Indexed & Searchable',
    sampleQuery: 'monthly service fee and deposit terms',
    chatQA: {
      question: 'What is the monthly rate and security deposit for the service agreement?',
      answer: 'According to the Service Agreement (effective 08/01/2026), the rate is **$1,800.00 / month** on a 12-month term, with an initial deposit of **$1,800.00**.',
      sourcePage: 'Page 1'
    }
  }
]

// Mock Semantic Search Queries & Results matching the exact app UI
const MOCK_SEMANTIC_QUERIES = [
  {
    query: 'monthly recurring service fee',
    topDoc: 'agreement-sample.pdf',
    folder: 'Contracts',
    similarity: 97,
    snippet: 'SERVICE AGREEMENT ... RATE: $1,800.00 / month ... DEPOSIT: $1,800.00 ... TERM: 12 Months',
    matchedTerms: ['service', 'rate', 'month', 'fee']
  },
  {
    query: 'retail receipt paid with debit card',
    topDoc: 'receipt-sample.jpg',
    folder: 'Receipts',
    similarity: 95,
    snippet: 'RETAIL RECEIPT ... ITEM A: $14.99 ... ITEM B: $8.49 ... TOTAL: $23.48 ... PAID: DEBIT CARD',
    matchedTerms: ['retail', 'receipt', 'paid', 'debit', 'card']
  },
  {
    query: 'invoice due date and balance',
    topDoc: 'invoice-sample.pdf',
    folder: 'Invoices',
    similarity: 94,
    snippet: 'INVOICE NUMBER: 10485 ... AMOUNT DUE: $148.20 ... DUE DATE: 07/01/2026 ... Services Rendered',
    matchedTerms: ['invoice', 'due', 'date', 'amount']
  }
]

export default function RootPage() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [selectedMockDoc, setSelectedMockDoc] = useState(MOCK_DOCUMENTS[0])

  // Interactive app preview tabs: exactly matches the real app views
  const [mockView, setMockView] = useState<'dashboard' | 'search' | 'chat' | 'folder' | 'document'>('dashboard')
  const [selectedMockFolder, setSelectedMockFolder] = useState('Invoices')
  const [selectedSearchQueryIdx, setSelectedSearchQueryIdx] = useState(0)

  // Interactive Chat state in hero mockup
  const [activeChatQA, setActiveChatQA] = useState(MOCK_DOCUMENTS[2].chatQA)
  const [activeChatDoc, setActiveChatDoc] = useState(MOCK_DOCUMENTS[2].fileName)
  const [isTypingChat, setIsTypingChat] = useState(false)

  // Interactive Ingestion Sandbox states
  const [demoSelectedDoc, setDemoSelectedDoc] = useState<typeof MOCK_DOCUMENTS[0] | null>(null)
  const [demoStep, setDemoStep] = useState<'idle' | 'uploading' | 'ocr' | 'categorizing' | 'embedding' | 'done'>('idle')
  const [demoProgress, setDemoProgress] = useState(0)

  const handleTriggerDemo = (doc: typeof MOCK_DOCUMENTS[0]) => {
    setDemoSelectedDoc(doc)
    setDemoStep('uploading')
    setDemoProgress(20)

    setTimeout(() => {
      setDemoStep('ocr')
      setDemoProgress(50)
    }, 900)

    setTimeout(() => {
      setDemoStep('categorizing')
      setDemoProgress(75)
    }, 1800)

    setTimeout(() => {
      setDemoStep('embedding')
      setDemoProgress(90)
    }, 2700)

    setTimeout(() => {
      setDemoStep('done')
      setDemoProgress(100)
    }, 3600)
  }

  const handleSelectMockChat = (doc: typeof MOCK_DOCUMENTS[0]) => {
    setIsTypingChat(true)
    setActiveChatDoc(doc.fileName)
    setTimeout(() => {
      setActiveChatQA(doc.chatQA)
      setIsTypingChat(false)
    }, 350)
  }

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

  const folderMockDocs = MOCK_DOCUMENTS.filter(doc => doc.folder === selectedMockFolder)
  const activeSemanticQuery = MOCK_SEMANTIC_QUERIES[selectedSearchQueryIdx]

  return (
    <div className="min-h-screen bg-white font-satoshi text-black selection:bg-black selection:text-brand-indigo overflow-x-hidden">
      
      {/* 1. Navigation Header - Neo-Brutalist Layout using App Indigo */}
      <header className="sticky top-0 z-50 w-full h-20 bg-brand-indigo border-b-2 border-black flex items-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl w-full mx-auto flex items-center justify-between">
          
          {/* Logo */}
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
            <a href="#semantic-search" className="font-bold text-sm hover:underline underline-offset-4 decoration-2 flex items-center space-x-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-700" />
              <span>Semantic Search</span>
            </a>
            <a href="#rag-chatbot" className="font-bold text-sm hover:underline underline-offset-4 decoration-2 flex items-center space-x-1.5">
              <Bot className="w-3.5 h-3.5 text-indigo-700" />
              <span>AI Assistant</span>
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
              <Link href="/dashboard" className="btn-brutal-secondary text-sm !py-2 !px-4">
                Go to Dashboard
              </Link>
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
            href="#semantic-search" 
            onClick={() => setMobileMenuOpen(false)}
            className="font-bold text-lg border-b border-black/10 pb-2 flex items-center space-x-2"
          >
            <Sparkles className="w-4 h-4 text-indigo-700" />
            <span>Semantic Search</span>
          </a>
          <a 
            href="#rag-chatbot" 
            onClick={() => setMobileMenuOpen(false)}
            className="font-bold text-lg border-b border-black/10 pb-2 flex items-center space-x-2"
          >
            <Bot className="w-4 h-4 text-indigo-700" />
            <span>AI Assistant</span>
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

      {/* 2. Hero Section */}
      <section className="relative w-full bg-brand-indigo bg-dot-pattern border-b-2 border-black py-16 sm:py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Column: Heading and CTAs */}
          <div className="lg:col-span-6 flex flex-col space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center space-x-1.5 bg-white border-2 border-black px-3.5 py-1 rounded-full text-xs sm:text-sm font-bold shadow-hard-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Autonomous Document Safe</span>
              </span>
              <span className="inline-flex items-center space-x-1 bg-white border-2 border-black px-3 py-1 rounded-full text-xs sm:text-sm font-bold shadow-hard-sm text-indigo-900">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                <span>Semantic Search</span>
              </span>
              <span className="inline-flex items-center space-x-1 bg-white border-2 border-black px-3 py-1 rounded-full text-xs sm:text-sm font-bold shadow-hard-sm text-indigo-900">
                <Bot className="w-3.5 h-3.5 text-indigo-600" />
                <span>Grounded AI Chat</span>
              </span>
            </div>
            
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-cabinet font-extrabold tracking-tighter text-black leading-none">
              PaperWait: because<br />
              paperwork <span className="text-transparent" style={{ WebkitTextStroke: '2px #000' }}>shouldn&apos;t</span> make you wait.
            </h1>

            <p className="text-lg sm:text-xl font-bold text-black/80 max-w-xl leading-relaxed">
              Scan, auto-categorize, semantically search every page, and chat directly with your document vault — backed by verifiable citations and instant vector recall.
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

            <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 pt-4 text-xs sm:text-sm font-bold text-black/80">
              <span className="flex items-center"><Check className="w-4 h-4 mr-1.5 text-black stroke-[3px]" /> OCR &amp; Auto-Categorization</span>
              <span className="flex items-center"><Check className="w-4 h-4 mr-1.5 text-black stroke-[3px]" /> Vector Semantic Search</span>
              <span className="flex items-center"><Check className="w-4 h-4 mr-1.5 text-black stroke-[3px]" /> Grounded Q&amp;A with Citations</span>
              <span className="flex items-center"><Check className="w-4 h-4 mr-1.5 text-black stroke-[3px]" /> Isolated Private Vaults</span>
            </div>
          </div>

          {/* Right Column: Exact App Preview Mockup */}
          <div className="lg:col-span-6">
            <div className="bg-[#09090b] border-2 border-black rounded-2xl shadow-hard-xl overflow-hidden text-zinc-100 flex flex-col">
              
              {/* Browser Window Header */}
              <div className="bg-zinc-950 text-zinc-400 h-12 flex items-center px-4 justify-between border-b border-zinc-900">
                <div className="flex items-center space-x-2">
                  <span className="w-3.5 h-3.5 rounded-full bg-[#ff5f57]" />
                  <span className="w-3.5 h-3.5 rounded-full bg-[#febc2e]" />
                  <span className="w-3.5 h-3.5 rounded-full bg-[#28c840]" />
                </div>

                <div className="text-xs font-mono opacity-80 select-none bg-zinc-900 px-3 py-1 rounded border border-zinc-800/80 hidden sm:block">
                  {mockView === 'dashboard' && 'paperwait.me/dashboard'}
                  {mockView === 'search' && 'paperwait.me/dashboard?search=active'}
                  {mockView === 'chat' && 'paperwait.me/dashboard?chat=open'}
                  {mockView === 'folder' && `paperwait.me/dashboard/folder/${selectedMockFolder.toLowerCase()}`}
                  {mockView === 'document' && `paperwait.me/dashboard/document/${selectedMockDoc.id}`}
                </div>

                {/* View Switcher */}
                <div className="flex items-center space-x-1">
                  <button 
                    onClick={() => setMockView('dashboard')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                      mockView === 'dashboard' 
                        ? 'bg-indigo-600 text-white border-indigo-500' 
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:bg-zinc-800'
                    }`}
                  >
                    Files
                  </button>
                  <button 
                    onClick={() => setMockView('search')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center space-x-1 transition-colors ${
                      mockView === 'search' 
                        ? 'bg-indigo-600 text-white border-indigo-500' 
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:bg-zinc-800'
                    }`}
                  >
                    <Sparkles className="w-2.5 h-2.5 text-indigo-300" />
                    <span>Search</span>
                  </button>
                  <button 
                    onClick={() => setMockView('chat')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center space-x-1 transition-colors ${
                      mockView === 'chat' 
                        ? 'bg-indigo-600 text-white border-indigo-500' 
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:bg-zinc-800'
                    }`}
                  >
                    <Bot className="w-2.5 h-2.5 text-indigo-300" />
                    <span>Chat</span>
                  </button>
                  <button 
                    onClick={() => setMockView('document')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                      mockView === 'document' 
                        ? 'bg-indigo-600 text-white border-indigo-500' 
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:bg-zinc-800'
                    }`}
                  >
                    Viewer
                  </button>
                </div>
              </div>

              {/* Exact App Body Showcase */}
              <div className="p-4 sm:p-5 min-h-[400px] bg-[#09090b] flex flex-col justify-between relative">
                
                {/* 1. Exact Dashboard View */}
                {mockView === 'dashboard' && (
                  <div className="space-y-4 animate-fade-in text-left">
                    <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                      <div>
                        <div className="text-sm font-extrabold text-white">Dashboard</div>
                        <div className="text-[10px] text-zinc-500">Manage folders and drop files to categorize them automatically.</div>
                      </div>
                      <button className="flex items-center space-x-1 px-2.5 py-1 bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-[10px] font-bold rounded-lg shadow-sm">
                        <Plus className="w-3.5 h-3.5" />
                        <span>New Folder</span>
                      </button>
                    </div>

                    {/* Exact Search Bar with AI Active Toggle */}
                    <div className="flex gap-2">
                      <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 flex items-center text-xs text-zinc-400">
                        <Search className="w-3.5 h-3.5 mr-2 text-zinc-500" />
                        <span>Search documents by name or meaning...</span>
                      </div>
                      <button 
                        onClick={() => setMockView('search')}
                        className="px-2.5 py-1.5 bg-gradient-to-r from-indigo-600/25 to-violet-600/25 border border-indigo-500/50 rounded-xl text-indigo-300 text-[10px] font-bold flex items-center space-x-1 hover:border-indigo-400 transition-colors cursor-pointer"
                      >
                        <Sparkles className="w-3 h-3 text-indigo-400" />
                        <span>AI Search</span>
                      </button>
                    </div>

                    {/* Exact Folders Grid */}
                    <div>
                      <div className="text-[10px] font-bold uppercase text-zinc-500 tracking-wider mb-2">Folders</div>
                      <div className="grid grid-cols-3 gap-2.5">
                        {['Receipts', 'Invoices', 'Contracts'].map((folderName) => {
                          const count = folderName === 'Receipts' ? 5 : folderName === 'Invoices' ? 3 : 2
                          return (
                            <div
                              key={folderName}
                              onClick={() => {
                                setSelectedMockFolder(folderName)
                                setMockView('folder')
                              }}
                              className="group p-3 bg-zinc-900/40 border border-zinc-800 rounded-xl hover:border-zinc-700 hover:bg-zinc-900/70 transition-all cursor-pointer flex flex-col justify-between h-20"
                            >
                              <div className="flex justify-between items-start">
                                <div className="p-1.5 bg-zinc-950 border border-zinc-800 rounded-lg">
                                  <Folder className="w-4 h-4 text-indigo-400" />
                                </div>
                                <span className="text-[9px] bg-indigo-950/40 text-indigo-400 border border-indigo-900 px-1.5 py-0.5 rounded-full font-semibold">
                                  {count}
                                </span>
                              </div>
                              <div className="text-[11px] font-bold text-zinc-300 group-hover:text-white truncate mt-2">{folderName}</div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Upload Zone */}
                    <div className="border border-dashed border-zinc-800 bg-zinc-900/10 rounded-xl p-3 flex flex-col items-center justify-center text-center cursor-pointer hover:border-zinc-700 transition-all">
                      <div className="p-1.5 bg-zinc-950 border border-zinc-800 rounded-lg mb-1">
                        <UploadCloud className="w-4 h-4 text-indigo-400" />
                      </div>
                      <div className="text-[11px] font-bold text-zinc-300">Drag &amp; Drop Documents Here</div>
                      <div className="text-[9px] text-zinc-500 mt-0.5">Supports PDF, Images, Word, Excel, CSV, TXT</div>
                    </div>

                    {/* Floating Chat Pill */}
                    <button 
                      onClick={() => setMockView('chat')}
                      className="w-full p-2.5 bg-indigo-950/30 border border-indigo-900/50 rounded-xl flex items-center justify-between text-indigo-200 text-xs font-bold hover:bg-indigo-950/50 transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        <Bot className="w-4 h-4 text-indigo-400" />
                        <span>Open Document Assistant</span>
                      </div>
                      <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-900 px-2 py-0.5 rounded-full">
                        Ready
                      </span>
                    </button>
                  </div>
                )}

                {/* 2. Exact Semantic Search View */}
                {mockView === 'search' && (
                  <div className="space-y-4 animate-fade-in text-left">
                    <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                      <div>
                        <div className="text-sm font-extrabold text-white flex items-center space-x-2">
                          <Sparkles className="w-4 h-4 text-indigo-400" />
                          <span>Vector Semantic Search</span>
                        </div>
                        <div className="text-[10px] text-zinc-500">Natural language search across document contents and concepts</div>
                      </div>
                      <span className="text-[9px] bg-indigo-950/60 text-indigo-300 border border-indigo-800/80 px-2 py-0.5 rounded-full font-bold flex items-center space-x-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                        <span>AI Search Active</span>
                      </span>
                    </div>

                    {/* Exact Search Bar */}
                    <div className="relative flex items-center">
                      <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3" />
                      <div className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-24 py-2 text-xs font-medium text-zinc-200">
                        {activeSemanticQuery.query}
                      </div>
                      <div className="absolute right-1.5 flex items-center space-x-1 px-2 py-0.5 bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 rounded-lg text-[9px] font-bold">
                        <Sparkles className="w-3 h-3" />
                        <span>Semantic</span>
                      </div>
                    </div>

                    {/* Sample Query Suggestions */}
                    <div>
                      <div className="text-[9px] font-bold uppercase text-zinc-500 tracking-wider mb-1.5">Try Suggested Queries</div>
                      <div className="flex flex-wrap gap-1.5">
                        {MOCK_SEMANTIC_QUERIES.map((item, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedSearchQueryIdx(idx)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                              selectedSearchQueryIdx === idx
                                ? 'bg-indigo-600 text-white border border-indigo-400'
                                : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:bg-zinc-850 hover:text-zinc-200'
                            }`}
                          >
                            &ldquo;{item.query}&rdquo;
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Semantic Match Result Card with Highlighted Terms */}
                    <div className="p-3 bg-zinc-900/40 border border-indigo-900/40 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <FileText className="w-4 h-4 text-indigo-400" />
                          <span className="text-xs font-bold text-white">{activeSemanticQuery.topDoc}</span>
                          <span className="text-[9px] bg-zinc-800 text-zinc-400 border border-zinc-700 px-1.5 py-0.25 rounded">
                            {activeSemanticQuery.folder}
                          </span>
                        </div>
                        <span className="text-[10px] font-bold bg-emerald-950/40 text-emerald-400 border border-emerald-900/50 px-2 py-0.5 rounded-full">
                          {activeSemanticQuery.similarity}% Match
                        </span>
                      </div>

                      <p className="text-[11px] text-zinc-300 leading-relaxed bg-zinc-950/80 p-2.5 rounded-lg border border-zinc-850 font-mono">
                        {activeSemanticQuery.snippet.split(' ').map((word, i) => {
                          const clean = word.toLowerCase().replace(/[^a-z0-9]/g, '')
                          const isMatch = activeSemanticQuery.matchedTerms.includes(clean)
                          return isMatch ? (
                            <mark key={i} className="bg-indigo-500/25 text-indigo-300 px-1 py-0.5 rounded font-medium border border-indigo-500/30 mx-0.5">
                              {word}{' '}
                            </mark>
                          ) : (
                            <span key={i}>{word} </span>
                          )
                        })}
                      </p>
                    </div>
                  </div>
                )}

                {/* 3. Exact Document Chat View */}
                {mockView === 'chat' && (
                  <div className="space-y-4 animate-fade-in text-left">
                    <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                      <div className="flex items-center space-x-2">
                        <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center">
                          <Bot className="w-3.5 h-3.5 text-white" />
                        </div>
                        <div>
                          <div className="text-xs font-extrabold text-white">Document Assistant</div>
                          <div className="text-[9px] text-zinc-500">Ask questions grounded in your private vault</div>
                        </div>
                      </div>
                      <span className="text-[9px] bg-emerald-950/40 text-emerald-400 border border-emerald-900/40 px-2 py-0.5 rounded font-bold">
                        100% Grounded
                      </span>
                    </div>

                    {/* Conversation Bubble */}
                    <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                      <div className="flex justify-end">
                        <div className="bg-indigo-600 text-white px-3 py-1.5 rounded-2xl rounded-tr-sm text-xs max-w-[85%] font-medium">
                          {activeChatQA.question}
                        </div>
                      </div>

                      <div className="flex items-start space-x-2">
                        <div className="w-5 h-5 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Bot className="w-3 h-3 text-indigo-400" />
                        </div>
                        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl rounded-tl-sm p-3 text-xs text-zinc-200 space-y-2 max-w-[90%]">
                          {isTypingChat ? (
                            <div className="flex items-center space-x-2 text-zinc-400">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                              <span className="text-[10px]">Retrieving context and preparing answer...</span>
                            </div>
                          ) : (
                            <>
                              <p className="leading-relaxed whitespace-pre-line text-[11px]">
                                {activeChatQA.answer}
                              </p>
                              <div className="pt-2 border-t border-zinc-800/80 flex items-center space-x-1.5">
                                <FileText className="w-3 h-3 text-indigo-400" />
                                <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950/50 border border-indigo-900/60 px-2 py-0.5 rounded">
                                  [From &ldquo;{activeChatDoc}&rdquo;, {activeChatQA.sourcePage}]
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Question Preset Chips */}
                    <div>
                      <div className="text-[9px] font-bold uppercase text-zinc-500 tracking-wider mb-1.5">Preset Document Questions</div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                        {MOCK_DOCUMENTS.map((doc) => (
                          <button
                            key={doc.id}
                            onClick={() => handleSelectMockChat(doc)}
                            className={`p-1.5 rounded-lg text-left text-[10px] font-bold border transition-all truncate ${
                              activeChatDoc === doc.fileName
                                ? 'bg-indigo-600/30 text-indigo-200 border-indigo-500/50'
                                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:bg-zinc-850 hover:text-zinc-200'
                            }`}
                            title={doc.chatQA.question}
                          >
                            📁 {doc.folder}: {doc.fileName}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. Exact Folder View */}
                {mockView === 'folder' && (
                  <div className="space-y-4 animate-fade-in text-left">
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
                            <div className="p-2 bg-zinc-950 border border-zinc-850 rounded-xl text-zinc-400 group-hover:text-indigo-400 transition-all">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[11px] font-bold text-zinc-200 truncate group-hover:text-white">{doc.fileName}</div>
                              <div className="text-[9px] text-zinc-500 mt-0.5">Size: {doc.fileSize} • Auto-classified</div>
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

                {/* 5. Exact Document Details View */}
                {mockView === 'document' && (
                  <div className="space-y-4 animate-fade-in text-left">
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
                      <span className="text-[9px] bg-indigo-950/40 text-indigo-400 border border-indigo-900 px-2 py-0.5 rounded font-bold uppercase">
                        📁 {selectedMockDoc.folder}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-zinc-900/40 border border-zinc-850 p-2.5 rounded-xl text-[10px]">
                        <div className="text-zinc-500">Classification Reason</div>
                        <div className="text-zinc-300 font-bold mt-1 leading-tight">{selectedMockDoc.classificationReason}</div>
                      </div>
                      <div className="bg-zinc-900/40 border border-zinc-850 p-2.5 rounded-xl text-[10px]">
                        <div className="text-zinc-500">Vector Status</div>
                        <div className="text-emerald-400 font-bold mt-1 uppercase">{selectedMockDoc.vectorStatus}</div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[9px] font-bold text-zinc-500">EXTRACTED OCR CONTENTS</div>
                      <pre className="bg-zinc-950 border border-zinc-900 text-zinc-200 p-2.5 rounded-xl font-mono text-[10px] h-20 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                        {selectedMockDoc.ocrSnippet}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Footer Bar */}
                <div className="border-t border-zinc-900 pt-3 flex justify-between items-center text-[10px] text-zinc-500 font-medium">
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span>Exact App Interface</span>
                  </div>
                  <button 
                    onClick={() => {
                      if (mockView === 'dashboard') setMockView('search')
                      else if (mockView === 'search') setMockView('chat')
                      else if (mockView === 'chat') setMockView('document')
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

      {/* 3. Product Benefits Marquee */}
      <section className="bg-brand-charcoal border-b-2 border-black py-4 overflow-hidden relative">
        <div className="animate-marquee whitespace-nowrap flex items-center text-brand-indigo font-cabinet font-extrabold uppercase text-lg sm:text-xl tracking-wider select-none">
          {Array(3).fill(
            <>
              <span className="mx-8 flex items-center"><Zap className="w-5 h-5 text-indigo-400 fill-indigo-400 mr-2" /> OCR Digitization</span>
              <span className="mx-8 flex items-center"><Zap className="w-5 h-5 text-indigo-400 fill-indigo-400 mr-2" /> Autonomous Categorization</span>
              <span className="mx-8 flex items-center"><Sparkles className="w-5 h-5 text-indigo-400 mr-2" /> Vector Semantic Search</span>
              <span className="mx-8 flex items-center"><Bot className="w-5 h-5 text-indigo-400 mr-2" /> Grounded AI Assistant</span>
              <span className="mx-8 flex items-center"><CheckCircle2 className="w-5 h-5 text-indigo-400 mr-2" /> Verified Page Citations</span>
              <span className="mx-8 flex items-center"><ShieldCheck className="w-5 h-5 text-indigo-400 mr-2" /> Isolated Encrypted Vault</span>
            </>
          )}
        </div>
      </section>

      {/* 4. Problem vs Solution Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl font-cabinet font-extrabold tracking-tight mb-4">
            Document Chaos vs. Instant Intelligence
          </h2>
          <p className="text-lg font-bold text-black/70">
            Why traditional folder hierarchies and keyword search leave you stranded.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Card A: Problem */}
          <div className="bg-[#f4f4f5] border-2 border-dashed border-gray-400 opacity-80 rounded-3xl p-8 sm:p-10 flex flex-col justify-between">
            <div>
              <span className="inline-block bg-white text-gray-500 border border-gray-300 font-bold px-3 py-1 rounded-full text-xs uppercase tracking-wide mb-6">
                Manual Filing &amp; Keyword Blindness
              </span>
              <h3 className="text-2xl font-cabinet font-extrabold mb-6">
                Hours Wasted Searching &amp; Calculating
              </h3>
              <ul className="space-y-4">
                {[
                  'Renaming files, bills, and agreements one by one.',
                  'Keyword searches fail when documents use synonyms or alternative phrasing.',
                  'Re-reading 30-page contracts just to find one clause or renewal date.',
                  'Generic AI chatbots hallucinate numbers because they lack access to your real files.'
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start">
                    <X className="w-5 h-5 text-indigo-500 stroke-[3px] mr-3 mt-1 flex-shrink-0" />
                    <span className="font-bold text-black/70 text-sm sm:text-base">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-8 border-t border-gray-300 pt-6">
              <p className="text-xs text-gray-500 font-mono">Result: Lost time, missed deadlines, and unverified estimates.</p>
            </div>
          </div>

          {/* Card B: Solution */}
          <div className="bg-brand-indigo border-2 border-black rounded-3xl p-8 sm:p-10 shadow-hard-lg flex flex-col justify-between">
            <div>
              <span className="inline-block bg-white text-black border-2 border-black font-bold px-3 py-1 rounded-full text-xs uppercase tracking-wide mb-6">
                The PaperWait Solution
              </span>
              <h3 className="text-2xl font-cabinet font-extrabold mb-6">
                Autonomous Filing, Vector Search &amp; Grounded Chat
              </h3>
              <ul className="space-y-4">
                {[
                  'Drop PDFs, images, Office files, or scans — OCR digitizes text automatically.',
                  'Neural classification auto-assigns files into structured directories.',
                  'Vector Semantic Search retrieves concepts using high-precision embedding similarity.',
                  'Grounded AI Assistant answers document queries with exact page citations and tables.'
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start">
                    <Check className="w-5 h-5 text-black stroke-[3px] mr-3 mt-1 flex-shrink-0" />
                    <span className="font-bold text-black text-sm sm:text-base">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-8 border-t-2 border-black pt-6">
              <p className="text-xs text-black/80 font-mono">Result: Zero filing overhead, instant answers, and guaranteed source transparency.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Core Capabilities Grid (6 Features) */}
      <section id="features" className="bg-brand-indigo border-t-2 border-b-2 border-black py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          
          <div className="max-w-2xl mb-16">
            <span className="bg-white border-2 border-black px-3.5 py-1 rounded-full text-xs uppercase font-bold tracking-wider shadow-hard-sm">
              Core Capabilities
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-cabinet font-extrabold tracking-tight mt-6 mb-4">
              Autonomous Document Intelligence
            </h2>
            <p className="text-lg font-bold text-black/80">
              An all-in-one system combining OCR digitization, smart categorization, vector semantic search, and grounded conversational AI.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            
            {/* Feature 1 */}
            <div className="bg-white border-2 border-black p-8 rounded-2xl shadow-hard-sm hover:translate-y-[-4px] hover:shadow-hard-lg transition-all group">
              <div className="w-12 h-12 bg-brand-sage border-2 border-black rounded-lg flex items-center justify-center mb-6 group-hover:bg-brand-indigo transition-colors">
                <UploadCloud className="w-6 h-6 text-black" />
              </div>
              <h3 className="text-xl font-cabinet font-extrabold mb-3">
                OCR Digitization &amp; Text Parsing
              </h3>
              <p className="text-sm font-bold text-black/70 leading-relaxed">
                Extract readable text from multi-page PDFs, mobile camera scans, Word docs, Excel spreadsheets, PPTX slides, CSVs, and TXT files with layout preservation.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-white border-2 border-black p-8 rounded-2xl shadow-hard-sm hover:translate-y-[-4px] hover:shadow-hard-lg transition-all group">
              <div className="w-12 h-12 bg-brand-sage border-2 border-black rounded-lg flex items-center justify-center mb-6 group-hover:bg-brand-indigo transition-colors">
                <FolderOpen className="w-6 h-6 text-black" />
              </div>
              <h3 className="text-xl font-cabinet font-extrabold mb-3">
                Autonomous Categorization
              </h3>
              <p className="text-sm font-bold text-black/70 leading-relaxed">
                Intelligent models automatically route invoices, receipts, and contracts to dedicated directories with smart folder auto-creation.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-white border-2 border-black p-8 rounded-2xl shadow-hard-sm hover:translate-y-[-4px] hover:shadow-hard-lg transition-all group">
              <div className="w-12 h-12 bg-brand-sage border-2 border-black rounded-lg flex items-center justify-center mb-6 group-hover:bg-brand-indigo transition-colors">
                <Sparkles className="w-6 h-6 text-black" />
              </div>
              <div className="flex items-center space-x-2 mb-3">
                <h3 className="text-xl font-cabinet font-extrabold">
                  Vector Semantic Search
                </h3>
                <span className="text-[10px] bg-indigo-100 text-indigo-900 font-extrabold px-2 py-0.5 rounded-full border border-indigo-400">
                  NEW
                </span>
              </div>
              <p className="text-sm font-bold text-black/70 leading-relaxed">
                Search by concept, intent, or fuzzy recall. High-precision vector embeddings understand meaning and context across every document page.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="bg-white border-2 border-black p-8 rounded-2xl shadow-hard-sm hover:translate-y-[-4px] hover:shadow-hard-lg transition-all group">
              <div className="w-12 h-12 bg-brand-sage border-2 border-black rounded-lg flex items-center justify-center mb-6 group-hover:bg-brand-indigo transition-colors">
                <Bot className="w-6 h-6 text-black" />
              </div>
              <div className="flex items-center space-x-2 mb-3">
                <h3 className="text-xl font-cabinet font-extrabold">
                  Grounded AI Assistant
                </h3>
                <span className="text-[10px] bg-indigo-100 text-indigo-900 font-extrabold px-2 py-0.5 rounded-full border border-indigo-400">
                  NEW
                </span>
              </div>
              <p className="text-sm font-bold text-black/70 leading-relaxed">
                Ask conversational questions directly to your document vault with strict anti-hallucination guardrails and instant answers.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="bg-white border-2 border-black p-8 rounded-2xl shadow-hard-sm hover:translate-y-[-4px] hover:shadow-hard-lg transition-all group">
              <div className="w-12 h-12 bg-brand-sage border-2 border-black rounded-lg flex items-center justify-center mb-6 group-hover:bg-brand-indigo transition-colors">
                <FileSearch className="w-6 h-6 text-black" />
              </div>
              <h3 className="text-xl font-cabinet font-extrabold mb-3">
                Verified Citations &amp; Tables
              </h3>
              <p className="text-sm font-bold text-black/70 leading-relaxed">
                Every AI answer features source provenance with document names and page numbers (e.g., &ldquo;From invoice_2026.pdf, Page 2&rdquo;) and clean financial tables.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="bg-white border-2 border-black p-8 rounded-2xl shadow-hard-sm hover:translate-y-[-4px] hover:shadow-hard-lg transition-all group">
              <div className="w-12 h-12 bg-brand-sage border-2 border-black rounded-lg flex items-center justify-center mb-6 group-hover:bg-brand-indigo transition-colors">
                <ShieldCheck className="w-6 h-6 text-black" />
              </div>
              <h3 className="text-xl font-cabinet font-extrabold mb-3">
                Private Vault &amp; Row Security
              </h3>
              <p className="text-sm font-bold text-black/70 leading-relaxed">
                Row Level Security across all tables and isolated private storage buckets ensure your documents remain completely private and protected.
              </p>
            </div>

          </div>

        </div>
      </section>

      {/* 6. Feature Deep Dive: Semantic Search Spotlight */}
      <section id="semantic-search" className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-b-2 border-black">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          <div className="lg:col-span-6 space-y-6">
            <span className="bg-brand-indigo border-2 border-black px-3.5 py-1 rounded-full text-xs uppercase font-bold tracking-wider shadow-hard-sm inline-flex items-center space-x-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-800" />
              <span>Semantic Retrieval</span>
            </span>

            <h2 className="text-3xl sm:text-4xl font-cabinet font-extrabold tracking-tight">
              Vector Semantic Search:<br />Find Documents by Meaning, Not Just Words.
            </h2>

            <p className="text-base sm:text-lg font-bold text-black/80 leading-relaxed">
              Traditional search breaks when you don&apos;t know the exact keyword. PaperWait computes high-precision vector embeddings for every document chunk to match concepts and intent.
            </p>

            <div className="space-y-4">
              <div className="p-4 bg-[#f4f4f5] border-2 border-black rounded-xl">
                <div className="text-xs font-bold uppercase text-zinc-500 mb-1">Traditional Keyword Search</div>
                <div className="text-sm font-bold text-red-600 flex items-center space-x-2">
                  <X className="w-4 h-4" />
                  <span>Searching &ldquo;rent expense&rdquo; misses documents labeled &ldquo;lease agreement&rdquo;</span>
                </div>
              </div>

              <div className="p-4 bg-brand-indigo border-2 border-black rounded-xl shadow-hard-sm">
                <div className="text-xs font-bold uppercase text-black/70 mb-1">PaperWait Vector Semantic Search</div>
                <div className="text-sm font-bold text-black flex items-center space-x-2">
                  <Check className="w-4 h-4 stroke-[3px]" />
                  <span>Understands synonyms, concepts, amounts, and intent with 95%+ precision</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <div className="bg-white border-2 border-black px-3 py-1.5 rounded-lg text-xs font-bold">
                ⚡ Sub-Second Retrieval
              </div>
              <div className="bg-white border-2 border-black px-3 py-1.5 rounded-lg text-xs font-bold">
                🎯 Dynamic Keyword &amp; Concept Boosting
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 bg-brand-charcoal border-2 border-black rounded-3xl p-6 sm:p-8 text-white shadow-hard-xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-6">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <span className="font-cabinet font-extrabold text-base">Semantic Search Preview</span>
              </div>
              <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800 px-2.5 py-0.5 rounded-full font-mono font-bold">
                Vector Match
              </span>
            </div>

            <div className="space-y-4">
              <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl">
                <div className="text-[10px] text-zinc-500 uppercase font-mono mb-1">Search Query</div>
                <div className="text-xs text-white font-bold">&ldquo;Show me Q3 service agreements with recurring fees&rdquo;</div>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] text-zinc-400 uppercase font-mono font-bold">Matched Document Chunks (Top Similarity)</div>
                
                <div className="p-3 bg-white/5 border border-white/10 rounded-xl space-y-1.5 hover:border-indigo-500/40 transition-colors">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-white">agreement-sample.pdf</span>
                    <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.25 rounded font-mono font-bold">97% Match</span>
                  </div>
                  <p className="text-[11px] text-zinc-300 font-mono">
                    ... TERM: 12 Months ... RATE: <mark className="bg-indigo-500/25 text-indigo-300 px-1 py-0.5 rounded font-medium border border-indigo-500/30">$1,800.00 / month</mark> ... DEPOSIT: $1,800.00 ...
                  </p>
                </div>

                <div className="p-3 bg-white/5 border border-white/10 rounded-xl space-y-1.5 hover:border-indigo-500/40 transition-colors">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-white">invoice-sample.pdf</span>
                    <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.25 rounded font-mono font-bold">91% Match</span>
                  </div>
                  <p className="text-[11px] text-zinc-300 font-mono">
                    ... INVOICE NUMBER: 10485 ... <mark className="bg-indigo-500/25 text-indigo-300 px-1 py-0.5 rounded font-medium border border-indigo-500/30">Services Rendered - $148.20</mark> ...
                  </p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* 7. Feature Deep Dive: Grounded RAG Chatbot Spotlight */}
      <section id="rag-chatbot" className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-b-2 border-black">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          <div className="lg:col-span-6 order-2 lg:order-1 bg-brand-charcoal border-2 border-black rounded-3xl p-6 sm:p-8 text-white shadow-hard-xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
              <div className="flex items-center space-x-2">
                <Bot className="w-5 h-5 text-indigo-400" />
                <span className="font-cabinet font-extrabold text-base">Grounded AI Assistant</span>
              </div>
              <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-0.5 rounded-full font-mono font-bold">
                Anti-Hallucination Active
              </span>
            </div>

            <div className="space-y-4">
              <div className="p-3 bg-indigo-950/40 border border-indigo-900/60 rounded-xl">
                <div className="text-[10px] text-indigo-300 font-bold mb-0.5">User Prompt</div>
                <div className="text-xs text-white font-medium">&ldquo;What is my total spending on retail receipts and invoices this month?&rdquo;</div>
              </div>

              <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
                <div className="text-xs text-zinc-200 leading-relaxed">
                  Based on your uploaded documents, here is the itemized summary:
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] text-left border-collapse font-mono">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-400">
                        <th className="py-1">Document</th>
                        <th className="py-1">Category</th>
                        <th className="py-1 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                      <tr>
                        <td className="py-1 text-indigo-300">invoice-sample.pdf</td>
                        <td className="py-1">Services</td>
                        <td className="py-1 text-right font-bold">$148.20</td>
                      </tr>
                      <tr>
                        <td className="py-1 text-indigo-300">receipt-sample.jpg</td>
                        <td className="py-1">Retail</td>
                        <td className="py-1 text-right font-bold">$23.48</td>
                      </tr>
                      <tr className="font-bold text-white">
                        <td className="py-1.5" colSpan={2}>Total Calculated</td>
                        <td className="py-1.5 text-right text-emerald-400">$171.68</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="pt-2 border-t border-zinc-800 flex flex-wrap gap-2 text-[10px] font-mono">
                  <span className="bg-indigo-950 text-indigo-300 border border-indigo-900 px-2 py-0.5 rounded">
                    [From &ldquo;invoice-sample.pdf&rdquo;, Page 1]
                  </span>
                  <span className="bg-indigo-950 text-indigo-300 border border-indigo-900 px-2 py-0.5 rounded">
                    [From &ldquo;receipt-sample.jpg&rdquo;, Page 1]
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 order-1 lg:order-2 space-y-6">
            <span className="bg-brand-indigo border-2 border-black px-3.5 py-1 rounded-full text-xs uppercase font-bold tracking-wider shadow-hard-sm inline-flex items-center space-x-1.5">
              <Bot className="w-3.5 h-3.5 text-indigo-800" />
              <span>Grounded Conversational AI</span>
            </span>

            <h2 className="text-3xl sm:text-4xl font-cabinet font-extrabold tracking-tight">
              Chat With Your Document Vault.<br />Every Word Backed by Page Citations.
            </h2>

            <p className="text-base sm:text-lg font-bold text-black/80 leading-relaxed">
              PaperWait combines Retrieval-Augmented Generation (RAG) with strict anti-hallucination guardrails. The AI only answers questions using the verified text extracted from your files.
            </p>

            <ul className="space-y-3">
              {[
                'Verifiable citations: click any citation pill to verify the source document & page.',
                'Structured synthesis: extracts comparison tables, totals, and bulleted takeaways.',
                'High-speed conversational inference with automatic multi-tiered failover.',
                'Persistent chat history synchronized across devices and protected by Row Level Security.'
              ].map((item, idx) => (
                <li key={idx} className="flex items-start">
                  <Check className="w-5 h-5 text-black stroke-[3px] mr-3 mt-0.5 flex-shrink-0" />
                  <span className="font-bold text-black text-sm sm:text-base">{item}</span>
                </li>
              ))}
            </ul>
          </div>

        </div>
      </section>

      {/* 8. How It Works Section (4 Steps in Proper Sequence) */}
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
              Four seamless operations from document upload to instant, cited answers.
            </p>
          </div>

          <div className="relative">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 relative z-10">
              
              {/* Step 1 */}
              <div className="flex flex-col items-center text-center space-y-4 p-6 bg-white/5 border border-white/10 rounded-2xl hover:border-brand-sage transition-colors">
                <div className="w-14 h-14 rounded-full bg-brand-charcoal border-4 border-brand-sage flex items-center justify-center font-cabinet font-extrabold text-xl shadow-[0_0_15px_rgba(183,198,194,0.4)]">
                  1
                </div>
                <h3 className="text-xl font-cabinet font-extrabold">Snap &amp; Upload</h3>
                <p className="text-sm text-white/70 leading-relaxed font-bold">
                  Capture receipts with your phone, import bills, or drag &amp; drop PDFs, Word files, and spreadsheets into the browser vault.
                </p>
              </div>

              {/* Step 2 */}
              <div className="flex flex-col items-center text-center space-y-4 p-6 bg-white/5 border border-white/10 rounded-2xl hover:border-brand-indigo transition-colors">
                <div className="w-14 h-14 rounded-full bg-brand-charcoal border-4 border-brand-indigo flex items-center justify-center font-cabinet font-extrabold text-xl shadow-[0_0_15px_rgba(199,210,254,0.4)]">
                  2
                </div>
                <h3 className="text-xl font-cabinet font-extrabold">OCR &amp; Auto-Sort</h3>
                <p className="text-sm text-white/70 leading-relaxed font-bold">
                  OCR extracts layout strings across every page. Neural models automatically classify and file documents into smart directories.
                </p>
              </div>

              {/* Step 3 */}
              <div className="flex flex-col items-center text-center space-y-4 p-6 bg-white/5 border border-white/10 rounded-2xl hover:border-white transition-colors">
                <div className="w-14 h-14 rounded-full bg-brand-charcoal border-4 border-white flex items-center justify-center font-cabinet font-extrabold text-xl shadow-[0_0_15px_rgba(255,255,255,0.4)]">
                  3
                </div>
                <h3 className="text-xl font-cabinet font-extrabold">Embed &amp; Index</h3>
                <p className="text-sm text-white/70 leading-relaxed font-bold">
                  Text is split into boundary-aware chunks and indexed into high-speed vector embeddings for concept-based semantic recall.
                </p>
              </div>

              {/* Step 4 */}
              <div className="flex flex-col items-center text-center space-y-4 p-6 bg-white/5 border border-white/10 rounded-2xl hover:border-indigo-400 transition-colors">
                <div className="w-14 h-14 rounded-full bg-brand-charcoal border-4 border-indigo-400 flex items-center justify-center font-cabinet font-extrabold text-xl shadow-[0_0_15px_rgba(99,102,241,0.5)]">
                  4
                </div>
                <h3 className="text-xl font-cabinet font-extrabold">Search &amp; Chat</h3>
                <p className="text-sm text-white/70 leading-relaxed font-bold">
                  Retrieve files by concept via vector semantic search, or chat with the assistant to get cited answers, tables, and summaries.
                </p>
              </div>

            </div>
          </div>

        </div>
      </section>

      {/* 9. Interactive Sandbox Ingestion Simulator (Clean, Professional, Non-Sensitive) */}
      <section className="bg-white py-16 px-4 sm:px-6 lg:px-8 border-b-2 border-black">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-2xl mb-12">
            <span className="bg-brand-indigo border-2 border-black px-3.5 py-1 rounded-full text-xs uppercase font-bold tracking-wider shadow-hard-sm">
              Interactive Sandbox
            </span>
            <h2 className="text-3xl sm:text-4xl font-cabinet font-extrabold tracking-tight mt-6 mb-4">
              Try the Document Ingestion Pipeline
            </h2>
            <p className="text-lg font-bold text-black/70">
              Select one of the sample document types below to watch the upload, OCR text extraction, folder filing, and vector indexing in action.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Left: Input Selection */}
            <div className="lg:col-span-5 bg-brand-indigo border-2 border-black p-6 sm:p-8 rounded-2xl shadow-hard-lg flex flex-col justify-between">
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-cabinet font-extrabold text-black mb-1">
                    1. Choose a File Template
                  </h3>
                  <p className="text-xs text-black/70 font-bold">
                    Select a document to process through the pipeline.
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
                        {demoProgress >= 20 ? (
                          demoProgress > 20 ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Loader2 className="w-4 h-4 animate-spin text-black" />
                          )
                        ) : (
                          <div className="w-4 h-4 border border-black/40 rounded-full" />
                        )}
                        <span className={demoProgress >= 20 ? 'text-black' : 'text-black/45'}>Secure Ingress &amp; Staging</span>
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
                        <span className={demoProgress >= 50 ? 'text-black' : 'text-black/45'}>OCR Digitization &amp; Text Extraction</span>
                      </div>

                      <div className="flex items-center space-x-2">
                        {demoProgress >= 75 ? (
                          demoProgress > 75 ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Loader2 className="w-4 h-4 animate-spin text-black" />
                          )
                        ) : (
                          <div className="w-4 h-4 border border-black/40 rounded-full" />
                        )}
                        <span className={demoProgress >= 75 ? 'text-black' : 'text-black/45'}>Folder Classification &amp; Routing</span>
                      </div>

                      <div className="flex items-center space-x-2">
                        {demoProgress >= 90 ? (
                          demoProgress >= 100 ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Loader2 className="w-4 h-4 animate-spin text-black" />
                          )
                        ) : (
                          <div className="w-4 h-4 border border-black/40 rounded-full" />
                        )}
                        <span className={demoProgress >= 90 ? 'text-black' : 'text-black/45'}>Vector Embeddings &amp; Semantic Indexing</span>
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

            {/* Right: Clean Ingestion Monitor */}
            <div className="lg:col-span-7 bg-brand-charcoal text-white rounded-2xl border-2 border-black shadow-hard-lg overflow-hidden flex flex-col justify-between min-h-[400px]">
              {/* Header */}
              <div className="bg-[#0e1310] border-b border-white/5 px-6 py-4 flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <span className={`w-2 h-2 rounded-full ${demoStep === 'done' ? 'bg-emerald-500' : demoStep === 'idle' ? 'bg-zinc-650' : 'bg-amber-500 animate-pulse'}`} />
                  <span className="font-mono text-zinc-400 font-bold">PaperWait Ingestion Monitor</span>
                </div>
                <span className="font-mono opacity-60">Status: {demoStep.toUpperCase()}</span>
              </div>

              {/* Body */}
              <div className="flex-1 p-6 flex flex-col justify-center text-left">
                {demoStep === 'idle' && (
                  <div className="text-center max-w-sm mx-auto space-y-4">
                    <UploadCloud className="w-12 h-12 text-zinc-700 mx-auto opacity-50" />
                    <h4 className="font-cabinet font-extrabold text-lg text-zinc-350">Awaiting file selection...</h4>
                    <p className="text-xs text-zinc-500 font-medium leading-relaxed">
                      Select one of the sample document templates on the left to watch how they are securely uploaded, OCR-digitized, categorized, and indexed for semantic search and Q&amp;A.
                    </p>
                  </div>
                )}

                {demoStep === 'uploading' && (
                  <div className="text-center max-w-sm mx-auto space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin text-brand-indigo mx-auto" />
                    <h4 className="font-cabinet font-extrabold text-sm text-zinc-200 uppercase tracking-widest">Staging Document...</h4>
                    <p className="text-xs text-zinc-500 font-mono">
                      Staging {demoSelectedDoc?.fileName} to private vault storage
                    </p>
                  </div>
                )}

                {demoStep === 'ocr' && (
                  <div className="space-y-4 font-mono text-xs text-left">
                    <div className="text-brand-indigo font-bold">{`>>> PERFORMING TEXT DIGITIZATION (OCR)...`}</div>
                    <div className="text-zinc-500 text-[10px] leading-relaxed">
                      Scanning document layout...<br />
                      Preserving multi-page text and headers...
                    </div>
                    <div className="bg-white/5 border border-white/10 p-3 rounded text-[11px] font-mono animate-pulse">
                      {demoSelectedDoc?.ocrSnippet.split('\n')[0]}...
                    </div>
                  </div>
                )}

                {demoStep === 'categorizing' && (
                  <div className="space-y-4 font-mono text-xs text-left">
                    <div className="text-brand-indigo font-bold">{`>>> OCR EXTRACTION COMPLETE.`}</div>
                    <div className="text-zinc-500 text-[10px] leading-relaxed">
                      Analyzing document semantics and headers...<br />
                      Determining destination directory...
                    </div>
                    <div className="bg-white/5 border border-white/10 p-3 rounded text-[11px] font-bold text-amber-400">
                      Destination Folder: {demoSelectedDoc?.folder}
                    </div>
                  </div>
                )}

                {demoStep === 'embedding' && (
                  <div className="space-y-4 font-mono text-xs text-left">
                    <div className="text-brand-indigo font-bold">{`>>> GENERATING VECTOR EMBEDDINGS...`}</div>
                    <div className="text-zinc-500 text-[10px] leading-relaxed">
                      Creating boundary-aware text chunks...<br />
                      Computing high-dimensional vector embeddings...<br />
                      Storing embeddings in document vector index...
                    </div>
                    <div className="bg-white/5 border border-white/10 p-3 rounded text-[11px] font-bold text-indigo-400">
                      ⚡ Vector embeddings generated &amp; indexed
                    </div>
                  </div>
                )}

                {demoStep === 'done' && demoSelectedDoc && (
                  <div className="space-y-4 animate-fade-in text-left">
                    {/* Header */}
                    <div className="flex items-center justify-between text-xs border-b border-white/10 pb-3">
                      <span className="text-zinc-400 font-bold font-mono">Ingestion Complete</span>
                      <div className="flex items-center space-x-2">
                        <span className="bg-brand-indigo text-black font-extrabold border border-black px-2.5 py-0.5 rounded text-[10px] uppercase font-mono">
                          📁 {demoSelectedDoc.folder}
                        </span>
                        <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded text-[10px] uppercase font-mono font-bold">
                          Ready
                        </span>
                      </div>
                    </div>

                    {/* OCR Snippet block */}
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-bold text-zinc-500 tracking-wider uppercase font-mono">EXTRACTED TEXT PREVIEW</div>
                      <pre className="bg-[#0e1310] border border-white/5 text-zinc-200 p-3 rounded-xl font-mono text-[10px] max-h-20 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                        {demoSelectedDoc.ocrSnippet}
                      </pre>
                    </div>

                    {/* Status blocks */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-white/5 border border-white/10 p-3 rounded-xl">
                        <div className="text-[10px] font-bold text-brand-indigo tracking-wider uppercase font-mono mb-1">Categorization</div>
                        <p className="text-[11px] text-zinc-300 leading-relaxed font-bold">
                          {demoSelectedDoc.classificationReason}
                        </p>
                      </div>
                      <div className="bg-white/5 border border-white/10 p-3 rounded-xl">
                        <div className="text-[10px] font-bold text-emerald-400 tracking-wider uppercase font-mono mb-1">Vector Index Status</div>
                        <p className="text-[11px] text-zinc-300 leading-relaxed font-bold">
                          Document chunks indexed. Ready for Semantic Search &amp; Grounded Chat.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="bg-[#0e1310] border-t border-white/5 px-6 py-3 text-[10px] text-zinc-500 flex justify-between font-mono font-medium select-none">
                <span>Vault Security: Encrypted</span>
                <span>PaperWait Engine</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 10. Supported Document Categories Bento Grid */}
      <section id="document-types" className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="bg-brand-indigo border-2 border-black px-3.5 py-1 rounded-full text-xs uppercase font-bold tracking-wider shadow-hard-sm">
            Compatibility
          </span>
          <h2 className="text-3xl sm:text-4xl font-cabinet font-extrabold tracking-tight mt-6 mb-4">
            Supported Document Categories
          </h2>
          <p className="text-lg font-bold text-black/70">
            Filing parameters, semantic vectors, and conversational understanding tailored to common personal and business templates.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Card 1: Receipts */}
          <div className="bg-brand-sage border-2 border-black rounded-3xl p-8 flex flex-col justify-between hover:translate-y-[-4px] transition-all">
            <div>
              <div className="mb-6">
                <span className="inline-block bg-white text-black border-2 border-black font-extrabold text-[11px] tracking-wider uppercase px-3 py-1 rounded-full shadow-hard-sm">
                  Receipts &amp; Expenses
                </span>
              </div>
              <h3 className="text-2xl font-cabinet font-extrabold text-black mb-4">
                Expense Record-Keeping
              </h3>
              <p className="text-sm font-bold text-black/80 leading-relaxed mb-6">
                Store retail statements, transaction slips, and office supplies. The indexer registers amounts and dates for instant tax queries and total expenditure calculations.
              </p>
            </div>
            <div className="border-t border-black/10 pt-4 text-xs font-bold text-black/70 font-mono">
              Accepts: PDF, PNG, JPG, DOCX, PPTX, CSV, TXT
            </div>
          </div>

          {/* Card 2: Invoices */}
          <div className="bg-brand-indigo border-2 border-black rounded-3xl p-8 flex flex-col justify-between shadow-hard-lg hover:translate-y-[-4px] transition-all">
            <div>
              <div className="mb-6">
                <span className="inline-block bg-white text-black border-2 border-black font-extrabold text-[11px] tracking-wider uppercase px-3 py-1 rounded-full shadow-hard-sm">
                  Invoices &amp; Statements
                </span>
              </div>
              <h3 className="text-2xl font-cabinet font-extrabold text-black mb-4">
                Billing Statements
              </h3>
              <p className="text-sm font-bold text-black/80 leading-relaxed mb-6">
                File utility accounts, client invoices, and recurring fees. Ask the AI assistant questions like &ldquo;What invoices are due this month?&rdquo; for instant cited tables.
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
                Contracts &amp; Agreements
              </h3>
              <p className="text-sm font-bold text-white/80 leading-relaxed mb-6">
                Organize service agreements, leases, and NDAs. Vector search lets you locate clauses, liability limits, or renewal terms without reading 50 pages.
              </p>
            </div>
            <div className="border-t border-white/10 pt-4 text-xs font-bold text-white/70 font-mono">
              Accepts: PDF, DOCX, PPTX, TXT
            </div>
          </div>

        </div>
      </section>

      {/* 11. Final CTA Section */}
      <section className="bg-brand-indigo py-20 px-4 sm:px-6 lg:px-8 border-b-2 border-black text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-dot-pattern opacity-10 pointer-events-none" />
        <div className="max-w-4xl mx-auto relative z-10 space-y-6">
          <h2 className="text-4xl sm:text-5xl font-cabinet font-extrabold tracking-tight text-black leading-tight">
            Because waiting to find it<br />isn&apos;t an option.
          </h2>
          <p className="text-lg font-bold text-black/80 max-w-xl mx-auto">
            Digitize, auto-categorize, semantically search, and chat directly with your entire document archive today.
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
            Instant Setup • Free Tier Available • Zero Lock-In
          </div>
        </div>
      </section>

      {/* 12. Footer */}
      <footer className="bg-brand-charcoal text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-12 border-b border-white/10 pb-12 mb-12">
          
          {/* Column 1: Brand info */}
          <div className="md:col-span-6 space-y-4">
            <Link href="/" className="flex items-center space-x-2.5 group w-max">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 shadow-md shadow-indigo-500/20">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight text-white font-cabinet">
                PaperWait
              </span>
            </Link>
            <p className="text-sm text-white/60 font-bold max-w-sm leading-relaxed">
              Scan, organize, semantically search, and query your documents instantly with grounded AI chat. Because waiting to find it isn&apos;t an option.
            </p>
          </div>

          {/* Column 2: Navigation Links */}
          <div className="md:col-span-3 space-y-3">
            <div className="font-cabinet font-extrabold text-sm uppercase text-brand-sage tracking-wider">Product</div>
            <ul className="space-y-2 text-sm text-white/70 font-bold">
              <li><a href="#features" className="hover:text-brand-indigo transition-colors">Features</a></li>
              <li><a href="#semantic-search" className="hover:text-brand-indigo transition-colors">Vector Semantic Search</a></li>
              <li><a href="#rag-chatbot" className="hover:text-brand-indigo transition-colors">Grounded AI Assistant</a></li>
              <li><a href="#how-it-works" className="hover:text-brand-indigo transition-colors">How It Works</a></li>
              <li><Link href="/login" className="hover:text-brand-indigo transition-colors">Sign In</Link></li>
            </ul>
          </div>

          {/* Column 3: Categories Links */}
          <div className="md:col-span-3 space-y-3">
            <div className="font-cabinet font-extrabold text-sm uppercase text-brand-sage tracking-wider">Categories</div>
            <ul className="space-y-2 text-sm text-white/70 font-bold">
              <li><a href="#document-types" className="hover:text-brand-indigo transition-colors">Expenses &amp; Receipts</a></li>
              <li><a href="#document-types" className="hover:text-brand-indigo transition-colors">Invoices &amp; Statements</a></li>
              <li><a href="#document-types" className="hover:text-brand-indigo transition-colors">Contracts &amp; Agreements</a></li>
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
