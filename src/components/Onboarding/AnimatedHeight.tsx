'use client'

import { motion, type Transition } from 'motion/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

type AnimatedHeightProps = {
  children: ReactNode
  className?: string
  contentClassName?: string
  observerFactory?: (callback: ResizeObserverCallback) => {
    observe: (element: Element) => void
    disconnect: () => void
  } | null
}

/**
 * Height animation: tween for "glass card" resizing.
 */
const HEIGHT_TRANSITION: Transition = {
  type: 'tween',
  duration: 0.28,
  ease: [0.2, 0.8, 0.2, 1],
}

export default function AnimatedHeight({
  children,
  className,
  contentClassName,
  observerFactory,
}: AnimatedHeightProps) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | null>(null)

  const setMeasuredHeight = useCallback((nextHeight: number) => {
    const rounded = Math.ceil(nextHeight)
    if (rounded <= 0) return
    setHeight((curr) => (curr === rounded ? curr : rounded))
  }, [])

  const measure = useCallback(() => {
    const node = contentRef.current
    if (!node) return
    const next = node.getBoundingClientRect().height
    if (next > 0) setMeasuredHeight(next)
  }, [setMeasuredHeight])

  const onResize = useCallback<ResizeObserverCallback>(
    (entries) => {
      const next = entries[0]?.contentRect?.height
      if (typeof next === 'number') setMeasuredHeight(next)
      else measure()
    },
    [measure, setMeasuredHeight]
  )

  // Measure before first paint so we don't go auto -> number after paint (flicker risk).
  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    const node = contentRef.current
    if (!node) return

    const nativeAvailable = typeof ResizeObserver !== 'undefined'
    const observer =
      observerFactory?.(onResize) ??
      (nativeAvailable ? new ResizeObserver(onResize) : null)

    // If RO exists (factory or native), use it.
    if (observer) {
      observer.observe(node)
      return () => observer.disconnect()
    }

    // Fallback: no ResizeObserver (older browsers / weird env)
    // Re-measure on viewport changes.
    const onWinResize = () => measure()

    window.addEventListener('resize', onWinResize)
    window.addEventListener('orientationchange', onWinResize)

    return () => {
      window.removeEventListener('resize', onWinResize)
      window.removeEventListener('orientationchange', onWinResize)
    }
  }, [measure, observerFactory, onResize])

  return (
    <motion.div
      initial={false}
      data-measured-height={height ?? undefined}
      animate={height === null ? undefined : { height }}
      style={height === null ? { height: 'auto' } : undefined}
      transition={HEIGHT_TRANSITION}
      className={cn('overflow-hidden box-border', className)}
    >
      <div ref={contentRef} className={contentClassName}>
        {children}
      </div>
    </motion.div>
  )
}