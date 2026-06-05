'use client'

import React, { useState, useEffect, useRef } from 'react'

export default function PreviewPage() {
  // Simulator states to demonstrate dynamic glowing active/completed states in real-time
  const [completedSteps, setCompletedSteps] = useState(1)
  const [percent, setPercent] = useState(33)
  const [executing, setExecuting] = useState(true)
  const [logs, setLogs] = useState<string[]>([
    'Fetching data from source...',
    'Pre-processing batch 5...',
    'Pre-processing batch 5...',
    'Pre-processing batch 5...',
    'Pre-processing batch 5...',
    'Model optimization: Epoch 34/50',
    'Model optimization: Epoch 34/50 - accuracy 92.4%',
    'Fetching data from source...',
    'Pre-processing batch 5...',
    'Model optimization: Epoch 34/50',
    'Model optimization: Epoch 34/50 - accuracy 92.4%',
    'Fetching data from source...',
    'Model optimization: Epoch 34/50 - accuracy 92.4%',
    'Model optimization: Epoch 34/50 - accuracy 92.4%',
    'Model optimization: Epoch 34/50 - accuracy 92.4%'
  ])

  const terminalEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll terminal logs
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  // Simulation execution loop to show off the neon active flows automatically
  useEffect(() => {
    const timer1 = setTimeout(() => {
      setLogs(prev => [...prev, 'Model optimization: Epoch 38/50 - accuracy 93.1%'])
    }, 4000)

    const timer2 = setTimeout(() => {
      setCompletedSteps(2)
      setPercent(66)
      setLogs(prev => [
        ...prev,
        'Model optimization: Epoch 45/50 - accuracy 94.2%',
        'Node [Model Training] finished. Dispatching telemetry to [Model Reasoning]...'
      ])
    }, 8000)

    const timer3 = setTimeout(() => {
      setCompletedSteps(3)
      setPercent(100)
      setExecuting(false)
      setLogs(prev => [
        ...prev,
        'Model optimization: Epoch 50/50 - accuracy 96.8%',
        'Node [Deploy] activated on Arc Testnet successfully!',
        'guest@gigawork:~$ _'
      ])
    }, 12000)

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      clearTimeout(timer3)
    }
  }, [])

  const restartSimulation = () => {
    setCompletedSteps(1)
    setPercent(33)
    setExecuting(true)
    setLogs([
      'Fetching data from source...',
      'Pre-processing batch 5...',
      'Pre-processing batch 5...',
      'Pre-processing batch 5...',
      'Pre-processing batch 5...',
      'Model optimization: Epoch 34/50',
      'Model optimization: Epoch 34/50 - accuracy 92.4%',
      'Fetching data from source...',
      'Pre-processing batch 5...',
      'Model optimization: Epoch 34/50',
      'Model optimization: Epoch 34/50 - accuracy 92.4%',
      'Fetching data from source...',
      'Model optimization: Epoch 34/50 - accuracy 92.4%'
    ])
  }

  const rawCss = `
    .gw-preview-root {
      font-family: 'Outfit', sans-serif !important;
      background: radial-gradient(circle at 50% 50%, #0d0926 0%, #030206 100%) !important;
      color: #e2e8f0 !important;
      height: 100vh !important;
      width: 100vw !important;
      overflow: hidden !important;
      display: flex !important;
      flex-direction: column !important;
      position: relative;
    }

    .gw-preview-root * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* Custom neon high-fidelity scrollbar */
    .gw-preview-root ::-webkit-scrollbar { width: 4px; height: 4px; }
    .gw-preview-root ::-webkit-scrollbar-track { background: transparent; }
    .gw-preview-root ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 99px;
    }
    .gw-preview-root ::-webkit-scrollbar-thumb:hover {
      background: #00f0ff;
      box-shadow: 0 0 8px #00f0ff;
    }

    /* 1. FUTURISTIC EDGE-TO-EDGE HEADER */
    .gw-header {
      height: 70px;
      background: rgba(8, 6, 17, 0.85);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 28px;
      z-index: 50;
      flex-shrink: 0;
    }

    .gw-logo {
      display: flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
    }
    .gw-logo-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #00f0ff, #7c3aed);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 15px rgba(0, 240, 255, 0.4);
    }
    .gw-logo-text {
      font-weight: 800;
      font-size: 22px;
      letter-spacing: 0.5px;
      color: white;
    }

    .gw-nav-pills {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .gw-nav-pill {
      background: rgba(10, 8, 20, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.05);
      padding: 6px 14px;
      border-radius: 99px;
      font-size: 11px;
      font-family: 'Share Tech Mono', monospace;
      display: flex;
      align-items: center;
      gap: 6px;
      color: rgba(255, 255, 255, 0.45);
    }
    .gw-nav-pill.glow-green {
      border: 1px solid rgba(0, 230, 118, 0.25);
      background: rgba(0, 230, 118, 0.04);
      color: rgba(255, 255, 255, 0.8);
      box-shadow: inset 0 0 8px rgba(0, 230, 118, 0.05), 0 0 10px rgba(0, 230, 118, 0.05);
    }
    .gw-nav-pill-value-green {
      color: #00e676;
      font-weight: 700;
    }
    .gw-nav-pill-value-gray {
      color: rgba(255, 255, 255, 0.4);
    }

    .gw-header-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .gw-badge-usdc {
      background: rgba(0, 240, 255, 0.04);
      border: 1px solid rgba(0, 240, 255, 0.25);
      padding: 8px 18px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      color: white;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 0 15px rgba(0, 240, 255, 0.1);
      transition: all 0.2s;
      cursor: pointer;
    }
    .gw-badge-usdc:hover {
      box-shadow: 0 0 20px rgba(0, 240, 255, 0.25);
      border-color: rgba(0, 240, 255, 0.4);
    }
    .gw-badge-usdc-symbol {
      width: 18px;
      height: 18px;
      background: #00f0ff;
      color: #030208;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 900;
    }
    .gw-bell-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer;
      position: relative;
      transition: all 0.2s;
    }
    .gw-bell-btn:hover {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.15);
      color: white;
    }
    .gw-bell-dot {
      position: absolute;
      top: 0px;
      right: 0px;
      width: 8px;
      height: 8px;
      background: #ff5f56;
      border-radius: 50%;
      box-shadow: 0 0 8px #ff5f56;
    }
    .gw-avatar-container {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }
    .gw-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      overflow: hidden;
      border: 1.5px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 0 8px rgba(0,0,0,0.5);
    }
    .gw-chevron {
      color: rgba(255, 255, 255, 0.4);
      font-size: 10px;
    }

    /* 2. LAYOUT SHELL (Stretching full height of viewport) */
    .gw-main-shell {
      display: flex;
      flex: 1;
      height: calc(100vh - 70px);
      overflow: hidden;
    }

    /* Left AppRail */
    .gw-app-rail {
      width: 70px;
      background: #050408;
      border-right: 1px solid rgba(255, 255, 255, 0.05);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px 0;
      gap: 20px;
      position: relative;
      flex-shrink: 0;
    }
    .gw-app-rail::after {
      content: '';
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: 1px;
      background: linear-gradient(180deg, #7c3aed, #00f0ff);
      opacity: 0.6;
    }
    .gw-rail-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255, 255, 255, 0.45);
      cursor: pointer;
      transition: all 0.2s;
      border: 1px solid transparent;
      position: relative;
    }
    .gw-rail-icon:hover {
      color: rgba(255, 255, 255, 0.95);
      background: rgba(255, 255, 255, 0.03);
    }
    .gw-rail-icon.active {
      color: #00f0ff;
      border-color: rgba(0, 240, 255, 0.15);
      background: rgba(124, 58, 237, 0.1);
      box-shadow: inset 0 0 12px rgba(124, 58, 237, 0.12), 0 0 15px rgba(0, 240, 255, 0.05);
    }
    .gw-rail-indicator {
      position: absolute;
      left: 0;
      top: 10px;
      bottom: 10px;
      width: 3px;
      background: linear-gradient(180deg, #7c3aed, #00f0ff);
      border-radius: 0 4px 4px 0;
      box-shadow: 0 0 8px #7c3aed;
    }

    /* History Sidebar */
    .gw-history-sidebar {
      width: 290px;
      background: rgba(9, 7, 18, 0.45);
      border-right: 1px solid rgba(255, 255, 255, 0.05);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .gw-sidebar-header {
      padding: 20px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }
    .gw-sidebar-title {
      font-size: 15px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: white;
    }
    .gw-history-list {
      flex: 1;
      overflow-y: auto;
      padding: 16px 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .gw-history-card {
      background: rgba(255, 255, 255, 0.015);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 12px;
      padding: 14px 16px;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: relative;
    }
    .gw-history-card:hover {
      background: rgba(255, 255, 255, 0.035);
      border-color: rgba(255, 255, 255, 0.08);
      transform: translateY(-1px);
    }
    .gw-history-card-details {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
    }
    .gw-history-card.active {
      background: rgba(0, 240, 255, 0.03);
      border-color: rgba(0, 240, 255, 0.35);
      box-shadow: inset 0 0 15px rgba(0, 240, 255, 0.06), 0 0 25px rgba(0, 240, 255, 0.05);
    }
    .gw-history-card-title {
      font-size: 13px;
      font-weight: 600;
      color: white;
    }
    .gw-history-card-status {
      font-size: 11px;
      font-family: 'Share Tech Mono', monospace;
    }
    .gw-history-card-status.success { color: #00e676; }
    .gw-history-card-status.running { color: #ffcc4d; }
    
    .gw-history-arrow {
      color: rgba(255, 255, 255, 0.2);
      transition: all 0.2s;
      margin-left: 8px;
      font-size: 11px;
    }
    .gw-history-card:hover .gw-history-arrow {
      color: rgba(255, 255, 255, 0.6);
      transform: translateX(2px);
    }
    .gw-active-indicator-container {
      width: 24px;
      height: 24px;
      background: rgba(0, 240, 255, 0.08);
      border: 1px solid rgba(0, 240, 255, 0.25);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }
    .gw-active-pulse-dot {
      width: 6px;
      height: 6px;
      background: #00f0ff;
      border-radius: 50%;
      box-shadow: 0 0 8px #00f0ff;
      animation: pulse-ring 1.8s cubic-bezier(0.215, 0.610, 0.355, 1) infinite;
    }

    /* Main Workspace Shell */
    .gw-main-workspace-shell {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: #030206;
    }

    /* Top Half: DAG Canvas */
    .gw-canvas-pane {
      height: 48%;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      position: relative;
      background: rgba(4, 3, 10, 0.45);
      display: flex;
      flex-direction: column;
    }
    .gw-canvas-pane-header {
      padding: 14px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      z-index: 10;
    }
    .gw-canvas-pane-title {
      font-size: 13px;
      font-weight: 700;
      color: white;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .gw-canvas-dropdown {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 4px 12px;
      border-radius: 6px;
      font-size: 11px;
      font-family: 'Outfit', sans-serif;
      color: rgba(255, 255, 255, 0.6);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .gw-canvas-dropdown:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.15);
      color: white;
    }

    .gw-canvas-pane-area {
      flex: 1;
      position: relative;
      overflow: hidden;
      /* Glowing grid dot pattern - very crisp */
      background-image: radial-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 0);
      background-size: 20px 20px;
    }

    /* Fixed container centering the DAG perfectly to avoid resizing anomalies */
    .gw-dag-fixed-container {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 1000px;
      height: 340px;
      pointer-events: none;
      z-index: 2;
    }
    .gw-dag-fixed-container * {
      pointer-events: auto;
    }

    /* SVG Curved Connectors */
    .gw-canvas-svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1;
    }
    .gw-canvas-line {
      fill: none;
      stroke-linecap: round;
      transition: all 0.3s;
    }
    .gw-canvas-line.blue-glow {
      stroke: #00f0ff;
      stroke-width: 2px;
      filter: drop-shadow(0 0 5px rgba(0, 240, 255, 0.5));
    }
    .gw-canvas-line.blue-glow.active {
      stroke-dasharray: 6 5;
      animation: flow-active 1.2s linear infinite;
    }
    .gw-canvas-line.green-glow {
      stroke: #00e676;
      stroke-width: 2px;
      filter: drop-shadow(0 0 5px rgba(0, 230, 118, 0.5));
    }
    .gw-canvas-line.purple-glow {
      stroke: #c084fc;
      stroke-width: 2px;
      filter: drop-shadow(0 0 5px rgba(192, 132, 252, 0.4));
    }
    .gw-canvas-line.telemetry {
      stroke: #00e676;
      stroke-width: 1.5px;
      opacity: 0.85;
      filter: drop-shadow(0 0 4px rgba(0, 230, 118, 0.4));
    }

    /* DAG Nodes styled as premium capsules */
    .gw-dag-node {
      position: absolute;
      background: rgba(6, 4, 15, 0.8);
      backdrop-filter: blur(12px);
      border: 1.5px solid rgba(255, 255, 255, 0.08);
      border-radius: 99px;
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.85);
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.6);
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 5;
    }
    .gw-dag-node:hover {
      transform: translateY(-2px);
      color: white;
    }
    
    /* Glowing Port Anchor Dots sitting directly on borders */
    .gw-port-dot {
      position: absolute;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 8px currentColor;
    }
    .gw-port-dot.top {
      top: -4px;
      left: 50%;
      transform: translateX(-50%);
    }
    .gw-port-dot.bottom {
      bottom: -4px;
      left: 50%;
      transform: translateX(-50%);
    }
    .gw-port-dot.left {
      left: -4px;
      top: 50%;
      transform: translateY(-50%);
    }
    .gw-port-dot.right {
      right: -4px;
      top: 50%;
      transform: translateY(-50%);
    }

    .gw-dag-node.blue {
      border-color: rgba(0, 240, 255, 0.35);
      color: #00f0ff;
      box-shadow: inset 0 0 10px rgba(0, 240, 255, 0.05), 0 0 15px rgba(0, 240, 255, 0.08);
    }
    .gw-dag-node.blue:hover {
      border-color: #00f0ff;
      box-shadow: inset 0 0 12px rgba(0, 240, 255, 0.1), 0 0 25px rgba(0, 240, 255, 0.25);
    }
    .gw-dag-node.green {
      border-color: rgba(0, 230, 118, 0.35);
      color: #00e676;
      box-shadow: inset 0 0 10px rgba(0, 230, 118, 0.05), 0 0 15px rgba(0, 230, 118, 0.08);
    }
    .gw-dag-node.green:hover {
      border-color: #00e676;
      box-shadow: inset 0 0 12px rgba(0, 230, 118, 0.1), 0 0 25px rgba(0, 230, 118, 0.25);
    }
    .gw-dag-node.purple {
      border-color: rgba(124, 58, 237, 0.35);
      color: #c084fc;
      box-shadow: inset 0 0 10px rgba(124, 58, 237, 0.05), 0 0 15px rgba(124, 58, 237, 0.08);
    }
    .gw-dag-node.purple:hover {
      border-color: #c084fc;
      box-shadow: inset 0 0 12px rgba(124, 58, 237, 0.1), 0 0 25px rgba(124, 58, 237, 0.25);
    }

    /* Highlight Active Node Pulse (Breathes dynamically) */
    .gw-dag-node.active-glow {
      animation: breathe-node 2.2s infinite ease-in-out;
    }

    /* Bottom Half splits side-by-side stretching all the way to bottom edge */
    .gw-bottom-pane {
      flex: 1;
      display: flex;
      overflow: hidden;
      background: #030206;
    }

    /* CLI Terminal Console */
    .gw-terminal-column {
      flex: 1;
      border-right: 1px solid rgba(255, 255, 255, 0.05);
      background: #040306;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }
    .gw-terminal-titlebar {
      height: 38px;
      background: rgba(10, 8, 20, 0.7);
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      flex-shrink: 0;
    }
    .gw-terminal-dots {
      display: flex;
      gap: 6px;
    }
    .gw-terminal-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    .gw-terminal-dot.close { background: #ff5f56; }
    .gw-terminal-dot.min { background: #ffbd2e; }
    .gw-terminal-dot.max { background: #27c93f; }

    .gw-terminal-tab-title {
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.45);
      letter-spacing: 0.5px;
    }

    .gw-terminal-content {
      flex: 1;
      overflow-y: auto;
      padding: 20px 24px;
      font-family: 'Share Tech Mono', monospace;
      font-size: 12px;
      line-height: 1.6;
      color: #39ff14;
      text-shadow: 0 0 5px rgba(57, 255, 20, 0.5);
      position: relative;
      z-index: 5;
    }
    
    /* CRT Scanline and Vignette Effects */
    .gw-terminal-content::before {
      content: " ";
      display: block;
      position: absolute;
      top: 0; left: 0; bottom: 0; right: 0;
      background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(0, 240, 255, 0.02), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.02));
      z-index: 10;
      background-size: 100% 3px, 6px 100%;
      pointer-events: none;
    }
    .gw-terminal-scanline {
      width: 100%;
      height: 4px;
      background: rgba(0, 240, 255, 0.03);
      position: absolute;
      animation: scanline-scroll 6s linear infinite;
      z-index: 11;
      pointer-events: none;
    }

    .gw-log-row {
      display: flex;
      align-items: start;
      gap: 8px;
      margin-bottom: 4px;
    }
    .gw-log-content.success { 
      color: #39ff14; 
      text-shadow: 0 0 5px rgba(57, 255, 20, 0.55); 
    }
    .gw-log-content.system { 
      color: #39ff14; 
    }

    .gw-terminal-cursor {
      width: 7px;
      height: 12px;
      background: #00f0ff;
      display: inline-block;
      margin-left: 4px;
      animation: cursor-blink 0.85s steps(2) infinite;
      box-shadow: 0 0 6px #00f0ff;
    }

    /* AI Team Progress column */
    .gw-progress-sidebar {
      width: 330px;
      background: #050408;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      overflow-y: auto;
      padding: 20px;
      gap: 16px;
    }
    .gw-progress-header {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .gw-progress-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .gw-sidebar-ai-team-title {
      font-size: 13px;
      font-weight: 700;
      color: white;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .gw-sidebar-ai-team-dots {
      color: rgba(255, 255, 255, 0.4);
      cursor: pointer;
    }
    .gw-progress-subtitle {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.4);
      font-family: 'Outfit', sans-serif;
    }
    .gw-master-bar {
      height: 7px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 99px;
      overflow: hidden;
      margin-top: 4px;
    }
    .gw-master-fill {
      height: 100%;
      background: linear-gradient(90deg, #00f0ff, #00e676);
      border-radius: 99px;
      box-shadow: 0 0 10px rgba(0, 240, 255, 0.4);
      transition: width 0.6s ease-out;
    }

    /* Agent Cards exactly matching mockup layout */
    .gw-agent-cards-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .gw-agent-card {
      background: rgba(255, 255, 255, 0.015);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 12px;
      padding: 14px;
      display: flex;
      align-items: center;
      gap: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .gw-agent-card:hover {
      background: rgba(255, 255, 255, 0.03);
      border-color: rgba(255, 255, 255, 0.08);
    }
    
    .gw-agent-icon-box {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      background: rgba(10, 8, 20, 0.7);
      border: 1.5px solid rgba(255, 255, 255, 0.06);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.2s;
    }
    .gw-agent-card:hover .gw-agent-icon-box {
      border-color: currentColor;
    }
    .gw-agent-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .gw-agent-row-one {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .gw-agent-card-title {
      font-size: 13px;
      font-weight: 700;
      color: white;
    }
    .gw-agent-status-label {
      font-size: 10px;
      font-family: 'Share Tech Mono', monospace;
      font-weight: 600;
    }
    .gw-agent-status-label.percent { color: #00f0ff; }
    .gw-agent-status-label.active { color: #00e676; }

    .gw-agent-card-subtitle {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.4);
    }
    .gw-agent-bar {
      height: 4px;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 99px;
      overflow: hidden;
      width: 100%;
    }
    .gw-agent-fill {
      height: 100%;
      border-radius: 99px;
      box-shadow: 0 0 6px currentColor;
    }

    /* Animation Keyframes */
    @keyframes breathe-node {
      0%, 100% { 
        box-shadow: inset 0 0 10px rgba(0, 240, 255, 0.06), 0 0 15px rgba(0, 240, 255, 0.1); 
        border-color: rgba(0, 240, 255, 0.4); 
      }
      50% { 
        box-shadow: inset 0 0 15px rgba(0, 240, 255, 0.12), 0 0 28px rgba(0, 240, 255, 0.35); 
        border-color: #00f0ff; 
      }
    }
    @keyframes pulse-ring {
      0% { transform: scale(0.9); opacity: 0.9; }
      50% { transform: scale(1.15); opacity: 1; box-shadow: 0 0 12px #00f0ff; }
      100% { transform: scale(0.9); opacity: 0.9; }
    }
    @keyframes cursor-blink {
      0%, 49% { opacity: 1 }
      50%, 100% { opacity: 0 }
    }
    @keyframes scanline-scroll {
      0% { top: -6px; }
      100% { top: 100%; }
    }
    @keyframes flow-active {
      stroke-dashoffset: -20;
    }
  `

  return (
    <div className="gw-preview-root">
      {/* Dynamic Font Loading */}
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=Share+Tech+Mono&display=swap" rel="stylesheet" />
      
      {/* Dynamic Style Injection */}
      <style dangerouslySetInnerHTML={{ __html: rawCss }} />

      {/* 1. TOP HEADER */}
      <header className="gw-header">
        <div className="gw-logo">
          <div className="gw-logo-icon">
            <svg viewBox="0 0 32 32" fill="none" className="w-5 h-5">
              <path d="M22 16A6 6 0 1 1 16 10h6v3h-6a3 3 0 1 0 3 3v-1h3v4z" fill="white" />
            </svg>
          </div>
          <span className="gw-logo-text">GigaWork</span>
        </div>
        
        <div className="gw-nav-pills">
          <div className="gw-nav-pill glow-green">
            Network: <span className="gw-nav-pill-value-green">Optimal</span>
          </div>
          <div className="gw-nav-pill glow-green">
            Latency: <span className="gw-nav-pill-value-green">12ms</span>
          </div>
          <div className="gw-nav-pill glow-green">
            Retant: <span className="gw-nav-pill-value-green">27ms</span>
          </div>
          <div className="gw-nav-pill">
            Ops\wt: <span className="gw-nav-pill-value-gray">13s</span>
          </div>
        </div>
        
        <div className="gw-header-right">
          <div className="gw-badge-usdc" onClick={restartSimulation}>
            <span className="gw-badge-usdc-symbol">$</span>
            $34,567.89 USDC
          </div>
          <div className="gw-bell-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="gw-bell-dot" />
          </div>
          <div className="gw-avatar-container">
            <div className="gw-avatar">
              <svg viewBox="0 0 40 40" width="100%" height="100%">
                <rect fill="#1e1b4b" width="40" height="40" />
                <circle cx="20" cy="16" r="8" fill="#fbcfe8" />
                <path d="M10 32c0-6 4-10 10-10s10 4 10 10" fill="#f472b6" />
              </svg>
            </div>
            <span className="gw-chevron">▼</span>
          </div>
        </div>
      </header>

      {/* 2. MAIN SYSTEM CENTER */}
      <div className="gw-main-shell">
        
        {/* LEFT APPRail */}
        <aside className="gw-app-rail">
          <div className="gw-rail-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
              <path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3m10-11v11a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="gw-rail-icon active">
            <div className="gw-rail-indicator" />
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
              <circle cx="12" cy="5" r="3" />
              <circle cx="5" cy="18" r="3" />
              <circle cx="19" cy="18" r="3" />
              <path d="M10 7.5L6.5 15.5M14 7.5L17.5 15.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="gw-rail-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
              <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="gw-rail-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm14 10v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="gw-rail-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" strokeLinecap="round" />
            </svg>
          </div>
          <div className="gw-rail-icon" style={{ marginTop: 'auto' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="gw-rail-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </aside>
        
        {/* MIDDLE HISTORY SIDEBAR */}
        <aside className="gw-history-sidebar">
          <div className="gw-sidebar-header">
            <h3 className="gw-sidebar-title">History</h3>
            <span style={{ cursor: 'pointer', opacity: 0.6, fontSize: '14px', letterSpacing: '2px' }}>•••</span>
          </div>
          <div className="gw-history-list">
            <div className="gw-history-card">
              <div className="gw-history-card-details">
                <span className="gw-history-card-title">Data Analysis - Run #491</span>
                <span className="gw-history-card-status success">7:35 AM (Success)</span>
              </div>
              <span className="gw-history-arrow">▶</span>
            </div>
            <div className="gw-history-card">
              <div className="gw-history-card-details">
                <span className="gw-history-card-title">Data Analysis - Run #492</span>
                <span className="gw-history-card-status success">7:35 AM (Success)</span>
              </div>
              <span className="gw-history-arrow">▶</span>
            </div>
            <div className="gw-history-card">
              <div className="gw-history-card-details">
                <span className="gw-history-card-title">Data Analysis - Run #491</span>
                <span className="gw-history-card-status success">7:35 AM (Success)</span>
              </div>
              <span className="gw-history-arrow">▶</span>
            </div>
            <div className="gw-history-card">
              <div className="gw-history-card-details">
                <span className="gw-history-card-title">Model Training - Run #492</span>
                <span className="gw-history-card-status running">7:35 AM (Running)</span>
              </div>
              <span className="gw-history-arrow">▶</span>
            </div>
            
            {/* Active Running Card */}
            <div className="gw-history-card active">
              <div className="gw-history-card-details">
                <span className="gw-history-card-title">Model Training - Run #491</span>
                <span className="gw-history-card-status running">7:35 AM (Running)</span>
              </div>
              <div className="gw-active-indicator-container">
                <div className="gw-active-pulse-dot" />
              </div>
            </div>

            <div className="gw-history-card">
              <div className="gw-history-card-details">
                <span className="gw-history-card-title">Data Analysis - Run #490</span>
                <span className="gw-history-card-status success">7:35 AM (Success)</span>
              </div>
              <span className="gw-history-arrow">▶</span>
            </div>
            <div className="gw-history-card">
              <div className="gw-history-card-details">
                <span className="gw-history-card-title">Model Training - Run #497</span>
                <span className="gw-history-card-status success">7:35 AM (Success)</span>
              </div>
              <span className="gw-history-arrow">▶</span>
            </div>
            <div className="gw-history-card">
              <div className="gw-history-card-details">
                <span className="gw-history-card-title">Data Analysis - Run #498</span>
                <span className="gw-history-card-status success">7:38 AM (Success)</span>
              </div>
              <span className="gw-history-arrow">▶</span>
            </div>
          </div>
        </aside>
        
        {/* RIGHT COLUMN: WORKSPACE */}
        <div className="gw-main-workspace-shell">
          
          {/* Top Half: Neural Network DAG Canvas */}
          <div className="gw-canvas-pane">
            <div className="gw-canvas-pane-header">
              <h4 className="gw-canvas-pane-title">DAG canvas</h4>
              <div className="gw-canvas-dropdown">
                Ant workflow <span>▼</span>
              </div>
            </div>
            
            <div className="gw-canvas-pane-area">
              {/* Centered Fixed Coordinate Container for 100% layout fidelity */}
              <div className="gw-dag-fixed-container">
                <svg className="gw-canvas-svg" viewBox="0 0 1000 340">
                  <defs>
                    {/* SVG Hardware-Accelerated Ambient Radial Gradients exactly matching mockup glows */}
                    <radialGradient id="glow-cyan" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.12" />
                      <stop offset="60%" stopColor="#00f0ff" stopOpacity="0.02" />
                      <stop offset="100%" stopColor="#00f0ff" stopOpacity="0" />
                    </radialGradient>
                    <radialGradient id="glow-purple" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.1" />
                      <stop offset="70%" stopColor="#7c3aed" stopOpacity="0.01" />
                      <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
                    </radialGradient>

                    {/* SVG Arrowhead Markers for connection lines */}
                    <marker id="arrow-green" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 2.5 L 7 5 L 0 7.5 z" fill="#00e676" />
                    </marker>
                    <marker id="arrow-cyan" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 2.5 L 7 5 L 0 7.5 z" fill="#00f0ff" />
                    </marker>
                    <marker id="arrow-purple" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 2.5 L 7 5 L 0 7.5 z" fill="#c084fc" />
                    </marker>
                  </defs>

                  {/* High-Performance Neon backing clouds */}
                  <ellipse cx="280" cy="170" rx="280" ry="170" fill="url(#glow-cyan)" />
                  <ellipse cx="700" cy="170" rx="260" ry="170" fill="url(#glow-purple)" />

                  {/* Curve 1: Data Ingest -> Pre-process (with active telemetry wave) */}
                  <path 
                    className="gw-canvas-line blue-glow" 
                    d="M 150,169 C 170,150 200,150 220,169" 
                  />
                  {/* Neon Telemetry Oscillograph Signal Overlay on Curve 1 */}
                  <path 
                    className="gw-canvas-line telemetry" 
                    d="M 170,164 L 175,164 L 178,156 L 181,172 L 184,148 L 187,176 L 190,158 L 193,164 L 199,164" 
                  />

                  {/* Curve 2: Data Ingest -> Model Training (High active glow arching path) */}
                  <path 
                    className={`gw-canvas-line blue-glow ${completedSteps >= 2 ? '' : 'active'}`} 
                    d="M 95,150 C 130,20 420,20 515,150" 
                  />

                  {/* Curve 3: Pre-process -> Model Training */}
                  <path 
                    className="gw-canvas-line blue-glow" 
                    d="M 330,169 C 360,140 420,140 450,169" 
                  />

                  {/* Curve 4: Pre-process -> Model Reasoning */}
                  <path 
                    className="gw-canvas-line green-glow" 
                    d="M 330,169 C 360,200 410,250 450,279" 
                  />

                  {/* Curve 5: Model Training -> Model Reasoning (Vertical arrow straight down) */}
                  <path 
                    className="gw-canvas-line green-glow" 
                    d="M 515,188 L 515,260"
                    markerEnd="url(#arrow-green)"
                  />

                  {/* Curve 6: Model Training -> Evaluation */}
                  <path 
                    className={`gw-canvas-line blue-glow ${executing && completedSteps === 2 ? 'active' : ''}`} 
                    d="M 580,169 C 610,145 650,145 680,169" 
                    markerEnd="url(#arrow-cyan)"
                  />

                  {/* Curve 7: Model Reasoning -> Evaluation */}
                  <path 
                    className={`gw-canvas-line blue-glow ${executing && completedSteps === 2 ? 'active' : ''}`} 
                    d="M 580,279 C 610,270 650,220 680,169" 
                    markerEnd="url(#arrow-cyan)"
                  />

                  {/* Curve 8: Evaluation -> Deploy */}
                  <path 
                    className="gw-canvas-line purple-glow" 
                    d="M 790,169 C 810,150 850,150 880,169" 
                    markerEnd="url(#arrow-purple)"
                  />

                  {/* Curve 9: Model Reasoning -> Deploy */}
                  <path 
                    className="gw-canvas-line purple-glow" 
                    d="M 580,279 C 690,320 810,265 880,169" 
                    markerEnd="url(#arrow-purple)"
                  />
                </svg>

                {/* 6 Blueprint Nodes matching image exact layout and width specs */}
                <div className="gw-dag-node blue" style={{ left: '40px', top: '150px', width: '110px' }}>
                  Data Ingest
                  <span className="gw-port-dot right" style={{ color: '#00f0ff' }} />
                </div>
                
                <div className={`gw-dag-node green ${executing && completedSteps === 1 ? 'active-glow' : ''}`} style={{ left: '220px', top: '150px', width: '110px' }}>
                  Pre-process
                  <span className="gw-port-dot left" style={{ color: '#00e676' }} />
                  <span className="gw-port-dot top" style={{ color: '#00e676' }} />
                  <span className="gw-port-dot bottom" style={{ color: '#00e676' }} />
                </div>
                
                <div className={`gw-dag-node blue ${executing && completedSteps === 1 ? 'active-glow' : ''}`} style={{ left: '450px', top: '150px', width: '130px' }}>
                  Model Training
                  <span className="gw-port-dot left" style={{ color: '#00f0ff' }} />
                  <span className="gw-port-dot top" style={{ color: '#00f0ff' }} />
                  <span className="gw-port-dot bottom" style={{ color: '#00f0ff' }} />
                </div>
                
                <div className="gw-dag-node blue" style={{ left: '450px', top: '260px', width: '130px' }}>
                  Model Reasoning
                  <span className="gw-port-dot left" style={{ color: '#00f0ff' }} />
                  <span className="gw-port-dot top" style={{ color: '#00f0ff' }} />
                  <span className="gw-port-dot right" style={{ color: '#00f0ff' }} />
                </div>
                
                <div className={`gw-dag-node purple ${executing && completedSteps === 2 ? 'active-glow' : ''}`} style={{ left: '680px', top: '150px', width: '110px' }}>
                  Evaluation
                  <span className="gw-port-dot left" style={{ color: '#c084fc' }} />
                  <span className="gw-port-dot top" style={{ color: '#c084fc' }} />
                </div>
                
                <div className="gw-dag-node purple" style={{ left: '880px', top: '150px', width: '100px' }}>
                  Deploy
                  <span className="gw-port-dot left" style={{ color: '#c084fc' }} />
                  <span className="gw-port-dot top" style={{ color: '#c084fc' }} />
                </div>
              </div>
            </div>
          </div>
          
          {/* Bottom Half: Split Terminal Console & AI Team Progress stretching perfectly to bottom */}
          <div className="gw-bottom-pane">
            
            {/* Left CLI Terminal column */}
            <div className="gw-terminal-column">
              <div className="gw-terminal-scanline" />
              <div className="gw-terminal-titlebar">
                <div className="gw-terminal-dots">
                  <span className="gw-terminal-dot close"></span>
                  <span className="gw-terminal-dot min"></span>
                  <span className="gw-terminal-dot max"></span>
                </div>
                <span className="gw-terminal-tab-title">Command line Console</span>
                <div style={{ width: '42px' }}></div>
              </div>
              
              <div className="gw-terminal-content">
                {logs.map((log, index) => (
                  <div key={index} className="gw-log-row">
                    <span className={`gw-log-content ${log.includes('accuracy') || log.includes('Success') || log.includes('activated') || log.includes('finished') ? 'success' : 'system'}`}>
                      {log}
                    </span>
                  </div>
                ))}
                
                {executing && (
                  <div className="gw-log-row">
                    <span>Model optimization: Epoch 34/50...</span>
                    <span className="gw-terminal-cursor"></span>
                  </div>
                )}

                {!executing && (
                  <div className="gw-log-row">
                    <span>guest@gigawork:~$</span>
                    <span className="gw-terminal-cursor"></span>
                  </div>
                )}
                
                <div ref={terminalEndRef} />
              </div>
            </div>
            
            {/* Right AI Team Progress Column */}
            <div className="gw-progress-sidebar">
              <div className="gw-progress-header">
                <div className="gw-progress-title-row">
                  <h4 className="gw-sidebar-ai-team-title">AI Team progress</h4>
                  <span className="gw-sidebar-ai-team-dots" style={{ letterSpacing: '1px' }}>•••</span>
                </div>
                <span className="gw-progress-subtitle">Custom progress bars</span>
                
                <div className="gw-master-bar">
                  <div className="gw-master-fill" style={{ width: `${percent}%` }}></div>
                </div>
              </div>
              
              <div className="gw-agent-cards-container">
                {/* Agent Card 1: Scanner */}
                <div className="gw-agent-card" style={{ color: '#00f0ff' }}>
                  <div className="gw-agent-icon-box">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                      <circle cx="11" cy="11" r="7" />
                      <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className="gw-agent-info">
                    <div className="gw-agent-row-one">
                      <span className="gw-agent-card-title">Scanner Agent</span>
                      <span className="gw-agent-status-label percent">65%</span>
                    </div>
                    <span className="gw-agent-card-subtitle">Scanning files...</span>
                    <div className="gw-agent-bar">
                      <div className="gw-agent-fill" style={{ width: '65%', backgroundColor: '#00f0ff' }}></div>
                    </div>
                  </div>
                </div>
                
                {/* Agent Card 2: Tracker */}
                <div className="gw-agent-card" style={{ color: '#00e676' }}>
                  <div className="gw-agent-icon-box">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                      <path d="M12 2v20M2 12h20" strokeLinecap="round" />
                      <circle cx="12" cy="12" r="5" />
                      <circle cx="12" cy="12" r="9" />
                    </svg>
                  </div>
                  <div className="gw-agent-info">
                    <div className="gw-agent-row-one">
                      <span className="gw-agent-card-title">Tracker Agent</span>
                      <span className="gw-agent-status-label active">active</span>
                    </div>
                    <span className="gw-agent-card-subtitle">Tracking anomalies...</span>
                    <div className="gw-agent-bar">
                      <div className="gw-agent-fill" style={{ width: completedSteps >= 2 ? '100%' : '35%', backgroundColor: '#00e676' }}></div>
                    </div>
                  </div>
                </div>
                
                {/* Agent Card 3: Sentiment */}
                <div className="gw-agent-card" style={{ color: '#c084fc' }}>
                  <div className="gw-agent-icon-box">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className="gw-agent-info">
                    <div className="gw-agent-row-one">
                      <span className="gw-agent-card-title">Sentiment Agent</span>
                      <span className="gw-agent-status-label percent">88%</span>
                    </div>
                    <span className="gw-agent-card-subtitle">Analyzing feedback...</span>
                    <div className="gw-agent-bar">
                      <div className="gw-agent-fill" style={{ width: '88%', backgroundColor: '#c084fc' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
          </div>
          
        </div>

      </div>
    </div>
  )
}
