/**
 * Chat History API
 * 
 * GET /api/ai/chat/history - Fetch user's persistent chat history
 * DELETE /api/ai/chat/history - Clear user's persistent chat history
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { data: messages, error } = await supabase
      .from('chat_messages')
      .select('id, role, content, sources, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(100)

    if (error) {
      console.error('Failed to fetch chat history:', error)
      return NextResponse.json({ messages: [] })
    }

    return NextResponse.json({
      messages: (messages || []).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sources: Array.isArray(m.sources) ? m.sources : [],
        createdAt: m.created_at,
      })),
    })
  } catch (err: any) {
    console.error('Chat history fetch exception:', err)
    return NextResponse.json({ messages: [] })
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { error } = await supabase
      .from('chat_messages')
      .delete()
      .eq('user_id', user.id)

    if (error) {
      console.error('Failed to clear chat history:', error)
      return NextResponse.json({ error: 'Failed to clear history' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Chat history delete exception:', err)
    return NextResponse.json({ error: 'Failed to clear history' }, { status: 500 })
  }
}
