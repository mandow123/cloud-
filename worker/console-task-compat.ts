type ReactConsoleTask = Readonly<{ run<T>(callback: () => T): T }>;
type ConsoleWithTask = Console & { createTask?: (name: string) => ReactConsoleTask };

// React 19 enables owner-stack tasks whenever `console.createTask` exists.
// Miniflare currently exposes the method but throws when it is called, which
// makes every development page return 500 before application code runs. Keep
// a real implementation untouched and hide only the unusable development
// stub so React falls back to its supported no-task path.
const taskConsole = console as ConsoleWithTask;
if (typeof taskConsole.createTask === "function") {
  try {
    const probe = taskConsole.createTask("KAI Cloud compatibility probe");
    if (!probe || typeof probe.run !== "function") throw new Error("CONSOLE_TASK_INVALID");
  } catch {
    Object.defineProperty(taskConsole, "createTask", { configurable: true, value: undefined, writable: true });
  }
}
