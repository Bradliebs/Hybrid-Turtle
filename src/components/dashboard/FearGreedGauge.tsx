'use client';

import { useStore } from '@/store/useStore';
import { useEffect, useRef } from 'react';

export default function FearGreedGauge() {
  const { fearGreed } = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const value = fearGreed?.value ?? 50;
  const label = fearGreed?.label ?? 'Neutral';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height - 20;
    const radius = Math.min(width, height) - 40;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw arc background segments
    const segments = [
      { start: Math.PI, end: Math.PI + Math.PI * 0.2, color: '#ef4444' },    // Extreme Fear
      { start: Math.PI + Math.PI * 0.2, end: Math.PI + Math.PI * 0.4, color: '#f59e0b' }, // Fear
      { start: Math.PI + Math.PI * 0.4, end: Math.PI + Math.PI * 0.6, color: '#eab308' }, // Neutral
      { start: Math.PI + Math.PI * 0.6, end: Math.PI + Math.PI * 0.8, color: '#84cc16' }, // Greed
      { start: Math.PI + Math.PI * 0.8, end: Math.PI * 2, color: '#22c55e' },             // Extreme Greed
    ];

    segments.forEach((seg) => {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 0.45, seg.start, seg.end);
      ctx.lineWidth = 20;
      ctx.strokeStyle = seg.color;
      ctx.lineCap = 'round';
      ctx.stroke();
    });

    // Draw needle
    const needleAngle = Math.PI + (value / 100) * Math.PI;
    const needleLength = radius * 0.35;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + Math.cos(needleAngle) * needleLength,
      centerY + Math.sin(needleAngle) * needleLength
    );
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Needle center dot
    ctx.beginPath();
    ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Value text
    ctx.font = 'bold 28px Inter, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(value.toString(), centerX, centerY - 30);

    // Label
    ctx.font = '13px Inter, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(label, centerX, centerY - 10);

    // Scale labels
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    ctx.fillText('Extreme Fear', 10, centerY + 15);
    ctx.textAlign = 'right';
    ctx.fillText('Extreme Greed', width - 10, centerY + 15);
  }, [value, label]);

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-2">Fear & Greed Index</h3>
      <div className="flex justify-center">
        <canvas
          ref={canvasRef}
          width={280}
          height={170}
          className="max-w-full"
        />
      </div>
      {fearGreed && (
        <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
          <div>
            <div className="text-muted-foreground">Previous</div>
            <div className="text-foreground font-mono">{fearGreed.previousClose}</div>
          </div>
          <div>
            <div className="text-muted-foreground">1 Week Ago</div>
            <div className="text-foreground font-mono">{fearGreed.oneWeekAgo}</div>
          </div>
          <div>
            <div className="text-muted-foreground">1 Month Ago</div>
            <div className="text-foreground font-mono">{fearGreed.oneMonthAgo}</div>
          </div>
        </div>
      )}
    </div>
  );
}
