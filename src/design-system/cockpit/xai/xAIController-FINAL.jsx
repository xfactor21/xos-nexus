
/**
 * xAI - FINAL CONTROLLER - Your exact mapping
 * No buttons - faces change via setAiStatus()
 * 
 * Your table:
 * 'idle'         -> NEUTRAL      + —
 * 'listening'    -> CURIOUS       + —
 * 'thinking'     -> THINKING      + ANALYZING
 * 'reviewing'    -> CURIOUS       + ANALYZING
 * 'scanning'     -> ANALYZING     + —   (mapped to FOCUSED for face)
 * 'suggesting'   -> FOCUSED       + OPTIMIZING
 * 'building'     -> DETERMINED    + BUILDING
 * 'discovery'    -> EXCITED       + —
 * 'success'      -> HAPPY         + CELEBRATING
 * 'milestone'    -> HAPPY         + LAUNCHING
 * 'error'        -> SURPRISED     + —
 * 'greeting'     -> PLAYFUL       + WELCOMING
 * 'chatting'     -> PLAYFUL       + COLLABORATING
 * 'autonomous'   -> DETERMINED    + OPTIMIZING
 */

import React, { createContext, useContext, useState, useEffect } from 'react'
import XAI from './xAI'

export const xAIContext = createContext({
  emotion: 'neutral',
  action: 'idle',
  status: 'idle',
  setAiStatus: () => {},
})

const STATUS_MAP = {
  idle:         { emotion: 'neutral',    action: 'idle' },
  listening:    { emotion: 'curious',    action: 'idle' },
  thinking:     { emotion: 'thinking',   action: 'analyzing' },
  reviewing:    { emotion: 'curious',    action: 'analyzing' },
  scanning:     { emotion: 'focused',    action: 'analyzing' }, // ANALYZING emotion -> focused face
  suggesting:   { emotion: 'focused',    action: 'optimizing' },
  building:     { emotion: 'determined', action: 'building' },
  discovery:    { emotion: 'excited',   action: 'idle' },
  success:      { emotion: 'happy',      action: 'celebrating' },
  milestone:    { emotion: 'happy',      action: 'launching' },
  error:        { emotion: 'surprised',  action: 'idle' },
  greeting:     { emotion: 'playful',    action: 'welcoming' },
  chatting:     { emotion: 'playful',    action: 'collaborating' },
  autonomous:   { emotion: 'determined', action: 'optimizing' },
}

export function XAIProvider({ children, defaultStatus = 'idle' }) {
  const [status, setStatus] = useState(defaultStatus)
  const [emotion, setEmotion] = useState(STATUS_MAP[defaultStatus]?.emotion || 'neutral')
  const [action, setAction] = useState(STATUS_MAP[defaultStatus]?.action || 'idle')

  const setAiStatus = (newStatus) => {
    const key = String(newStatus).toLowerCase()
    const mapped = STATUS_MAP[key]
    if (mapped) {
      setStatus(key)
      setEmotion(mapped.emotion)
      setAction(mapped.action)
      console.log(`[xAI] ${key} -> ${mapped.emotion.toUpperCase()} + ${mapped.action.toUpperCase()}`)
    } else {
      console.warn(`[xAI] Unknown status: ${newStatus}, using idle`)
      setStatus('idle')
      setEmotion('neutral')
      setAction('idle')
    }
  }

  return (
    <xAIContext.Provider value={{ status, emotion, action, setAiStatus, STATUS_MAP }}>
      {children}
    </xAIContext.Provider>
  )
}

export function useXAI() {
  const ctx = useContext(xAIContext)
  if (!ctx) throw new Error('useXAI must be inside XAIProvider')
  return ctx
}

// The xAI character that auto-changes - put this in your Canvas
export function XAIAuto({ scale = 1.2, position = [0,0,0] }) {
  const { emotion, action } = useXAI()
  return <XAI emotion={emotion} action={action} scale={scale} position={position} />
}

// Invisible brain - watches status prop and updates context
export function XAIBrain({ appStatus }) {
  const { setAiStatus } = useXAI()
  useEffect(() => {
    if (appStatus) setAiStatus(appStatus)
  }, [appStatus])
  return null
}

// Export map for reference
export { STATUS_MAP }
