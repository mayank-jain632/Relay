'use client';

import { useEffect, useRef } from 'react';

type NodePoint = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
};

export function TechNetworkBackground(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nodeCount = prefersReducedMotion ? 18 : 28;
    const nodes: NodePoint[] = [];
    let width = 0;
    let height = 0;
    let animationFrame = 0;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const seedNodes = () => {
      nodes.length = 0;
      for (let index = 0; index < nodeCount; index += 1) {
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * (prefersReducedMotion ? 0 : 0.12),
          vy: (Math.random() - 0.5) * (prefersReducedMotion ? 0 : 0.12),
          r: 1.4 + Math.random() * 1.8
        });
      }
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);

      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (!prefersReducedMotion) {
          node.x += node.vx;
          node.y += node.vy;
          if (node.x < -20) node.x = width + 20;
          if (node.x > width + 20) node.x = -20;
          if (node.y < -20) node.y = height + 20;
          if (node.y > height + 20) node.y = -20;
        }

        for (let j = i + 1; j < nodes.length; j += 1) {
          const other = nodes[j];
          const dx = other.x - node.x;
          const dy = other.y - node.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance > 180) {
            continue;
          }

          const opacity = 1 - distance / 180;
          context.strokeStyle = `rgba(205, 212, 224, ${opacity * 0.16})`;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(node.x, node.y);
          context.lineTo(other.x, other.y);
          context.stroke();
        }
      }

      for (const node of nodes) {
        context.fillStyle = 'rgba(238, 242, 247, 0.78)';
        context.beginPath();
        context.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        context.fill();

        context.fillStyle = 'rgba(255, 255, 255, 0.08)';
        context.beginPath();
        context.arc(node.x, node.y, node.r * 4.5, 0, Math.PI * 2);
        context.fill();
      }

      if (!prefersReducedMotion) {
        animationFrame = window.requestAnimationFrame(draw);
      }
    };

    resize();
    seedNodes();
    draw();

    const handleResize = () => {
      resize();
      seedNodes();
      draw();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  return <canvas ref={canvasRef} className="landing-network-canvas" aria-hidden="true" />;
}
