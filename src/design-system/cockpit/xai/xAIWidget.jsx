
/**
 * xAI Widget - SIMPLEST WAY TO USE xAI IN YOUR APP
 * Just import this and use <XAIWidget status="thinking" />
 * No context, no provider needed for basic use
 */

import React from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import XAI from './xAI'
import { XAIProvider, XAIAuto, XAIBrain } from './xAIController-FINAL'

// SUPER SIMPLE - Use this if you want 1 line usage
export function XAIWidget({ status = 'idle', style = {}, scale = 1.1 }) {
  return (
    <XAIProvider defaultStatus={status}>
      <XAIBrain appStatus={status} />
      <div style={{ width: '400px', height: '400px', background: '#040812', borderRadius: '24px', ...style }}>
        <Canvas camera={{ position: [0, 1.2, 4.5], fov: 50 }}>
          <ambientLight intensity={0.6} />
          <pointLight position={[5,5,5]} intensity={2} color="#00D4FF" />
          <pointLight position={[-5,-3,-4]} intensity={1.2} color="#7A5CFF" />
          <XAIAuto scale={scale} />
          <OrbitControls enablePan={false} enableZoom={false} />
        </Canvas>
      </div>
    </XAIProvider>
  )
}

// If you already have Canvas in your app, use this even simpler:
export function XAICharacter({ status = 'idle', scale = 1.2 }) {
  return (
    <XAIProvider defaultStatus={status}>
      <XAIBrain appStatus={status} />
      <XAIAuto scale={scale} />
    </XAIProvider>
  )
}

export default XAIWidget
