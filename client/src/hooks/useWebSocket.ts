import { useEffect, useRef, useCallback } from 'react';

type WebSocketMessage = {
  type: string;
  data: any;
};

type MessageHandler = (data: any) => void;

export function useWebSocket(handlers: Record<string, MessageHandler>) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  
  // Update handlers ref when they change
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    // Clean up any existing timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      
      // Only attempt connection if we have a valid host
      if (!host) {
        console.warn('WebSocket: No host available, skipping connection');
        return;
      }
      
      const wsUrl = `${protocol}//${host}/ws`;
      
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('WebSocket connected');
      };
      
      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          const handler = handlersRef.current[message.type];
          if (handler) {
            handler(message.data);
          }
        } catch (error) {
          console.error('WebSocket message parse error:', error);
        }
      };
      
      ws.onclose = () => {
        console.log('WebSocket disconnected');
        // Only reconnect if component is still mounted
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 5000);
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        ws.close();
      };
      
      wsRef.current = ws;
    } catch (error) {
      console.error('WebSocket connection error:', error);
    }
  }, []);

  useEffect(() => {
    connect();
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return wsRef.current;
}
