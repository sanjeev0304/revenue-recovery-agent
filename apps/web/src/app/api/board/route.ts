import { NextResponse } from 'next/server'
import { loadBoard } from '@/lib/board'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    const board = await loadBoard()
    return NextResponse.json(board)
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message.slice(0, 200) },
      { status: 500 },
    )
  }
}
