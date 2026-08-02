/**
 * Getting at the dictionary.
 *
 * Two doors, because there are two kinds of caller. Components use `useT()` and
 * re-render when the language changes. Everything outside React — the socket's
 * error handler, the canvas renderers — uses `t()`, which reads the store
 * directly and is correct at the moment it is called.
 *
 * This lives apart from `i18n.ts` only to keep the import graph acyclic:
 * `store.ts` needs `Lang` from the dictionary, so the dictionary cannot in turn
 * reach into the store.
 */
import { dictFor, type Dict } from './i18n';
import { useStore } from './store';

/** The dictionary, for components. Re-renders on a language change. */
export function useT(): Dict {
  return useStore((s) => dictFor(s.lang));
}

/** The dictionary, for callers that aren't components. */
export function t(): Dict {
  return dictFor(useStore.getState().lang);
}
