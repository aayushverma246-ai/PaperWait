/**
 * Cloudflare Workers AI Embedding Client
 * 
 * Uses @cf/qwen/qwen3-embedding-0.6b for 1024-dimensional embeddings.
 * Server-side only — never import in client components.
 */

const EMBEDDING_MODEL = '@cf/qwen/qwen3-embedding-0.6b'
const EMBEDDING_DIMENSIONS = 1024

interface CloudflareEmbeddingResponse {
  success: boolean
  errors: Array<{ message: string }>
  result?: {
    data: number[][]
  }
}

/**
 * Generate embeddings for an array of text inputs using Cloudflare Workers AI.
 * Returns an array of 1024-dimensional float vectors.
 * 
 * @param texts - Array of text strings to embed (max ~100 per batch recommended)
 * @param type - Whether these are 'document' or 'query' embeddings
 */
export async function generateEmbeddings(
  texts: string[]
): Promise<number[][]> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const apiToken = process.env.CLOUDFLARE_API_TOKEN

  if (!accountId || !apiToken) {
    throw new Error('Missing Cloudflare credentials (CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN)')
  }

  if (texts.length === 0) {
    return []
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: texts,
    }),
    signal: AbortSignal.timeout(30000), // 30s timeout
  })

  if (response.status === 429) {
    throw new Error('RATE_LIMIT: Cloudflare embedding rate limit reached. Please try again later.')
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error('AUTH_ERROR: Cloudflare API authentication failed. Check CLOUDFLARE_API_TOKEN.')
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Cloudflare embedding API error (${response.status}): ${errorText}`)
  }

  const data: CloudflareEmbeddingResponse = await response.json()

  if (!data.success || !data.result?.data) {
    const errorMsg = data.errors?.map(e => e.message).join(', ') || 'Unknown embedding error'
    throw new Error(`Cloudflare embedding failed: ${errorMsg}`)
  }

  // Validate all embeddings are correct dimensions
  for (let i = 0; i < data.result.data.length; i++) {
    const embedding = data.result.data[i]
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Invalid embedding dimension at index ${i}: expected ${EMBEDDING_DIMENSIONS}, got ${embedding?.length ?? 'null'}`
      )
    }
    // Verify all values are finite numbers
    for (let j = 0; j < embedding.length; j++) {
      if (typeof embedding[j] !== 'number' || !isFinite(embedding[j])) {
        throw new Error(`Non-finite embedding value at index ${i}, dimension ${j}`)
      }
    }
  }

  return data.result.data
}

/**
 * Generate a single embedding for a query string.
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const results = await generateEmbeddings([query])
  return results[0]
}

/**
 * Generate embeddings in controlled batches to respect rate limits.
 * @param texts - All texts to embed
 * @param batchSize - Number of texts per API call (default: 20)
 * @param delayMs - Delay between batches in ms (default: 200)
 */
export async function generateEmbeddingsBatched(
  texts: string[],
  batchSize: number = 20,
  delayMs: number = 200
): Promise<number[][]> {
  const allEmbeddings: number[][] = []

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    const embeddings = await generateEmbeddings(batch)
    allEmbeddings.push(...embeddings)

    // Delay between batches to respect rate limits
    if (i + batchSize < texts.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  return allEmbeddings
}

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS }
