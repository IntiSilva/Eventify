import React from 'react'
import { describe, expect, it } from 'vitest'
import AnimatedHeight from '@/components/Onboarding/AnimatedHeight'
import { act, renderWithProviders, waitFor } from '@/test/test-utils'

type ResizeObserverCallbackLike = ConstructorParameters<typeof ResizeObserver>[0]

let resizeObserverCallback: ResizeObserverCallbackLike | null = null
let observedElement: Element | null = null

function triggerResize(height: number) {
  if (!resizeObserverCallback || !observedElement) {
    throw new Error('ResizeObserver was not initialized.')
  }

  resizeObserverCallback(
    [
      {
        target: observedElement,
        contentRect: {
          width: 0,
          height,
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: height,
          toJSON: () => ({}),
        },
      } as ResizeObserverEntry,
    ],
    {} as ResizeObserver
  )
}

describe('AnimatedHeight', () => {
  it('mounts a measured shell and updates its animated height when the content size changes', async () => {
    resizeObserverCallback = null
    observedElement = null
    const observerFactory = (callback: ResizeObserverCallbackLike) => {
      resizeObserverCallback = callback

      return {
        observe(element: Element) {
          observedElement = element
        },
        disconnect() {},
      }
    }

    const view = renderWithProviders(
      <AnimatedHeight
        observerFactory={observerFactory}
      >
        <div>Step A</div>
      </AnimatedHeight>
    )

    const shell = view.container.firstElementChild as HTMLElement

    expect(shell).toBeTruthy()
    expect(shell.className).toContain('overflow-hidden')

    await waitFor(() => {
      expect(observedElement).toBeTruthy()
    })

    await act(async () => {
      triggerResize(128)
    })

    await waitFor(() => {
      expect(shell.getAttribute('data-measured-height')).toBe('128')
    })

    view.rerender(
      <AnimatedHeight observerFactory={observerFactory}>
        <div>Step B</div>
      </AnimatedHeight>
    )

    await act(async () => {
      triggerResize(244)
    })

    await waitFor(() => {
      expect(shell.getAttribute('data-measured-height')).toBe('244')
    })
  })
})
