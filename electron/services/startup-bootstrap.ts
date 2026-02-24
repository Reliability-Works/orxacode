export type StartupBootstrapTracker = {
  start: (task: () => Promise<void>) => Promise<void>;
  wait: () => Promise<void>;
  hasPending: () => boolean;
  clear: () => void;
};

export function createStartupBootstrapTracker(): StartupBootstrapTracker {
  let pending: Promise<void> | undefined;

  return {
    start: (task) => {
      if (pending) {
        return pending;
      }

      pending = task().finally(() => {
        pending = undefined;
      });
      return pending;
    },
    wait: async () => {
      if (pending) {
        await pending;
      }
    },
    hasPending: () => Boolean(pending),
    clear: () => {
      pending = undefined;
    },
  };
}
