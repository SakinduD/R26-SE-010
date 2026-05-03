import { cn } from '@/lib/utils'

const EMOTION_COLORS = {
  calm:       'bg-green-100 text-green-700',
  assertive:  'bg-blue-100 text-blue-700',
  anxious:    'bg-yellow-100 text-yellow-700',
  frustrated: 'bg-red-100 text-red-700',
  confused:   'bg-gray-100 text-gray-700',
}

export default function ChatBubble({ role, message, emotion, npcRole }) {
  const isNpc = role === 'npc'

  return (
    <div className={cn('flex', isNpc ? 'justify-start' : 'justify-end')}>
      <div className={cn('flex flex-col max-w-[75%]', isNpc ? 'items-start' : 'items-end')}>
        {isNpc && npcRole && (
          <span className="text-xs text-gray-400 mb-1 ml-1 font-medium">{npcRole}</span>
        )}
        <div className={cn(
          'rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isNpc ? 'bg-gray-800 text-white' : 'bg-blue-600 text-white'
        )}>
          {message}
        </div>
        {!isNpc && emotion && (
          <span className={cn(
            'mt-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
            EMOTION_COLORS[emotion] ?? EMOTION_COLORS.confused
          )}>
            {emotion}
          </span>
        )}
      </div>
    </div>
  )
}
