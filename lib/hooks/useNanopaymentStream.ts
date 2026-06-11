import { useEffect, useState, useRef } from 'react'
import { type NanopaymentEvent } from '@/lib/db/schema'

export function useNanopaymentStream(workflowId: string, active: boolean) {
  const [events, setEvents] = useState<NanopaymentEvent[]>([])
  const prevEventsLengthRef = useRef(0)
  const [newlyAddedIds, setNewlyAddedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!workflowId) return

    const fetchEvents = async () => {
      try {
        const res = await fetch(`/api/workflow/${workflowId}/nanopayments`)
        if (res.ok) {
          const data = await res.json()
          const fetchedEvents: NanopaymentEvent[] = data.events ?? []
          
          // Compare from the end/start depending on order.
          // Since events are returned ORDER BY created_at DESC, the new events appear at the beginning of the array.
          if (prevEventsLengthRef.current > 0 && fetchedEvents.length > prevEventsLengthRef.current) {
            const numNew = fetchedEvents.length - prevEventsLengthRef.current
            const newItems = fetchedEvents.slice(0, numNew)
            const addedIds = new Set(newItems.map(e => e.id))
            setNewlyAddedIds(prev => {
              const next = new Set(prev)
              addedIds.forEach(id => next.add(id))
              return next
            })
            // Remove flash animation after 2.4s
            setTimeout(() => {
              setNewlyAddedIds(prev => {
                const next = new Set(prev)
                addedIds.forEach(id => next.delete(id))
                return next
              })
            }, 2400)
          }
          
          setEvents(fetchedEvents)
          prevEventsLengthRef.current = fetchedEvents.length
        }
      } catch (err) {
        console.error('[useNanopaymentStream] failed to fetch:', err)
      }
    }

    fetchEvents()

    if (active) {
      const interval = setInterval(fetchEvents, 2000)
      return () => clearInterval(interval)
    }
  }, [workflowId, active])

  const totalUsdcVal = events.reduce((sum, e) => sum + parseFloat(e.amountUsdc || '0'), 0)

  return {
    events,
    newlyAddedIds,
    totalUsdc: totalUsdcVal.toFixed(2),
    callCount: events.length,
  }
}
