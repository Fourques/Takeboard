import type { ProjectSnapshot } from "@takeboard/contracts";
import { useCallback, useRef, useState } from "react";
import type { DemoPayload } from "./api";
import { nextProjectDocument } from "./project-document";

/** One commit boundary for snapshot + revision, also readable by async callbacks. */
export function useProjectDocument() {
  const [document, setDocument] = useState<DemoPayload | null>(null);
  const current = useRef<DemoPayload | null>(null);
  const navigation = useRef(0);
  const read = useCallback(() => current.current, []);
  const publish = useCallback((next: DemoPayload | null) => {
    if (next === current.current) return false;
    current.current = next;
    setDocument(next);
    return true;
  }, []);
  const receive = useCallback(
    (incoming: DemoPayload) => publish(nextProjectDocument(current.current, incoming)),
    [publish],
  );
  const beginNavigation = useCallback(() => ++navigation.current, []);
  const isCurrentNavigation = useCallback((ticket: number) => ticket === navigation.current, []);
  const activate = useCallback(
    (incoming: DemoPayload, ticket: number) => {
      if (ticket !== navigation.current) return false;
      publish(nextProjectDocument(current.current, incoming, true));
      return true;
    },
    [publish],
  );
  const editLocalSnapshot = useCallback(
    (edit: (snapshot: ProjectSnapshot) => ProjectSnapshot) => {
      if (current.current)
        publish({ ...current.current, snapshot: edit(current.current.snapshot) });
    },
    [publish],
  );
  return {
    document,
    read,
    receive,
    beginNavigation,
    isCurrentNavigation,
    activate,
    editLocalSnapshot,
  };
}
