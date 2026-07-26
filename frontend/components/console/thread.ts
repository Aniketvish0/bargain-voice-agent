import { useCallback, useEffect, useState } from "react";

/**
 * The console conversation.
 *
 * Kept in localStorage rather than Convex on purpose: BUILD-SPEC §14 treats the
 * dashboard as a read-only projector artifact over mission state, and adding a
 * messages table would mean editing schema.ts while the voice agent is being
 * worked on. Everything that MATTERS — the goal, the roster, the calls, the
 * quotes — is already durable in Convex and re-derived on load. This only
 * remembers the chit-chat around it.
 */

export type Msg = {
  id: string;
  role: "user" | "agent";
  text: string;
  at: number;
};

const KEY = (missionId: string | null) => `orydl_thread_${missionId ?? "new"}`;

function read(missionId: string | null): Msg[] {
  try {
    const raw = localStorage.getItem(KEY(missionId));
    return raw ? (JSON.parse(raw) as Msg[]) : [];
  } catch {
    return [];
  }
}

let seq = 0;
const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function useThread(missionId: string | null) {
  const [messages, setMessages] = useState<Msg[]>(() => read(missionId));

  useEffect(() => {
    setMessages(read(missionId));
  }, [missionId]);

  const persist = useCallback(
    (next: Msg[], forMission: string | null) => {
      try {
        localStorage.setItem(KEY(forMission), JSON.stringify(next.slice(-60)));
      } catch {
        /* quota or private mode — the in-memory thread still works */
      }
    },
    [],
  );

  const push = useCallback(
    (role: Msg["role"], text: string) => {
      const msg: Msg = { id: newId(), role, text, at: Date.now() };
      setMessages((prev) => {
        const next = [...prev, msg];
        persist(next, missionId);
        return next;
      });
      return msg;
    },
    [missionId, persist],
  );

  /**
   * A goal typed with no mission selected lands in the "new" bucket, then the
   * mission id arrives. Move the transcript across so the conversation that
   * created the mission stays attached to it.
   */
  const adopt = useCallback(
    (newMissionId: string) => {
      const pending = read(null);
      if (pending.length) {
        const existing = read(newMissionId);
        persist([...existing, ...pending], newMissionId);
        localStorage.removeItem(KEY(null));
      }
    },
    [persist],
  );

  const clear = useCallback(() => {
    localStorage.removeItem(KEY(missionId));
    setMessages([]);
  }, [missionId]);

  return { messages, push, adopt, clear };
}
