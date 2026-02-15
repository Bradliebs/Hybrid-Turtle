import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type TradeTagSeed = {
  tag: string
  category: 'SETUP' | 'ERROR' | 'EXECUTION' | 'MARKET_CONDITION'
  description: string
}

const tags: TradeTagSeed[] = [
  { tag: 'high_conviction', category: 'SETUP', description: 'High-conviction setup with strong alignment across system signals.' },
  { tag: 'pullback_entry', category: 'SETUP', description: 'Entry taken on a pullback continuation setup.' },
  { tag: 'breakout_entry', category: 'SETUP', description: 'Entry taken on a breakout trigger.' },

  { tag: 'revenge_trade', category: 'ERROR', description: 'Emotional trade taken to recover a prior loss.' },
  { tag: 'fomo', category: 'ERROR', description: 'Trade taken due to fear of missing out rather than plan criteria.' },
  { tag: 'gut_override', category: 'ERROR', description: 'Rule-based decision overridden by intuition.' },

  { tag: 'perfect_execution', category: 'EXECUTION', description: 'Execution matched plan with minimal slippage and no hesitation.' },
  { tag: 'poor_fill', category: 'EXECUTION', description: 'Execution quality was poor due to slippage or timing.' },
  { tag: 'hesitated', category: 'EXECUTION', description: 'Execution was delayed despite a valid setup.' },

  { tag: 'regime_bearish', category: 'MARKET_CONDITION', description: 'Trade context occurred under bearish market regime conditions.' },
  { tag: 'high_breadth', category: 'MARKET_CONDITION', description: 'Trade context occurred while market breadth was strong.' },
  { tag: 'low_breadth', category: 'MARKET_CONDITION', description: 'Trade context occurred while market breadth was weak.' },
]

async function main() {
  for (const item of tags) {
    await prisma.tradeTag.upsert({
      where: { tag: item.tag },
      update: {
        category: item.category,
        description: item.description,
      },
      create: {
        tag: item.tag,
        category: item.category,
        description: item.description,
      },
    })
  }

  console.log(`✅ Seeded ${tags.length} trade tags`)
}

main()
  .catch((error) => {
    console.error('❌ Failed to seed trade tags:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
