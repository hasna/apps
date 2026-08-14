import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

const SSE_URL = "/sse";
const RECONNECT_DELAY = 3000;

/**
 * Subscribe to the server-sent events stream.
 * On each event, invalidates the relevant TanStack Query caches.
 * Auto-reconnects on disconnect.
 */
export function useSSE() {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;

    function connect() {
      if (!mounted) return;
      const es = new EventSource(SSE_URL);
      esRef.current = es;

      // Generic message handler (event-typed data)
      es.onmessage = (e: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(e.data) as { event?: string; data?: unknown };
          handleEvent(msg.event ?? "", msg.data);
        } catch {
          // Not JSON — ignore (e.g. keepalive comments)
        }
      };

      // Named event handlers
      const ticketEvents = ["ticket.created", "ticket.updated", "ticket.closed", "ticket.reopened", "ticket.assigned", "ticket.status_changed"];
      for (const eventName of ticketEvents) {
        es.addEventListener(eventName, () => {
          void qc.invalidateQueries({ queryKey: ["tickets"] });
          void qc.invalidateQueries({ queryKey: ["ticket"] });
        });
      }

      es.addEventListener("comment.created", () => {
        void qc.invalidateQueries({ queryKey: ["comments"] });
        void qc.invalidateQueries({ queryKey: ["activity"] });
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (mounted) {
          timerRef.current = setTimeout(connect, RECONNECT_DELAY);
        }
      };
    }

    function handleEvent(event: string, _data: unknown) {
      if (event.startsWith("ticket.")) {
        void qc.invalidateQueries({ queryKey: ["tickets"] });
        void qc.invalidateQueries({ queryKey: ["ticket"] });
      } else if (event.startsWith("comment.")) {
        void qc.invalidateQueries({ queryKey: ["comments"] });
        void qc.invalidateQueries({ queryKey: ["activity"] });
      }
    }

    connect();

    return () => {
      mounted = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, [qc]);
}
