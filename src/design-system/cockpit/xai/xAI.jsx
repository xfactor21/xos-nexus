
import React, { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Sparkles } from '@react-three/drei'
import * as THREE from 'three'

// xAI - The Intelligent Core
// True 3D depth: rings go BEHIND and IN FRONT of core
// Prime Core - X logo when neutral, expressive faces otherwise - for xAI software

const EMOTION_CFG = {
  neutral: { type: 'x' },
  happy: { eyeH: 45, eyeW: 34, mouth: 'smile', y: 220 },
  curious: { eyeH: 65, eyeW: 40, mouth: 'small', y: 220 },
  focused: { eyeH: 22, eyeW: 52, mouth: 'flat', y: 235, slant: true },
  excited: { eyeH: 58, eyeW: 38, mouth: 'open', y: 220 },
  thinking: { eyeH: 35, eyeW: 34, mouth: 'small', y: 200 },
  determined: { eyeH: 20, eyeW: 54, mouth: 'flat', y: 240, slant: true },
  playful: { eyeH: 50, eyeW: 34, mouth: 'smile', y: 220, wink: true },
  surprised: { eyeH: 70, eyeW: 42, mouth: 'o', y: 220 },
}

function useFaceTexture(emotion='happy'){
  return useMemo(()=>{
    const c = document.createElement('canvas')
    c.width=512; c.height=512
    const ctx=c.getContext('2d')
    ctx.clearRect(0,0,512,512)
    const cfg = EMOTION_CFG[emotion] || EMOTION_CFG.happy
    
    if(cfg.type==='x'){
      ctx.strokeStyle='#00E5FF'; ctx.lineWidth=24; ctx.lineCap='round'
      ctx.shadowColor='#00E5FF'; ctx.shadowBlur=28
      ctx.beginPath()
      ctx.moveTo(170,170); ctx.lineTo(342,342)
      ctx.moveTo(342,170); ctx.lineTo(170,342)
      ctx.stroke()
    } else {
      ctx.fillStyle='#00E5FF'; ctx.shadowColor='#00E5FF'; ctx.shadowBlur=24
      const y = cfg.y
      // left eye
      if(cfg.wink){
        ctx.beginPath()
        ctx.strokeStyle='#00E5FF'; ctx.lineWidth=10
        ctx.moveTo(120,y+20); ctx.quadraticCurveTo(160,y+2,200,y+20); ctx.stroke()
      } else if(cfg.slant){
        ctx.beginPath()
        ctx.moveTo(110,y-8); ctx.lineTo(200,y+12); ctx.lineTo(190,y+28); ctx.lineTo(100,y+8); ctx.closePath(); ctx.fill()
      } else {
        ctx.beginPath()
        ctx.ellipse(160,y,cfg.eyeW,cfg.eyeH,0,0,Math.PI*2); ctx.fill()
      }
      // right eye
      ctx.beginPath()
      if(cfg.slant){
        ctx.moveTo(312,y+12); ctx.lineTo(402,y-8); ctx.lineTo(412,y+8); ctx.lineTo(322,y+28); ctx.closePath()
      } else {
        ctx.ellipse(352,y,cfg.eyeW,cfg.eyeH,0,0,Math.PI*2)
      }
      ctx.fill()
      // mouth
      ctx.shadowBlur=0; ctx.globalAlpha=0.95
      if(cfg.mouth==='smile'){
        ctx.beginPath(); ctx.strokeStyle='#00E5FF'; ctx.lineWidth=10
        ctx.moveTo(190,340); ctx.quadraticCurveTo(256,395,322,340); ctx.stroke()
      } else if(cfg.mouth==='open'){
        ctx.beginPath(); ctx.fillStyle='#00E5FF'
        ctx.ellipse(256,360,22,32,0,0,Math.PI*2); ctx.fill()
      } else if(cfg.mouth==='o'){
        ctx.beginPath(); ctx.strokeStyle='#00E5FF'; ctx.lineWidth=8
        ctx.ellipse(256,360,18,22,0,0,Math.PI*2); ctx.stroke()
      }
    }
    const t=new THREE.CanvasTexture(c); t.needsUpdate=true; return t
  },[emotion])
}

export default function XAI({ emotion='happy', action='idle', scale=1, position=[0,0,0], autoRotate=true }){
  const group=useRef(), core=useRef(), r1=useRef(), r2=useRef(), r3=useRef()
  const face = useFaceTexture(emotion)
  
  useFrame((state, delta)=>{
    if(!autoRotate) return
    const t=state.clock.elapsedTime
    if(group.current){
      group.current.position.y = position[1] + Math.sin(t*0.8)*0.15
      if(action==='welcoming') group.current.rotation.z = Math.sin(t*2)*0.18
    }
    const m = action==='analyzing'||action==='optimizing' ? 2.5 : action==='celebrating' ? 3 : 1
    if(r1.current) r1.current.rotation.z += delta*0.85*m
    if(r2.current) r2.current.rotation.z -= delta*0.62*m
    if(r3.current) r3.current.rotation.z += delta*1.05*m
    if(core.current && action==='optimizing') core.current.scale.setScalar(1+Math.sin(t*6)*0.06)
  })
  
  return (
    <group ref={group} position={position} scale={scale}>
      {/* Opaque core - this is what makes depth real - rings disappear behind it */}
      <mesh ref={core}>
        <sphereGeometry args={[1.2,64,64]} />
        <meshStandardMaterial color="#02040A" metalness={0.92} roughness={0.18} emissive="#00152A" emissiveIntensity={0.4} />
      </mesh>
      {/* Face slightly in front of core */}
      <mesh position={[0,0.05,1.18]}>
        <planeGeometry args={[1.7,1.7]} />
        <meshBasicMaterial map={face} transparent side={THREE.DoubleSide} />
      </mesh>
      {/* Rings - true 3D, each in its own tilted group so they naturally go behind AND front */}
      <group rotation={[1.2217,0,0]} ref={r1}>
        <mesh><torusGeometry args={[1.92,0.065,16,128]} /><meshBasicMaterial color="#00D4FF" /></mesh>
        <mesh><torusGeometry args={[1.92,0.19,16,128]} /><meshBasicMaterial color="#00AACC" transparent opacity={0.16} depthWrite={false} /></mesh>
      </group>
      <group rotation={[0.35,1.2217,0]} ref={r2}>
        <mesh><torusGeometry args={[2.08,0.06,16,128]} /><meshBasicMaterial color="#7A5CFF" /></mesh>
        <mesh><torusGeometry args={[2.08,0.17,16,128]} /><meshBasicMaterial color="#5A3CCC" transparent opacity={0.14} depthWrite={false} /></mesh>
      </group>
      <group rotation={[2.0,0.6,0.3]} ref={r3}>
        <mesh><torusGeometry args={[1.86,0.055,16,128]} /><meshBasicMaterial color="#00E5FF" /></mesh>
      </group>
      <Sparkles count={36} scale={[3.2,3.2,3.2]} size={0.14} speed={0.5} color="#00D4FF" />
      <group position={[0,-1.28,0]}>
        <mesh position={[-0.26,0,0]}><capsuleGeometry args={[0.085,0.2,4,8]} /><meshStandardMaterial color="#001122" /></mesh>
        <mesh position={[0.26,0,0]}><capsuleGeometry args={[0.085,0.2,4,8]} /><meshStandardMaterial color="#001122" /></mesh>
      </group>
      {action==='launching' && <mesh position={[0,-2.1,0]} rotation={[Math.PI,0,0]}><coneGeometry args={[0.55,2.2,20]} /><meshBasicMaterial color="#00D4FF" transparent opacity={0.72} /></mesh>}
      {action==='optimizing' && <mesh><sphereGeometry args={[1.62,32,32]} /><meshBasicMaterial color="#00D4FF" transparent opacity={0.07} wireframe /></mesh>}
    </group>
  )
}
