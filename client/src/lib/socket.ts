import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

/** Socket.IO client with explicit reconnect state for the header indicator. */
export type SocketState = 'connecting' | 'connected' | 'reconnecting' | 'error';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
  }
  return socket;
}

export function useSocketState(): SocketState {
  const [state, setState] = useState<SocketState>('connecting');
  useEffect(() => {
    const s = getSocket();
    const onConnect = () => setState('connected');
    const onDisconnect = () => setState('reconnecting');
    const onError = () => setState('error');
    if (s.connected) setState('connected');
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onError);
    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onError);
    };
  }, []);
  return state;
}

/** Live binding to prefers-reduced-motion (WCAG 2.2 AA + PDF rule 12). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
