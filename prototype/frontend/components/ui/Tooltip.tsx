'use client'

import { useState } from 'react'
import { Transition } from '@headlessui/react'

interface TooltipProps {
  content: string
  children: React.ReactNode
  position?: 'top' | 'right' | 'bottom' | 'left'
}

export function Tooltip({ content, children, position = 'top' }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false)

  const positionClasses = {
    top: '-top-2 left-1/2 -translate-x-1/2 -translate-y-full mb-2',
    right: 'top-1/2 left-full -translate-y-1/2 ml-2',
    bottom: '-bottom-2 left-1/2 -translate-x-1/2 translate-y-full mt-2',
    left: 'top-1/2 right-full -translate-y-1/2 mr-2',
  }

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        className="inline-block"
      >
        {children}
      </div>
      <Transition
        show={isVisible}
        enter="transition ease-out duration-200"
        enterFrom="opacity-0 translate-y-1"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in duration-150"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 translate-y-1"
        className={`absolute z-50 ${positionClasses[position]}`}
      >
        <div className="bg-gray-900 text-white text-sm rounded-md py-1 px-2 max-w-xs">
          {content}
          <div
            className={`absolute w-2 h-2 bg-gray-900 transform rotate-45 ${
              position === 'top' ? 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2' :
              position === 'right' ? 'left-0 top-1/2 -translate-y-1/2 -translate-x-1/2' :
              position === 'bottom' ? 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2' :
              'right-0 top-1/2 -translate-y-1/2 translate-x-1/2'
            }`}
          />
        </div>
      </Transition>
    </div>
  )
} 